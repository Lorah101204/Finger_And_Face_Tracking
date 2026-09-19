import { describe, expect, it } from 'vitest'
import { createLatencyWindow, EMPTY_LATENCY } from '../../src/core/latency'

// PERF-01 (mục 7.19): cửa sổ trượt p50/p95. Quy ước hạng sorted[floor(p · (n − 1))]: p50 trùng cách tính cũ của
// FaceClient (mục 7.11), p95 của 20 mẫu là mẫu lớn thứ hai.
describe('createLatencyWindow', () => {
  it('rỗng → 0; một mẫu → p50 = p95 = mẫu; thứ tự đẩy vào không ảnh hưởng', () => {
    const w = createLatencyWindow(5)
    expect(w.stats()).toEqual(EMPTY_LATENCY)
    expect(w.percentile(0.5)).toBe(0)
    w.push(40)
    expect(w.stats()).toEqual({ p50: 40, p95: 40, n: 1, last: 40 })
    w.push(10)
    w.push(30)
    expect(w.stats()).toMatchObject({ p50: 30, n: 3, last: 30 })
    expect(w.percentile(0)).toBe(10)
    expect(w.percentile(1)).toBe(40)
  })

  it('p50 = sorted[floor((n − 1) / 2)] như FaceClient; p95 = sorted[floor(0,95 · (n − 1))]', () => {
    const w = createLatencyWindow(20)
    for (let i = 1; i <= 20; i++) w.push(i * 10)
    // sorted = 10..200: p50 = sorted[9] = 100, p95 = sorted[floor(18,05)] = sorted[18] = 190
    expect(w.stats()).toEqual({ p50: 100, p95: 190, n: 20, last: 200 })
    expect(w.percentile(0.5)).toBe(100)
    expect(w.percentile(0.95)).toBe(190)
    expect(w.percentile(2)).toBe(200)
    expect(w.percentile(-1)).toBe(10)
  })

  it('cửa sổ trượt bỏ mẫu cũ nhất; reset về rỗng; size tối thiểu 1', () => {
    const w = createLatencyWindow(3)
    w.push(120)
    w.push(90)
    w.push(30)
    expect(w.stats().p50).toBe(90)
    w.push(20) // [90, 30, 20] → p50 30
    expect(w.stats()).toMatchObject({ p50: 30, n: 3, last: 20 })
    w.push(1000)
    w.push(1000)
    w.push(1000)
    expect(w.stats().p50).toBe(1000)
    w.reset()
    expect(w.stats()).toEqual(EMPTY_LATENCY)
    expect(createLatencyWindow(0).size).toBe(1)
    expect(createLatencyWindow(2.9).size).toBe(2)
  })
})
