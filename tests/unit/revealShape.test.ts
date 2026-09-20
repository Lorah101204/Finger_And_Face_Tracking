import { describe, expect, it } from 'vitest'
import { shapeEquals } from '../../src/core/revealShape'
import type { RevealShape } from '../../src/core/types'

// PERF-02 (mục 7.29): so sánh hình điều khiển theo giá trị để vòng lặp dùng lại mask khi hình không đổi.
const win = (col: number, row: number, n: number): RevealShape => ({
  kind: 'window',
  window: { col, row, n },
})
const poly = (...pts: [number, number][]): RevealShape => ({
  kind: 'polygon',
  polygonStage: pts.map(([x, y]) => ({ x, y })),
})

describe('shapeEquals', () => {
  it('cửa sổ chuột bằng nhau theo col, row, n; khác một thành phần là khác', () => {
    expect(shapeEquals(win(3, 4, 8), win(3, 4, 8))).toBe(true)
    expect(shapeEquals(win(3, 4, 8), win(4, 4, 8))).toBe(false)
    expect(shapeEquals(win(3, 4, 8), win(3, 5, 8))).toBe(false)
    expect(shapeEquals(win(3, 4, 8), win(3, 4, 9))).toBe(false)
  })

  it('đa giác bằng nhau theo từng đỉnh đúng thứ tự; khác số đỉnh, khác tọa độ hay đảo thứ tự là khác', () => {
    const a = poly([0, 0], [10, 0], [10, 10])
    expect(shapeEquals(a, poly([0, 0], [10, 0], [10, 10]))).toBe(true)
    expect(shapeEquals(a, poly([0, 0], [10, 0], [10, 10], [0, 10]))).toBe(false)
    expect(shapeEquals(a, poly([0, 0], [10, 0], [10, 10.5]))).toBe(false)
    expect(shapeEquals(a, poly([10, 0], [0, 0], [10, 10]))).toBe(false)
  })

  it('khác loại là khác; cùng đối tượng là bằng', () => {
    const a = win(0, 0, 4)
    expect(shapeEquals(a, poly([0, 0], [1, 0], [1, 1]))).toBe(false)
    expect(shapeEquals(a, a)).toBe(true)
  })
})
