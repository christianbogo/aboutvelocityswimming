// fflate decompresses ZIP members but does not check their CRCs. Reject damaged,
// encrypted, multipart, and ZIP64 archives before interpreting their records.
type ZipEntry = { size: number; crc: number };
export function zipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65557); end--)
    if (
      view.getUint32(end, true) === 0x06054b50 &&
      end + 22 + view.getUint16(end + 20, true) === bytes.length
    )
      break;
  if (end < 0 || end < bytes.length - 65557)
    throw new Error("Invalid ZIP directory.");
  const count = view.getUint16(end + 10, true),
    size = view.getUint32(end + 12, true),
    start = view.getUint32(end + 16, true);
  if (
    view.getUint16(end + 4, true) ||
    view.getUint16(end + 6, true) ||
    view.getUint16(end + 8, true) !== count ||
    count === 65535 ||
    start + size !== end
  )
    throw new Error("Unsupported multipart or ZIP64 archive.");
  if (count > 250)
    throw new Error("ZIP exceeds the 250-entry extraction limit.");
  const result: ZipEntry[] = [];
  let offset = start;
  for (let i = 0; i < count; i++) {
    if (
      offset + 46 > end ||
      view.getUint32(offset, true) !== 0x02014b50 ||
      view.getUint16(offset + 8, true) & 1
    )
      throw new Error("Invalid or encrypted ZIP entry.");
    const entrySize = view.getUint32(offset + 24, true),
      crc = view.getUint32(offset + 16, true);
    if (entrySize === 0xffffffff)
      throw new Error("ZIP64 entries are unsupported.");
    result.push({ size: entrySize, crc });
    offset +=
      46 +
      view.getUint16(offset + 28, true) +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true);
  }
  if (offset !== end) throw new Error("Invalid ZIP directory length.");
  return result;
}
const crcTable = new Uint32Array(256).map((_, i) => {
  let crc = i;
  for (let bit = 0; bit < 8; bit++)
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
export function verifyZipEntry(bytes: Uint8Array, entry: ZipEntry) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  if (bytes.length !== entry.size || (crc ^ 0xffffffff) >>> 0 !== entry.crc)
    throw new Error("ZIP entry has an invalid size or checksum.");
}
