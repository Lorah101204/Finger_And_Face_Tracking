// GRID-01: cấu hình lưới, preset và giới hạn custom (mục 3). Cạnh ô và bảng tính ở coords.ts (computeLayout).
import { DEFAULTS } from './config'
import type { RevealWindow } from './types'

export type GridSize = { cols: number; rows: number }

export const GRID_PRESETS: readonly GridSize[] = DEFAULTS.grid.presets
export const GRID_LIMITS = DEFAULTS.grid.custom

/** Kẹp về khoảng cho phép và làm tròn xuống số nguyên; NaN thành cận dưới. */
export function clampGrid(size: GridSize): GridSize {
  const { minCols, maxCols, minRows, maxRows } = GRID_LIMITS
  const cols = Number.isFinite(size.cols) ? Math.floor(size.cols) : minCols
  const rows = Number.isFinite(size.rows) ? Math.floor(size.rows) : minRows
  return {
    cols: Math.min(maxCols, Math.max(minCols, cols)),
    rows: Math.min(maxRows, Math.max(minRows, rows)),
  }
}

/** Chỉ số preset khớp kích thước, hoặc -1 khi là custom. */
export function presetIndex(size: GridSize): number {
  return GRID_PRESETS.findIndex((p) => p.cols === size.cols && p.rows === size.rows)
}

export function gridLabel(size: GridSize): string {
  return `${size.cols} × ${size.rows}`
}

/**
 * ROI-00: kẹp cửa sổ vào bảng, giữ vuông. n trong [nMin, min(cols, rows)], col và row sao cho cửa sổ nằm trọn
 * trong bảng; `limited` khi phải kẹp bất kỳ thành phần nào (mục 4.3 RevealMask.limited).
 */
export function clampWindow(
  win: RevealWindow,
  grid: GridSize,
  nMin: number,
): { window: RevealWindow; limited: boolean } {
  const nMax = Math.max(1, Math.min(grid.cols, grid.rows))
  const lo = Math.min(Math.max(1, nMin), nMax)
  const n = Math.min(nMax, Math.max(lo, Math.round(win.n)))
  const col = Math.min(grid.cols - n, Math.max(0, Math.round(win.col)))
  const row = Math.min(grid.rows - n, Math.max(0, Math.round(win.row)))
  const limited = n !== win.n || col !== win.col || row !== win.row
  return { window: { col, row, n }, limited }
}
