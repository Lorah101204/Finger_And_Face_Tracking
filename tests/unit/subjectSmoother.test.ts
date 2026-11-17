import { describe, expect, it } from 'vitest'
import { createSubjectSmoother, sameTarget } from '../../src/classify/subjectSmoother'
import { DEFAULTS } from '../../src/core/config'

// CLS-05 (D-069, mục 7.42): làm mượt xác suất phân loại theo mục tiêu: trung bình các kết quả cùng mục tiêu trong
// windowMs tính lùi từ kết quả mới nhất, tối đa maxResults; đổi mục tiêu thì bắt đầu lại; chỉ ảnh tĩnh, không chuyển động.
const R = { x: 100, y: 100, w: 200, h: 200 }

describe('sameTarget', () => {
  it('cùng mục tiêu khi tâm của mỗi crop nằm trong crop kia và cạnh không đổi quá hai lần', () => {
    expect(sameTarget(R, R)).toBe(true)
    expect(sameTarget(R, { x: 150, y: 120, w: 200, h: 200 })).toBe(true)
    expect(sameTarget(R, { x: 300, y: 100, w: 200, h: 200 })).toBe(false)
    expect(sameTarget(R, { x: 150, y: 150, w: 100, h: 100 })).toBe(true)
    expect(sameTarget(R, { x: 175, y: 175, w: 50, h: 50 })).toBe(false)
    expect(sameTarget(R, { x: 0, y: 0, w: 0, h: 0 })).toBe(false)
  })
})

describe('createSubjectSmoother', () => {
  it('mặc định theo DEFAULTS; chưa có kết quả → null', () => {
    expect(DEFAULTS.classifier.smoothing).toEqual({ windowMs: 1200, maxResults: 4 })
    const s = createSubjectSmoother()
    expect(s.current()).toBeNull()
    expect(s.size).toBe(0)
  })

  it('trung bình theo nhãn của các kết quả cùng mục tiêu; một kết quả lệch không lật nhãn', () => {
    const s = createSubjectSmoother()
    s.push([0.9, 0.1], 0, R)
    s.push([0.8, 0.2], 250, R)
    s.push([0.05, 0.95], 500, R)
    const c = s.current()!
    expect(c.count).toBe(3)
    expect(c.probs[0]).toBeCloseTo((0.9 + 0.8 + 0.05) / 3, 10)
    expect(c.probs[1]).toBeCloseTo((0.1 + 0.2 + 0.95) / 3, 10)
    expect(c.probs[0]).toBeGreaterThan(c.probs[1])
  })

  it('giữ tối đa maxResults kết quả mới nhất và chỉ những kết quả trong windowMs tính từ kết quả mới nhất', () => {
    const s = createSubjectSmoother({ windowMs: 1000, maxResults: 3 })
    for (let i = 0; i < 6; i++) s.push([i / 10, 1 - i / 10], i * 100, R)
    expect(s.size).toBe(3)
    expect(s.current()!.probs[0]).toBeCloseTo((0.3 + 0.4 + 0.5) / 3, 10)
    s.push([1, 0], 1550, R)
    // 1550 − 500 > 1000: các kết quả cũ hết hạn, chỉ còn kết quả mới.
    expect(s.current()).toEqual({ probs: [1, 0], count: 1 })
  })

  it('đổi mục tiêu (mặt khác) hay thời gian lùi thì bắt đầu lại; reset xóa hết', () => {
    const s = createSubjectSmoother()
    s.push([0.9, 0.1], 0, R)
    s.push([0.9, 0.1], 250, R)
    s.push([0.1, 0.9], 500, { x: 600, y: 100, w: 200, h: 200 })
    expect(s.current()).toEqual({ probs: [0.1, 0.9], count: 1 })
    s.push([0.5, 0.5], 400, { x: 600, y: 100, w: 200, h: 200 })
    expect(s.current()!.count).toBe(1)
    s.reset()
    expect(s.current()).toBeNull()
  })

  it('không giữ tham chiếu tới mảng probs và rect của người gọi', () => {
    const s = createSubjectSmoother()
    const p = [0.6, 0.4]
    const r = { ...R }
    s.push(p, 0, r)
    p[0] = 0
    r.x = 9999
    expect(s.current()!.probs).toEqual([0.6, 0.4])
    s.push([0.6, 0.4], 100, R)
    expect(s.current()!.count).toBe(2)
  })
})
