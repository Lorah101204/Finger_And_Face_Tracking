import { describe, expect, it } from 'vitest'
import {
  bboxOfPoints,
  insetRect,
  pointInRect,
  rectContains,
  rectsIntersect,
} from '../../src/core/rect'

// FACE-02: toán hình chữ nhật nửa mở [x, x + w).
const R = { x: 10, y: 20, w: 100, h: 50 }

describe('rect', () => {
  it('insetRect lùi vào mỗi phía, không âm', () => {
    expect(insetRect(R, 5)).toEqual({ x: 15, y: 25, w: 90, h: 40 })
    expect(insetRect(R, 30)).toEqual({ x: 40, y: 50, w: 40, h: 0 })
  })

  it('rectContains: cạnh chạm vẫn là trong; lệch 1 px là ngoài', () => {
    expect(rectContains(R, R)).toBe(true)
    expect(rectContains(R, { x: 10, y: 20, w: 100, h: 50 })).toBe(true)
    expect(rectContains(R, { x: 9, y: 20, w: 100, h: 50 })).toBe(false)
    expect(rectContains(R, { x: 10, y: 20, w: 101, h: 50 })).toBe(false)
  })

  it('rectsIntersect: chạm cạnh không tính là giao', () => {
    expect(rectsIntersect(R, { x: 110, y: 20, w: 10, h: 10 })).toBe(false)
    expect(rectsIntersect(R, { x: 109, y: 20, w: 10, h: 10 })).toBe(true)
    expect(rectsIntersect(R, { x: 0, y: 0, w: 11, h: 21 })).toBe(true)
    expect(rectsIntersect(R, { x: 0, y: 0, w: 10, h: 21 })).toBe(false)
  })

  it('pointInRect: cạnh phải và dưới là ngoài', () => {
    expect(pointInRect({ x: 10, y: 20 }, R)).toBe(true)
    expect(pointInRect({ x: 109.9, y: 69.9 }, R)).toBe(true)
    expect(pointInRect({ x: 110, y: 20 }, R)).toBe(false)
    expect(pointInRect({ x: 10, y: 70 }, R)).toBe(false)
  })

  it('bboxOfPoints: min/max; rỗng thì null', () => {
    expect(bboxOfPoints([])).toBeNull()
    expect(
      bboxOfPoints([
        { x: 3, y: 9 },
        { x: -1, y: 4 },
        { x: 7, y: 5 },
      ]),
    ).toEqual({ x: -1, y: 4, w: 8, h: 5 })
  })
})
