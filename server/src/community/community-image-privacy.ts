function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function tiffContainsGps(bytes: Uint8Array, offset: number, length: number): boolean {
  if (length < 8 || offset < 0 || offset + length > bytes.length) return false;
  const order = readAscii(bytes, offset, 2);
  const littleEndian = order === "II";
  if (!littleEndian && order !== "MM") return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, length);
  if (view.getUint16(2, littleEndian) !== 42) return false;
  const ifdOffset = view.getUint32(4, littleEndian);
  if (ifdOffset + 2 > length) return false;
  const count = view.getUint16(ifdOffset, littleEndian);
  for (let index = 0; index < count; index += 1) {
    const entryOffset = ifdOffset + 2 + index * 12;
    if (entryOffset + 12 > length) return false;
    if (view.getUint16(entryOffset, littleEndian) === 0x8825) return true;
  }
  return false;
}

function jpegContainsGps(bytes: Uint8Array): boolean {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const segmentLength = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    if (segmentLength < 2 || offset + 2 + segmentLength > bytes.length) break;
    const payloadOffset = offset + 4;
    const payloadLength = segmentLength - 2;
    if (
      marker === 0xe1
      && payloadLength >= 14
      && readAscii(bytes, payloadOffset, 6) === "Exif\0\0"
      && tiffContainsGps(bytes, payloadOffset + 6, payloadLength - 6)
    ) return true;
    offset += 2 + segmentLength;
  }
  return false;
}

function pngContainsGps(bytes: Uint8Array): boolean {
  if (bytes.length < 8 || readAscii(bytes, 1, 3) !== "PNG") return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset, false);
    const type = readAscii(bytes, offset + 4, 4);
    const dataOffset = offset + 8;
    if (dataOffset + length + 4 > bytes.length) break;
    if (type === "eXIf" && tiffContainsGps(bytes, dataOffset, length)) return true;
    if (type === "IEND") break;
    offset = dataOffset + length + 4;
  }
  return false;
}

function webpContainsGps(bytes: Uint8Array): boolean {
  if (bytes.length < 12 || readAscii(bytes, 0, 4) !== "RIFF" || readAscii(bytes, 8, 4) !== "WEBP") return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = readAscii(bytes, offset, 4);
    const length = view.getUint32(offset + 4, true);
    const dataOffset = offset + 8;
    if (dataOffset + length > bytes.length) break;
    if (type === "EXIF" && tiffContainsGps(bytes, dataOffset, length)) return true;
    offset = dataOffset + length + (length % 2);
  }
  return false;
}

export function containsExifGps(contentType: string, bytes: Uint8Array): boolean {
  if (contentType === "image/jpeg") return jpegContainsGps(bytes);
  if (contentType === "image/png") return pngContainsGps(bytes);
  if (contentType === "image/webp") return webpContainsGps(bytes);
  return false;
}
