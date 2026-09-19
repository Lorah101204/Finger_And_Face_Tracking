import { describe, expect, it } from 'vitest'
import { GRID_PRESETS, clampGrid, clampWindow, gridLabel, presetIndex } from '../../src/core/grid'

describe('grid', () => {
  it('preset 32 × 18, 64 × 36, 128 × 72', () => {
    expect(GRID_PRESETS).toEqual([
      { cols: 32, rows: 18 },
      { cols: 64, rows: 36 },
      { cols: 128, rows: 72 },
    ])
    expect(presetIndex({ cols: 64, rows: 36 })).toBe(1)
    expect(presetIndex({ cols: 10, rows: 10 })).toBe(-1)
    expect(gridLabel({ cols: 64, rows: 36 })).toBe('64 × 36')
  })

  it('custom kẹp trong 4..256 cột, 4..144 hàng, làm tròn xuống, NaN về cận dưới', () => {
    expect(clampGrid({ cols: 300, rows: 200 })).toEqual({ cols: 256, rows: 144 })
    expect(clampGrid({ cols: 1, rows: 0 })).toEqual({ cols: 4, rows: 4 })
    expect(clampGrid({ cols: 12.9, rows: 7.2 })).toEqual({ cols: 12, rows: 7 })
    expect(clampGrid({ cols: NaN, rows: 10 })).toEqual({ cols: 4, rows: 10 })
  })
})

describe('clampWindow (ROI-00)', () => {
  const grid = { cols: 64, rows: 36 }

  it('cửa sổ trong bảng giữ nguyên, limited = false', () => {
    expect(clampWindow({ col: 10, row: 5, n: 8 }, grid, 3)).toEqual({
      window: { col: 10, row: 5, n: 8 },
      limited: false,
    })
  })

  it('kẹp col, row vào bảng và báo limited', () => {
    expect(clampWindow({ col: -3, row: 2, n: 8 }, grid, 3)).toEqual({
      window: { col: 0, row: 2, n: 8 },
      limited: true,
    })
    expect(clampWindow({ col: 60, row: 33, n: 8 }, grid, 3)).toEqual({
      window: { col: 56, row: 28, n: 8 },
      limited: true,
    })
  })

  it('n kẹp trong [nMin, min(cols, rows)] và giữ vuông', () => {
    expect(clampWindow({ col: 0, row: 0, n: 1 }, grid, 3).window.n).toBe(3)
    expect(clampWindow({ col: 0, row: 0, n: 100 }, grid, 3)).toEqual({
      window: { col: 0, row: 0, n: 36 },
      limited: true,
    })
    expect(clampWindow({ col: 5, row: 5, n: 36 }, grid, 3).window).toEqual({
      col: 5,
      row: 0,
      n: 36,
    })
    expect(clampWindow({ col: 0, row: 0, n: 8 }, { cols: 4, rows: 4 }, 3).window.n).toBe(4)
  })

  it('làm tròn giá trị lẻ', () => {
    expect(clampWindow({ col: 2.4, row: 2.6, n: 7.6 }, grid, 3).window).toEqual({
      col: 2,
      row: 3,
      n: 8,
    })
  })
})
