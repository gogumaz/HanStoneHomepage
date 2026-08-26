import { describe, expect, it } from "vitest";
import { containsExifGps } from "./community-image-privacy.js";

function jpegWithExifGps(): Uint8Array {
  const tiff = Uint8Array.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00,
    0x25, 0x88, 0x04, 0x00, 0x01, 0x00, 0x00, 0x00, 0x1a, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ]);
  const payload = Uint8Array.from([...Buffer.from("Exif\0\0", "binary"), ...tiff]);
  const length = payload.length + 2;
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, length >> 8, length & 0xff, ...payload, 0xff, 0xd9]);
}

describe("community image privacy", () => {
  it("detects a GPS IFD pointer inside JPEG EXIF metadata", () => {
    expect(containsExifGps("image/jpeg", jpegWithExifGps())).toBe(true);
  });

  it("allows images without EXIF GPS metadata and ignores documents", () => {
    expect(containsExifGps("image/jpeg", Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]))).toBe(false);
    expect(containsExifGps("application/pdf", Uint8Array.from(Buffer.from("%PDF-1.7")))).toBe(false);
  });
});
