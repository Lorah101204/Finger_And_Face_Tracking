// ROI-03 (D-047, thay quadSolver.ts của D-038): từ các đầu ngón hợp lệ (px stage, số lượng thay đổi theo frame) tính
// đa giác vùng mở = bao lồi của các điểm đã lọc One Euro. Bộ lọc giữ theo khóa điểm (`${trackId}:${tip}`) nên điểm
// xuất hiện lại bắt đầu lọc mới, điểm biến mất bị bỏ bộ lọc; too-small khi cạnh ngắn của hộp bao dưới nMin ô hoặc diện
// tích bao lồi dưới nMin² / 2 ô² (các điểm gần trùng hay gần thẳng hàng), có hysteresis khi đang mở (ngưỡng hạ h ô).
// Không snap, không kẹp: buildMask rasterize đa giác thành tập ô với hysteresis theo ô; điểm ngoài bảng → out-of-board
// (fingertips đã loại, đây là chốt chặn thứ hai). Thuần: trạng thái là record bất biến.
import { convexHull, polygonArea } from '../core/cells'
import { DEFAULTS } from '../core/config'
import { pointInBoard, type Layout } from '../core/coords'
import { bboxOfPoints } from '../core/rect'
import type { Point, Rect } from '../core/types'
import { ONE_EURO_DEFAULTS, stepOneEuro, type OneEuroParams, type OneEuroState } from './oneEuro'

export type HullPoint = { id: string; p: Point }

export type HullSolverOptions = {
  /** mặc định reveal.nMin */
  nMin?: number
  /** mặc định reveal.minPoints */
  minPoints?: number
  /** mặc định reveal.hysteresisCells */
  hysteresisCells?: number
  /** mặc định reveal.oneEuro */
  oneEuro?: OneEuroParams
}

export type HullFilters = Readonly<Record<string, { x: OneEuroState; y: OneEuroState }>>

export type HullSolverState = {
  /** bộ lọc theo khóa điểm; rỗng khi chưa có mẫu */
  filters: HullFilters
  /** lần giải trước có đa giác hợp lệ (mốc hysteresis too-small) */
  open: boolean
}

export const INITIAL_HULL_STATE: HullSolverState = { filters: {}, open: false }

export type HullMeasure = {
  /** số điểm đưa vào */
  points: number
  /** điểm thô và sau lọc, px stage, theo thứ tự đưa vào */
  raw: Point[]
  filtered: Point[]
  /** hộp bao của các điểm đã lọc, px stage */
  bbox: Rect
  /** cạnh ngắn của hộp bao theo ô */
  shortCells: number
  /** diện tích bao lồi theo ô² */
  areaCells: number
}

export type HullSolverResult =
  | { polygon: Point[]; reason?: undefined; state: HullSolverState; measure: HullMeasure }
  | {
      polygon: null
      reason: 'too-small' | 'out-of-board' | 'few-points'
      state: HullSolverState
      measure: HullMeasure | null
    }

export function solveHull(
  points: readonly HullPoint[],
  layout: Layout,
  prev: HullSolverState,
  ts: number,
  opts: HullSolverOptions = {},
): HullSolverResult {
  const h = opts.hysteresisCells ?? DEFAULTS.reveal.hysteresisCells
  const p = opts.oneEuro ?? ONE_EURO_DEFAULTS
  const minPoints = Math.max(3, opts.minPoints ?? DEFAULTS.reveal.minPoints)
  const { c, cols, rows } = layout
  if (points.length < minPoints || c === 0) {
    return { polygon: null, reason: 'few-points', state: prev, measure: null }
  }
  if (!points.every((pt) => pointInBoard(pt.p, layout))) {
    return { polygon: null, reason: 'out-of-board', state: prev, measure: null }
  }
  const nMax = Math.max(1, Math.min(cols, rows))
  const nMin = Math.min(Math.max(1, opts.nMin ?? DEFAULTS.reveal.nMin), nMax)

  const filters: Record<string, { x: OneEuroState; y: OneEuroState }> = {}
  const filtered: Point[] = []
  for (const { id, p: pt } of points) {
    const before = prev.filters[id] ?? null
    const fx = stepOneEuro(before?.x ?? null, pt.x, ts, p)
    const fy = stepOneEuro(before?.y ?? null, pt.y, ts, p)
    filters[id] = { x: fx, y: fy }
    filtered.push({ x: fx.x, y: fy.x })
  }
  const polygon = convexHull(filtered)
  const bbox = bboxOfPoints(filtered) ?? { x: 0, y: 0, w: 0, h: 0 }
  const shortCells = Math.min(bbox.w, bbox.h) / c
  const areaCells = polygon.length >= 3 ? polygonArea(polygon) / (c * c) : 0
  const measure: HullMeasure = {
    points: points.length,
    raw: points.map((q) => ({ x: q.p.x, y: q.p.y })),
    filtered,
    bbox,
    shortCells,
    areaCells,
  }
  // too-small có hysteresis: đang mở thì ngưỡng hạ h ô; mở lại cần đủ nMin.
  const floor = prev.open ? nMin - h : nMin
  if (polygon.length < 3 || shortCells < floor || areaCells < (floor * floor) / 2) {
    return { polygon: null, reason: 'too-small', state: { filters, open: false }, measure }
  }
  return { polygon, state: { filters, open: true }, measure }
}
