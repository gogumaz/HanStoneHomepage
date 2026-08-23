import { inflateRawSync } from "node:zlib";

const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const CFB_FREE_SECTOR = 0xffffffff;
const CFB_END_OF_CHAIN = 0xfffffffe;
const CFB_FAT_SECTOR = 0xfffffffd;
const CFB_DIFAT_SECTOR = 0xfffffffc;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;
const ZIP_MAX_ENTRIES = 2_048;
const ZIP_MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const ZIP_MAX_INSPECTED_ENTRY_BYTES = 2 * 1024 * 1024;

type ZipEntry = {
  name: string;
  flags: number;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
};

type CompoundEntry = {
  name: string;
  type: number;
  leftSibling: number;
  rightSibling: number;
  child: number;
  startSector: number;
  size: number;
};

function hasPrefix(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

function isSafeZipPath(name: string): boolean {
  if (!name || name.includes("\0") || name.includes("\\") || name.startsWith("/")) return false;
  return !name.split("/").some((part) => part === "..");
}

class ZipPackage {
  private constructor(
    private readonly buffer: Buffer,
    private readonly entries: Map<string, ZipEntry>,
  ) {}

  static parse(bytes: Uint8Array): ZipPackage | null {
    const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (buffer.length < 22 || !hasPrefix(bytes, [0x50, 0x4b])) return null;
    const searchStart = Math.max(0, buffer.length - 65_557);
    let eocdOffset = -1;
    for (let offset = buffer.length - 22; offset >= searchStart; offset -= 1) {
      if (buffer.readUInt32LE(offset) === ZIP_EOCD_SIGNATURE) {
        const commentLength = buffer.readUInt16LE(offset + 20);
        if (offset + 22 + commentLength === buffer.length) {
          eocdOffset = offset;
          break;
        }
      }
    }
    if (eocdOffset < 0) return null;

    const disk = buffer.readUInt16LE(eocdOffset + 4);
    const centralDisk = buffer.readUInt16LE(eocdOffset + 6);
    const diskEntries = buffer.readUInt16LE(eocdOffset + 8);
    const entryCount = buffer.readUInt16LE(eocdOffset + 10);
    const centralSize = buffer.readUInt32LE(eocdOffset + 12);
    const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
    if (
      disk !== 0
      || centralDisk !== 0
      || diskEntries !== entryCount
      || entryCount === 0
      || entryCount > ZIP_MAX_ENTRIES
      || entryCount === 0xffff
      || centralSize === 0xffffffff
      || centralOffset === 0xffffffff
      || centralOffset + centralSize > eocdOffset
    ) return null;

    const entries = new Map<string, ZipEntry>();
    let offset = centralOffset;
    let totalUncompressed = 0;
    for (let index = 0; index < entryCount; index += 1) {
      if (offset + 46 > eocdOffset || buffer.readUInt32LE(offset) !== ZIP_CENTRAL_SIGNATURE) return null;
      const flags = buffer.readUInt16LE(offset + 8);
      const method = buffer.readUInt16LE(offset + 10);
      const compressedSize = buffer.readUInt32LE(offset + 20);
      const uncompressedSize = buffer.readUInt32LE(offset + 24);
      const nameLength = buffer.readUInt16LE(offset + 28);
      const extraLength = buffer.readUInt16LE(offset + 30);
      const commentLength = buffer.readUInt16LE(offset + 32);
      const startDisk = buffer.readUInt16LE(offset + 34);
      const localOffset = buffer.readUInt32LE(offset + 42);
      const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
      if (
        nextOffset > eocdOffset
        || nameLength === 0
        || (flags & 0x0001) !== 0
        || (method !== 0 && method !== 8)
        || startDisk !== 0
        || compressedSize === 0xffffffff
        || uncompressedSize === 0xffffffff
        || localOffset === 0xffffffff
      ) return null;
      const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
      if (!isSafeZipPath(name) || entries.has(name)) return null;
      totalUncompressed += uncompressedSize;
      if (!Number.isSafeInteger(totalUncompressed) || totalUncompressed > ZIP_MAX_UNCOMPRESSED_BYTES) return null;
      entries.set(name, { name, flags, method, compressedSize, uncompressedSize, localOffset });
      offset = nextOffset;
    }
    if (offset !== centralOffset + centralSize) return null;
    return new ZipPackage(buffer, entries);
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  readText(name: string): string | null {
    const entry = this.entries.get(name);
    if (!entry || entry.uncompressedSize > ZIP_MAX_INSPECTED_ENTRY_BYTES) return null;
    const { localOffset } = entry;
    if (localOffset + 30 > this.buffer.length || this.buffer.readUInt32LE(localOffset) !== ZIP_LOCAL_SIGNATURE) {
      return null;
    }
    const localFlags = this.buffer.readUInt16LE(localOffset + 6);
    const localMethod = this.buffer.readUInt16LE(localOffset + 8);
    const nameLength = this.buffer.readUInt16LE(localOffset + 26);
    const extraLength = this.buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + nameLength + extraLength;
    const dataEnd = dataStart + entry.compressedSize;
    if (localFlags !== entry.flags || localMethod !== entry.method || dataEnd > this.buffer.length) return null;
    const localName = this.buffer.toString("utf8", localOffset + 30, localOffset + 30 + nameLength);
    if (localName !== entry.name) return null;
    const compressed = this.buffer.subarray(dataStart, dataEnd);
    try {
      const output = entry.method === 0
        ? Buffer.from(compressed)
        : inflateRawSync(compressed, { maxOutputLength: ZIP_MAX_INSPECTED_ENTRY_BYTES });
      if (output.length !== entry.uncompressedSize) return null;
      return output.toString("utf8");
    } catch {
      return null;
    }
  }
}

class CompoundFile {
  private constructor(
    private readonly buffer: Buffer,
    private readonly sectorSize: number,
    private readonly miniSectorSize: number,
    private readonly miniStreamCutoff: number,
    private readonly fat: number[],
    private readonly miniFat: number[],
    private readonly miniStream: Buffer,
    private readonly entries: Map<string, CompoundEntry>,
  ) {}

  static parse(bytes: Uint8Array): CompoundFile | null {
    const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (buffer.length < 512 || !hasPrefix(bytes, CFB_SIGNATURE)) return null;
    if (buffer.readUInt16LE(0x1c) !== 0xfffe) return null;
    const majorVersion = buffer.readUInt16LE(0x1a);
    const sectorShift = buffer.readUInt16LE(0x1e);
    const miniSectorShift = buffer.readUInt16LE(0x20);
    if ((majorVersion !== 3 && majorVersion !== 4) || sectorShift !== (majorVersion === 3 ? 9 : 12) || miniSectorShift !== 6) {
      return null;
    }
    const sectorSize = 2 ** sectorShift;
    const miniSectorSize = 2 ** miniSectorShift;
    if (buffer.length < sectorSize || (buffer.length - sectorSize) % sectorSize !== 0) return null;
    const sectorCount = (buffer.length - sectorSize) / sectorSize;
    const numberOfFatSectors = buffer.readUInt32LE(0x2c);
    const firstDirectorySector = buffer.readUInt32LE(0x30);
    const miniStreamCutoff = buffer.readUInt32LE(0x38);
    const firstMiniFatSector = buffer.readUInt32LE(0x3c);
    const numberOfMiniFatSectors = buffer.readUInt32LE(0x40);
    const firstDifatSector = buffer.readUInt32LE(0x44);
    const numberOfDifatSectors = buffer.readUInt32LE(0x48);
    if (miniStreamCutoff !== 4096 || numberOfFatSectors > sectorCount || numberOfDifatSectors > sectorCount) return null;

    const sector = (id: number): Buffer | null => {
      if (!Number.isInteger(id) || id < 0 || id >= sectorCount) return null;
      const start = sectorSize + id * sectorSize;
      return buffer.subarray(start, start + sectorSize);
    };
    const difat: number[] = [];
    for (let index = 0; index < 109; index += 1) {
      const id = buffer.readUInt32LE(0x4c + index * 4);
      if (id !== CFB_FREE_SECTOR) difat.push(id);
    }
    let difatSectorId = firstDifatSector;
    const seenDifat = new Set<number>();
    for (let count = 0; count < numberOfDifatSectors; count += 1) {
      if (seenDifat.has(difatSectorId)) return null;
      seenDifat.add(difatSectorId);
      const difatSector = sector(difatSectorId);
      if (!difatSector) return null;
      const entriesPerSector = sectorSize / 4 - 1;
      for (let index = 0; index < entriesPerSector; index += 1) {
        const id = difatSector.readUInt32LE(index * 4);
        if (id !== CFB_FREE_SECTOR) difat.push(id);
      }
      difatSectorId = difatSector.readUInt32LE(sectorSize - 4);
    }
    if (numberOfDifatSectors === 0 && firstDifatSector !== CFB_END_OF_CHAIN) return null;
    if (numberOfDifatSectors > 0 && difatSectorId !== CFB_END_OF_CHAIN) return null;
    if (difat.length < numberOfFatSectors) return null;

    const fat: number[] = [];
    for (const fatSectorId of difat.slice(0, numberOfFatSectors)) {
      const fatSector = sector(fatSectorId);
      if (!fatSector) return null;
      for (let offset = 0; offset < sectorSize; offset += 4) fat.push(fatSector.readUInt32LE(offset));
    }
    const followChain = (start: number, allocation: number[], maxItems: number): number[] | null => {
      if (start === CFB_END_OF_CHAIN) return [];
      const result: number[] = [];
      const seen = new Set<number>();
      let current = start;
      while (current !== CFB_END_OF_CHAIN) {
        if (
          current === CFB_FREE_SECTOR
          || current === CFB_FAT_SECTOR
          || current === CFB_DIFAT_SECTOR
          || current >= allocation.length
          || seen.has(current)
          || result.length >= maxItems
        ) return null;
        seen.add(current);
        result.push(current);
        const next = allocation[current];
        if (next === undefined) return null;
        current = next;
      }
      return result;
    };
    const readRegularChain = (start: number, maxItems = sectorCount): Buffer | null => {
      const chain = followChain(start, fat, maxItems);
      if (!chain) return null;
      const chunks: Buffer[] = [];
      for (const id of chain) {
        const chunk = sector(id);
        if (!chunk) return null;
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    };

    const directoryBytes = readRegularChain(firstDirectorySector);
    if (!directoryBytes || directoryBytes.length === 0 || directoryBytes.length % 128 !== 0) return null;
    const directoryEntries: Array<CompoundEntry | null> = [];
    let root: CompoundEntry | null = null;
    for (let offset = 0; offset < directoryBytes.length; offset += 128) {
      const nameLength = directoryBytes.readUInt16LE(offset + 64);
      const type = directoryBytes[offset + 66] ?? 0;
      if (type === 0) {
        directoryEntries.push(null);
        continue;
      }
      if (nameLength < 2 || nameLength > 64 || nameLength % 2 !== 0) return null;
      const name = directoryBytes.toString("utf16le", offset, offset + nameLength - 2);
      if (!name) return null;
      const sizeLow = directoryBytes.readUInt32LE(offset + 120);
      const sizeHigh = directoryBytes.readUInt32LE(offset + 124);
      if (sizeHigh !== 0 || (type !== 1 && type !== 2 && type !== 5)) return null;
      const entry = {
        name,
        type,
        leftSibling: directoryBytes.readUInt32LE(offset + 68),
        rightSibling: directoryBytes.readUInt32LE(offset + 72),
        child: directoryBytes.readUInt32LE(offset + 76),
        startSector: directoryBytes.readUInt32LE(offset + 116),
        size: sizeLow,
      };
      directoryEntries.push(entry);
      if (type === 5) {
        if (root) return null;
        root = entry;
      }
    }
    if (!root) return null;
    const entries = new Map<string, CompoundEntry>();
    const seenDirectoryIds = new Set<number>();
    const visitSiblingTree = (id: number): boolean => {
      if (id === CFB_FREE_SECTOR) return true;
      if (id >= directoryEntries.length || seenDirectoryIds.has(id)) return false;
      const entry = directoryEntries[id];
      if (!entry || entry.type === 5) return false;
      seenDirectoryIds.add(id);
      if (!visitSiblingTree(entry.leftSibling) || entries.has(entry.name)) return false;
      entries.set(entry.name, entry);
      return visitSiblingTree(entry.rightSibling);
    };
    if (!visitSiblingTree(root.child)) return null;

    let miniFat: number[] = [];
    if (numberOfMiniFatSectors > 0) {
      const miniFatChain = followChain(firstMiniFatSector, fat, numberOfMiniFatSectors);
      if (!miniFatChain || miniFatChain.length !== numberOfMiniFatSectors) return null;
      const chunks = miniFatChain.map((id) => sector(id));
      if (chunks.some((chunk) => !chunk)) return null;
      const miniFatBytes = Buffer.concat(chunks as Buffer[]);
      miniFat = Array.from({ length: miniFatBytes.length / 4 }, (_, index) => miniFatBytes.readUInt32LE(index * 4));
    } else if (firstMiniFatSector !== CFB_END_OF_CHAIN) {
      return null;
    }
    const rootBytes = root.size === 0 ? Buffer.alloc(0) : readRegularChain(root.startSector);
    if (!rootBytes || rootBytes.length < root.size) return null;
    const miniStream = rootBytes.subarray(0, root.size);
    return new CompoundFile(buffer, sectorSize, miniSectorSize, miniStreamCutoff, fat, miniFat, miniStream, entries);
  }

  has(name: string, type?: number): boolean {
    const entry = this.entries.get(name);
    return Boolean(entry && (type === undefined || entry.type === type));
  }

  readStream(name: string): Buffer | null {
    const entry = this.entries.get(name);
    if (!entry || entry.type !== 2) return null;
    if (entry.size === 0) return Buffer.alloc(0);
    if (entry.size < this.miniStreamCutoff) {
      const chain = this.followChain(entry.startSector, this.miniFat, Math.ceil(entry.size / this.miniSectorSize));
      if (!chain) return null;
      const chunks: Buffer[] = [];
      for (const id of chain) {
        const start = id * this.miniSectorSize;
        if (start + this.miniSectorSize > this.miniStream.length) return null;
        chunks.push(this.miniStream.subarray(start, start + this.miniSectorSize));
      }
      const output = Buffer.concat(chunks);
      return output.length >= entry.size ? output.subarray(0, entry.size) : null;
    }
    const chain = this.followChain(entry.startSector, this.fat, Math.ceil(entry.size / this.sectorSize));
    if (!chain) return null;
    const chunks: Buffer[] = [];
    const sectorCount = (this.buffer.length - this.sectorSize) / this.sectorSize;
    for (const id of chain) {
      if (id >= sectorCount) return null;
      const start = this.sectorSize + id * this.sectorSize;
      chunks.push(this.buffer.subarray(start, start + this.sectorSize));
    }
    const output = Buffer.concat(chunks);
    return output.length >= entry.size ? output.subarray(0, entry.size) : null;
  }

  private followChain(start: number, allocation: number[], maxItems: number): number[] | null {
    const result: number[] = [];
    const seen = new Set<number>();
    let current = start;
    while (current !== CFB_END_OF_CHAIN) {
      if (
        current === CFB_FREE_SECTOR
        || current === CFB_FAT_SECTOR
        || current === CFB_DIFAT_SECTOR
        || current >= allocation.length
        || seen.has(current)
        || result.length >= maxItems
      ) return null;
      seen.add(current);
      result.push(current);
      const next = allocation[current];
      if (next === undefined) return null;
      current = next;
    }
    return result;
  }
}

function validDoc(bytes: Uint8Array): boolean {
  const compound = CompoundFile.parse(bytes);
  if (!compound || !compound.has("WordDocument", 2) || (!compound.has("0Table", 2) && !compound.has("1Table", 2))) {
    return false;
  }
  const wordDocument = compound.readStream("WordDocument");
  return Boolean(wordDocument && wordDocument.length >= 2 && wordDocument.readUInt16LE(0) === 0xa5ec);
}

function validHwp(bytes: Uint8Array): boolean {
  const compound = CompoundFile.parse(bytes);
  if (!compound || !compound.has("FileHeader", 2) || !compound.has("DocInfo", 2) || !compound.has("BodyText", 1)) {
    return false;
  }
  const fileHeader = compound.readStream("FileHeader");
  return Boolean(fileHeader && fileHeader.subarray(0, 17).toString("ascii") === "HWP Document File");
}

function validOpenXml(bytes: Uint8Array, family: "word" | "ppt"): boolean {
  const zip = ZipPackage.parse(bytes);
  if (!zip) return false;
  const mainPart = family === "word" ? "word/document.xml" : "ppt/presentation.xml";
  const mainContentType = family === "word"
    ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
    : "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml";
  if (!zip.has("[Content_Types].xml") || !zip.has("_rels/.rels") || !zip.has(mainPart)) return false;
  const contentTypes = zip.readText("[Content_Types].xml");
  const relationships = zip.readText("_rels/.rels");
  return Boolean(
    contentTypes?.includes(mainContentType)
    && contentTypes.includes(`/${mainPart}`)
    && relationships?.includes("officeDocument")
    && relationships.includes(mainPart),
  );
}

function validHwpx(bytes: Uint8Array): boolean {
  const zip = ZipPackage.parse(bytes);
  if (!zip) return false;
  const required = [
    "mimetype",
    "Contents/content.hpf",
    "Contents/header.xml",
    "Contents/section0.xml",
    "META-INF/manifest.xml",
  ];
  if (!required.every((name) => zip.has(name))) return false;
  return zip.readText("mimetype")?.trim() === "application/hwp+zip";
}

export function isValidLessonAssetSignature(contentType: string, bytes: Uint8Array): boolean {
  try {
    if (contentType === "image/jpeg") return hasPrefix(bytes, [0xff, 0xd8, 0xff]);
    if (contentType === "image/png") return hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (contentType === "image/webp") {
      return hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46])
        && Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).subarray(8, 12).toString("ascii") === "WEBP";
    }
    if (contentType === "application/pdf") {
      return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).subarray(0, 5).toString("ascii") === "%PDF-";
    }
    if (contentType === "application/vnd.ms-powerpoint") {
      const compound = CompoundFile.parse(bytes);
      return Boolean(compound?.has("PowerPoint Document", 2) && compound.has("Current User", 2));
    }
    if (contentType === "application/msword") return validDoc(bytes);
    if (contentType === "application/x-hwp") return validHwp(bytes);
    if (contentType === "application/vnd.openxmlformats-officedocument.presentationml.presentation") {
      return validOpenXml(bytes, "ppt");
    }
    if (contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      return validOpenXml(bytes, "word");
    }
    if (contentType === "application/hwp+zip") return validHwpx(bytes);
    return false;
  } catch {
    return false;
  }
}
