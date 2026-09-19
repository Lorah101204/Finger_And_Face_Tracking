// CLS-01 bước 2: gói zip "stored" (không nén) thuần TypeScript để tải dataset về máy khi trình duyệt không có File
// System Access API. Không phụ thuộc thư viện, không có gì rời trình duyệt (I9). PNG đã nén nên không cần deflate.
// `listZip` đọc lại thư mục trung tâm (unit test và e2e kiểm gói).
export type ZipEntry = { name: string; data: Uint8Array; mtime?: Date }
export type ZipListed = { name: string; size: number; crc: number; offset: number }

let CRC_TABLE: Uint32Array | null = null

function crcTable(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  CRC_TABLE = t
  return t
}

export function crc32(data: Uint8Array): number {
  const t = crcTable()
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = t[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function dosTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear())
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)
  const date = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  return { time, date }
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** Gói các mục thành zip stored: local header + dữ liệu cho từng mục, thư mục trung tâm, EOCD. Tên UTF-8 (cờ 0x800). */
export function buildZip(entries: readonly ZipEntry[]): Uint8Array {
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const e of entries) {
    const name = encoder.encode(e.name)
    const crc = crc32(e.data)
    const { time, date } = dosTime(e.mtime ?? new Date())
    const local = new Uint8Array(30 + name.length + e.data.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(6, 0x0800, true)
    lv.setUint16(8, 0, true)
    lv.setUint16(10, time, true)
    lv.setUint16(12, date, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, e.data.length, true)
    lv.setUint32(22, e.data.length, true)
    lv.setUint16(26, name.length, true)
    lv.setUint16(28, 0, true)
    local.set(name, 30)
    local.set(e.data, 30 + name.length)
    locals.push(local)

    const central = new Uint8Array(46 + name.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, 0, true)
    cv.setUint16(12, time, true)
    cv.setUint16(14, date, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, e.data.length, true)
    cv.setUint32(24, e.data.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint16(30, 0, true)
    cv.setUint16(32, 0, true)
    cv.setUint16(34, 0, true)
    cv.setUint16(36, 0, true)
    cv.setUint32(38, 0, true)
    cv.setUint32(42, offset, true)
    central.set(name, 46)
    centrals.push(central)
    offset += local.length
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0)
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(4, 0, true)
  ev.setUint16(6, 0, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, cdSize, true)
  ev.setUint32(16, offset, true)
  ev.setUint16(20, 0, true)
  const out = new Uint8Array(offset + cdSize + 22)
  let p = 0
  for (const l of locals) {
    out.set(l, p)
    p += l.length
  }
  for (const c of centrals) {
    out.set(c, p)
    p += c.length
  }
  out.set(eocd, p)
  return out
}

/** Đọc thư mục trung tâm: tên, cỡ, crc và offset local header của từng mục. Ném lỗi khi thiếu EOCD. */
export function listZip(bytes: Uint8Array): ZipListed[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('zip: không có EOCD')
  const count = v.getUint16(eocd + 10, true)
  let p = v.getUint32(eocd + 16, true)
  const out: ZipListed[] = []
  for (let i = 0; i < count; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('zip: thư mục trung tâm hỏng')
    const nameLen = v.getUint16(p + 28, true)
    const extraLen = v.getUint16(p + 30, true)
    const commentLen = v.getUint16(p + 32, true)
    out.push({
      name: decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen)),
      size: v.getUint32(p + 24, true),
      crc: v.getUint32(p + 16, true),
      offset: v.getUint32(p + 42, true),
    })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

/** Dữ liệu của một mục (stored) theo local header tại entry.offset. */
export function readZipEntry(bytes: Uint8Array, entry: ZipListed): Uint8Array {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (v.getUint32(entry.offset, true) !== 0x04034b50) throw new Error('zip: local header hỏng')
  const nameLen = v.getUint16(entry.offset + 26, true)
  const extraLen = v.getUint16(entry.offset + 28, true)
  const start = entry.offset + 30 + nameLen + extraLen
  return bytes.subarray(start, start + entry.size)
}
