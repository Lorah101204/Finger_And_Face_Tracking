import { describe, expect, it } from 'vitest'
import { buildZip, crc32, listZip, readZipEntry } from '../../src/dataset/zip'

// CLS-01 (mục 7.22): zip stored thuần: crc32 chuẩn, thư mục trung tâm đọc lại đúng tên UTF-8, cỡ, offset; dữ liệu
// từng mục đọc lại nguyên vẹn; zip rỗng hợp lệ; byte không phải zip thì ném lỗi.
describe('zip', () => {
  it('crc32 chuẩn (IEEE): "123456789" → 0xCBF43926, rỗng → 0', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
    expect(crc32(new Uint8Array())).toBe(0)
  })

  it('buildZip → listZip: tên tiếng Việt, cỡ, crc, offset tăng dần; readZipEntry trả đúng byte', () => {
    const a = new TextEncoder().encode('xin chào')
    const b = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3])
    const bytes = buildZip([
      { name: 'ses-1/mẫu-0001.json', data: a, mtime: new Date(2026, 8, 18, 10, 30, 0) },
      { name: 'ses-1/mẫu-0001.png', data: b },
    ])
    // Chữ ký local header ở đầu và EOCD ở cuối.
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04])
    expect(Array.from(bytes.subarray(bytes.length - 22, bytes.length - 18))).toEqual([
      0x50, 0x4b, 0x05, 0x06,
    ])
    const list = listZip(bytes)
    expect(list.map((e) => [e.name, e.size])).toEqual([
      ['ses-1/mẫu-0001.json', a.length],
      ['ses-1/mẫu-0001.png', b.length],
    ])
    expect(list[0].offset).toBe(0)
    expect(list[1].offset).toBe(
      30 + new TextEncoder().encode('ses-1/mẫu-0001.json').length + a.length,
    )
    expect(list[0].crc).toBe(crc32(a))
    expect(Array.from(readZipEntry(bytes, list[0]))).toEqual(Array.from(a))
    expect(Array.from(readZipEntry(bytes, list[1]))).toEqual(Array.from(b))
    // Cờ 0x0800 (tên UTF-8) và phương thức 0 (stored) trong local header.
    const v = new DataView(bytes.buffer)
    expect(v.getUint16(6, true)).toBe(0x0800)
    expect(v.getUint16(8, true)).toBe(0)
  })

  it('zip rỗng chỉ có EOCD; byte lạ thì ném lỗi', () => {
    const empty = buildZip([])
    expect(empty.length).toBe(22)
    expect(listZip(empty)).toEqual([])
    expect(() => listZip(new Uint8Array(40))).toThrow(/EOCD/)
  })
})
