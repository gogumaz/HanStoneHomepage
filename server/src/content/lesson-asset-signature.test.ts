import { describe, expect, it } from "vitest";
import { deflateRawSync } from "node:zlib";
import { isValidLessonAssetSignature } from "./lesson-asset-signature.js";

const FREE = 0xffffffff;
const END = 0xfffffffe;
const FAT = 0xfffffffd;

function zip(entries: Record<string, string>): Uint8Array {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;
  for (const [name, value] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name);
    const data = Buffer.from(value);
    const compressed = deflateRawSync(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    localParts.push(local, nameBytes, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, nameBytes);
    localOffset += local.length + nameBytes.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(entries).length, 8);
  eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

function writeDirectoryEntry(
  directory: Buffer,
  index: number,
  name: string,
  type: 1 | 2 | 5,
  startSector: number,
  size: number,
  rightSibling = FREE,
  child = FREE,
) {
  const offset = index * 128;
  const nameBytes = Buffer.from(`${name}\0`, "utf16le");
  nameBytes.copy(directory, offset);
  directory.writeUInt16LE(nameBytes.length, offset + 64);
  directory.writeUInt8(type, offset + 66);
  directory.writeUInt8(1, offset + 67);
  directory.writeUInt32LE(FREE, offset + 68);
  directory.writeUInt32LE(rightSibling, offset + 72);
  directory.writeUInt32LE(child, offset + 76);
  directory.writeUInt32LE(startSector, offset + 116);
  directory.writeUInt32LE(size, offset + 120);
}

function compound(
  streams: Array<{ name: string; value: Buffer }>,
  storages: string[] = [],
): Uint8Array {
  const header = Buffer.alloc(512, 0);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header);
  header.writeUInt16LE(0x003e, 0x18);
  header.writeUInt16LE(3, 0x1a);
  header.writeUInt16LE(0xfffe, 0x1c);
  header.writeUInt16LE(9, 0x1e);
  header.writeUInt16LE(6, 0x20);
  header.writeUInt32LE(0, 0x28);
  header.writeUInt32LE(1, 0x2c);
  header.writeUInt32LE(0, 0x30);
  header.writeUInt32LE(4096, 0x38);
  header.writeUInt32LE(1, 0x3c);
  header.writeUInt32LE(1, 0x40);
  header.writeUInt32LE(END, 0x44);
  header.writeUInt32LE(0, 0x48);
  for (let offset = 0x4c; offset < 512; offset += 4) header.writeUInt32LE(FREE, offset);
  header.writeUInt32LE(3, 0x4c);

  const directory = Buffer.alloc(512, 0);
  writeDirectoryEntry(directory, 0, "Root Entry", 5, 2, 512, FREE, streams.length + storages.length > 0 ? 1 : FREE);
  const entryCount = streams.length + storages.length;
  streams.forEach((stream, index) => writeDirectoryEntry(
    directory,
    index + 1,
    stream.name,
    2,
    index,
    stream.value.length,
    index + 1 < entryCount ? index + 2 : FREE,
  ));
  storages.forEach((name, index) => {
    const directoryIndex = streams.length + index + 1;
    writeDirectoryEntry(
      directory,
      directoryIndex,
      name,
      1,
      END,
      0,
      directoryIndex < entryCount ? directoryIndex + 1 : FREE,
    );
  });

  const miniFat = Buffer.alloc(512, 0xff);
  streams.forEach((_stream, index) => miniFat.writeUInt32LE(END, index * 4));
  const miniStream = Buffer.alloc(512, 0);
  streams.forEach((stream, index) => stream.value.copy(miniStream, index * 64));
  const fat = Buffer.alloc(512, 0xff);
  fat.writeUInt32LE(END, 0);
  fat.writeUInt32LE(END, 4);
  fat.writeUInt32LE(END, 8);
  fat.writeUInt32LE(FAT, 12);
  return Buffer.concat([header, directory, miniFat, miniStream, fat]);
}

const contentTypes = (family: "word" | "ppt") => family === "word"
  ? '<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  : '<Types><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>';

const relationship = (target: string) => `<Relationships><Relationship Type="officeDocument" Target="${target}"/></Relationships>`;

describe("isValidLessonAssetSignature", () => {
  it("accepts structurally valid DOCX and PPTX packages", () => {
    const docx = zip({
      "[Content_Types].xml": contentTypes("word"),
      "_rels/.rels": relationship("word/document.xml"),
      "word/document.xml": "<w:document/>",
    });
    const pptx = zip({
      "[Content_Types].xml": contentTypes("ppt"),
      "_rels/.rels": relationship("ppt/presentation.xml"),
      "ppt/presentation.xml": "<p:presentation/>",
    });
    expect(isValidLessonAssetSignature("application/vnd.openxmlformats-officedocument.wordprocessingml.document", docx)).toBe(true);
    expect(isValidLessonAssetSignature("application/vnd.openxmlformats-officedocument.presentationml.presentation", pptx)).toBe(true);
  });

  it("accepts an HWPX package only with its signature and required document parts", () => {
    const hwpx = zip({
      mimetype: "application/hwp+zip",
      "Contents/content.hpf": "<package/>",
      "Contents/header.xml": "<head/>",
      "Contents/section0.xml": "<section/>",
      "META-INF/manifest.xml": "<manifest/>",
    });
    expect(isValidLessonAssetSignature("application/hwp+zip", hwpx)).toBe(true);
    expect(isValidLessonAssetSignature("application/hwp+zip", zip({ mimetype: "application/zip" }))).toBe(false);
  });

  it("accepts DOC and HWP only when their compound-file streams match the format", () => {
    const fib = Buffer.alloc(32);
    fib.writeUInt16LE(0xa5ec, 0);
    const doc = compound([{ name: "WordDocument", value: fib }, { name: "1Table", value: Buffer.from("table") }]);
    const hwp = compound([
      { name: "FileHeader", value: Buffer.from("HWP Document File\0\0\0\0") },
      { name: "DocInfo", value: Buffer.from("info") },
    ], ["BodyText"]);
    expect(isValidLessonAssetSignature("application/msword", doc)).toBe(true);
    expect(isValidLessonAssetSignature("application/x-hwp", hwp)).toBe(true);
  });

  it("rejects renamed files, unsafe ZIP paths, and incomplete containers", () => {
    expect(isValidLessonAssetSignature("application/msword", Buffer.from("not a compound file"))).toBe(false);
    expect(isValidLessonAssetSignature("application/vnd.openxmlformats-officedocument.wordprocessingml.document", zip({
      "[Content_Types].xml": contentTypes("word"),
      "../word/document.xml": "bad",
      "_rels/.rels": relationship("word/document.xml"),
    }))).toBe(false);
    expect(isValidLessonAssetSignature("application/hwp+zip", zip({ mimetype: "application/hwp+zip" }))).toBe(false);
  });
});
