// ROI-02 (D-038), ROI-03 (D-047): vùng mở là đa giác bao lồi các đầu ngón; mask là tập ô lưới giao với đa giác, kể cả ô chỉ bị
// một cạnh cắt qua. Toán thuần trên px stage và chỉ số ô: sắp bốn đỉnh thành đa giác đơn (theo góc quanh tâm), điểm
// trong đa giác (ray casting), đoạn thẳng cắt hình chữ nhật mở (Liang–Barsky), "đa giác giao ô với diện tích dương",
// và rasterize với hysteresis: ô đang mở chỉ tắt khi đa giác rời khỏi ô nới rộng h ô, ô đang tắt chỉ bật khi đa giác
// lấn vào ô thu hẹp h ô. Không import gì ngoài types (face/ và classify/ dùng được, I1).
import type { CellBox, Point, Rect } from './types'

/** Sắp các điểm theo góc quanh tâm để thành đa giác đơn (không tự cắt); bốn đầu ngón có thể ở thứ tự bất kỳ. */
export function orderPolygon(points: readonly Point[]): Point[] {
  const n = points.length
  if (n < 3) return points.map((p) => ({ x: p.x, y: p.y }))
  const cx = points.reduce((a, p) => a + p.x, 0) / n
  const cy = points.reduce((a, p) => a + p.y, 0) / n
  return points
    .map((p) => ({ x: p.x, y: p.y, a: Math.atan2(p.y - cy, p.x - cx) }))
    .sort((u, v) => u.a - v.a)
    .map(({ x, y }) => ({ x, y }))
}

/**
 * ROI-03: bao lồi (Andrew monotone chain) của một tập điểm, bỏ điểm thẳng hàng trên cạnh; đỉnh theo thứ tự ngược
 * chiều kim đồng hồ trong hệ y hướng xuống. Dưới ba điểm phân biệt thì trả về các điểm còn lại (không phải đa giác).
 */
export function convexHull(points: readonly Point[]): Point[] {
  const pts = points
    .map((p) => ({ x: p.x, y: p.y }))
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .filter((p, i, arr) => i === 0 || p.x !== arr[i - 1].x || p.y !== arr[i - 1].y)
  if (pts.length < 3) return pts
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: Point[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop()
    lower.push(p)
  }
  const upper: Point[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop()
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  const hull = lower.concat(upper)
  return hull.length >= 3 ? hull : pts.slice(0, Math.min(2, pts.length))
}

/** Diện tích (dương) của đa giác theo công thức shoelace. */
export function polygonArea(poly: readonly Point[]): number {
  let s = 0
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    s += poly[j].x * poly[i].y - poly[i].x * poly[j].y
  }
  return Math.abs(s) / 2
}

/** Điểm nằm trong đa giác (ray casting; điểm trên cạnh tính không ổn định, gọi bên ngoài chỉ dùng với điểm trong). */
export function pointInPolygon(p: Point, poly: readonly Point[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

/** Đoạn ab có đi qua phần trong (mở) của hình chữ nhật r không (Liang–Barsky, bất đẳng thức ngặt). */
export function segmentCrossesOpenRect(a: Point, b: Point, r: Rect): boolean {
  if (r.w <= 0 || r.h <= 0) return false
  const dx = b.x - a.x
  const dy = b.y - a.y
  let t0 = 0
  let t1 = 1
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q > 0
    const t = q / p
    if (p < 0) {
      if (t > t1) return false
      if (t > t0) t0 = t
    } else {
      if (t < t0) return false
      if (t < t1) t1 = t
    }
    return true
  }
  if (!clip(-dx, a.x - r.x)) return false
  if (!clip(dx, r.x + r.w - a.x)) return false
  if (!clip(-dy, a.y - r.y)) return false
  if (!clip(dy, r.y + r.h - a.y)) return false
  return t0 < t1
}

function pointInOpenRect(p: Point, r: Rect): boolean {
  return p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h
}

/**
 * Đa giác và hình chữ nhật r có phần chung diện tích dương: một đỉnh đa giác trong r, hoặc một góc r trong đa giác,
 * hoặc một cạnh đa giác đi qua phần trong của r. Chạm cạnh (diện tích 0) không tính.
 */
export function polygonOverlapsRect(poly: readonly Point[], r: Rect): boolean {
  if (r.w <= 0 || r.h <= 0 || poly.length < 3) return false
  for (const p of poly) if (pointInOpenRect(p, r)) return true
  // Góc lùi vào một chút để góc nằm đúng trên cạnh đa giác (chung cạnh, chạm đỉnh) không bị tính là trong.
  const e = 1e-6 * Math.max(1, r.w, r.h)
  const corners: Point[] = [
    { x: r.x + e, y: r.y + e },
    { x: r.x + r.w - e, y: r.y + e },
    { x: r.x + e, y: r.y + r.h - e },
    { x: r.x + r.w - e, y: r.y + r.h - e },
  ]
  for (const c of corners) if (pointInPolygon(c, poly)) return true
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (segmentCrossesOpenRect(poly[j], poly[i], r)) return true
  }
  return false
}

export type CellSet = { box: CellBox; cells: Uint8Array; cellCount: number }

export const EMPTY_CELLS: CellSet = {
  box: { col: 0, row: 0, w: 0, h: 0 },
  cells: new Uint8Array(0),
  cellCount: 0,
}

export function cellAt(set: CellSet, col: number, row: number): boolean {
  const { box, cells } = set
  const i = col - box.col
  const j = row - box.row
  if (i < 0 || j < 0 || i >= box.w || j >= box.h) return false
  return cells[j * box.w + i] === 1
}

export function isFullBox(set: CellSet): boolean {
  return set.cellCount === set.box.w * set.box.h && set.cellCount > 0
}

/**
 * PERF-02: danh sách ô và cạnh biên tính một lần cho mỗi đối tượng CellSet (WeakMap theo đối tượng, tự giải phóng khi
 * mask bị bỏ). Mask được vòng lặp dùng lại qua nhiều frame khi hình không đổi, nên compositor (clip, viền), FrameOutput
 * và landing không rasterize lại danh sách mỗi frame. Kết quả dùng chung: không được sửa tại chỗ.
 */
const CELLS_CACHE = new WeakMap<CellSet, { col: number; row: number }[]>()
const EDGES_CACHE = new WeakMap<CellSet, { grid: CellGrid; edges: CellEdge[] }>()

export function cachedCells(set: CellSet): readonly { col: number; row: number }[] {
  let out = CELLS_CACHE.get(set)
  if (!out) {
    out = listCells(set)
    CELLS_CACHE.set(set, out)
  }
  return out
}

/** Cạnh biên theo grid; grid khác (layout đổi) thì tính lại. */
export function cachedOutlineEdges(set: CellSet, grid: CellGrid): readonly CellEdge[] {
  const hit = EDGES_CACHE.get(set)
  if (hit && hit.grid === grid) return hit.edges
  const edges = cellOutlineEdges(set, grid)
  EDGES_CACHE.set(set, { grid, edges })
  return edges
}

export function listCells(set: CellSet): { col: number; row: number }[] {
  const out: { col: number; row: number }[] = []
  const { box, cells } = set
  for (let j = 0; j < box.h; j++)
    for (let i = 0; i < box.w; i++)
      if (cells[j * box.w + i] === 1) out.push({ col: box.col + i, row: box.row + j })
  return out
}

/** Tập ô của một hộp đầy (cửa sổ vuông của chuột). */
export function boxCells(box: CellBox): CellSet {
  const n = Math.max(0, box.w) * Math.max(0, box.h)
  return { box: { ...box }, cells: new Uint8Array(n).fill(1), cellCount: n }
}

export type RasterizeOptions = {
  /** Tập ô của frame trước (cùng phiên mở) làm mốc hysteresis; null thì mọi ô dùng ngưỡng bật. */
  prev?: CellSet | null
  /** Biên hysteresis theo ô (mặc định 0: đúng hình học). */
  hysteresisCells?: number
}

export type CellGrid = { cols: number; rows: number; c: number; board: Rect }

/**
 * Tập ô giao với đa giác (px stage). Ô đang mở ở prev: giữ khi đa giác còn chạm ô nới rộng h·c mỗi phía; ô khác: bật
 * khi đa giác lấn vào ô thu hẹp h·c mỗi phía. Kết quả gói trong hộp bao nhỏ nhất của các ô mở.
 */
export function rasterizePolygon(
  poly: readonly Point[],
  grid: CellGrid,
  opts: RasterizeOptions = {},
): CellSet {
  const { cols, rows, c, board } = grid
  if (c <= 0 || poly.length < 3) return EMPTY_CELLS
  const h = Math.max(0, opts.hysteresisCells ?? 0)
  const m = h * c
  const prev = opts.prev ?? null
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const p of poly) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y)
    maxY = Math.max(maxY, p.y)
  }
  // Quét hộp bao của đa giác nới thêm một ô (ô đang mở có thể còn chạm nhờ biên nới) và hộp của prev.
  let c0 = Math.max(0, Math.floor((minX - board.x) / c) - 1)
  let c1 = Math.min(cols - 1, Math.floor((maxX - board.x) / c) + 1)
  let r0 = Math.max(0, Math.floor((minY - board.y) / c) - 1)
  let r1 = Math.min(rows - 1, Math.floor((maxY - board.y) / c) + 1)
  if (prev && prev.cellCount > 0) {
    c0 = Math.min(c0, prev.box.col)
    c1 = Math.max(c1, prev.box.col + prev.box.w - 1)
    r0 = Math.min(r0, prev.box.row)
    r1 = Math.max(r1, prev.box.row + prev.box.h - 1)
  }
  if (c1 < c0 || r1 < r0) return EMPTY_CELLS
  const w = c1 - c0 + 1
  const hh = r1 - r0 + 1
  const cells = new Uint8Array(w * hh)
  let count = 0
  let bc0 = Infinity
  let bc1 = -Infinity
  let br0 = Infinity
  let br1 = -Infinity
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      const wasOn = prev !== null && cellAt(prev, col, row)
      const d = wasOn ? -m : m
      const r: Rect = {
        x: board.x + col * c + d,
        y: board.y + row * c + d,
        w: c - 2 * d,
        h: c - 2 * d,
      }
      if (!polygonOverlapsRect(poly, r)) continue
      cells[(row - r0) * w + (col - c0)] = 1
      count++
      bc0 = Math.min(bc0, col)
      bc1 = Math.max(bc1, col)
      br0 = Math.min(br0, row)
      br1 = Math.max(br1, row)
    }
  }
  if (count === 0) return EMPTY_CELLS
  const box: CellBox = { col: bc0, row: br0, w: bc1 - bc0 + 1, h: br1 - br0 + 1 }
  const packed = new Uint8Array(box.w * box.h)
  for (let j = 0; j < box.h; j++)
    for (let i = 0; i < box.w; i++)
      packed[j * box.w + i] = cells[(box.row + j - r0) * w + (box.col + i - c0)]
  return { box, cells: packed, cellCount: count }
}

/** Dải ô [c0, c1] × [r0, r1] mà một rect stage (số thực) chạm tới với diện tích dương; null khi rect rỗng. */
export function cellRangeOfStageRect(
  r: Rect,
  grid: CellGrid,
): { c0: number; c1: number; r0: number; r1: number } | null {
  const { c, board } = grid
  if (c <= 0 || r.w <= 0 || r.h <= 0) return null
  const EPS = 1e-9
  return {
    c0: Math.floor((r.x - board.x) / c + EPS),
    c1: Math.ceil((r.x + r.w - board.x) / c - EPS) - 1,
    r0: Math.floor((r.y - board.y) / c + EPS),
    r1: Math.ceil((r.y + r.h - board.y) / c - EPS) - 1,
  }
}

/** Rect stage nằm trọn trong hợp các ô mở (mọi ô nó chạm đều mở). */
export function stageRectInsideCells(r: Rect, set: CellSet, grid: CellGrid): boolean {
  const g = cellRangeOfStageRect(r, grid)
  if (!g) return false
  for (let row = g.r0; row <= g.r1; row++)
    for (let col = g.c0; col <= g.c1; col++) if (!cellAt(set, col, row)) return false
  return true
}

/** Rect stage có chạm ít nhất một ô mở (diện tích dương). */
export function stageRectTouchesCells(r: Rect, set: CellSet, grid: CellGrid): boolean {
  const g = cellRangeOfStageRect(r, grid)
  if (!g) return false
  for (let row = g.r0; row <= g.r1; row++)
    for (let col = g.c0; col <= g.c1; col++) if (cellAt(set, col, row)) return true
  return false
}

/** Điểm stage nằm trong một ô mở (cạnh phải và dưới không tính). */
export function stagePointInCells(p: Point, set: CellSet, grid: CellGrid): boolean {
  const { c, board } = grid
  if (c <= 0) return false
  const col = Math.floor((p.x - board.x) / c)
  const row = Math.floor((p.y - board.y) / c)
  return cellAt(set, col, row)
}

export type CellEdge = {
  x0: number
  y0: number
  x1: number
  y1: number
  /** phía của ô mà cạnh này thuộc về (để vẽ viền lùi vào trong ô) */
  side: 'left' | 'right' | 'top' | 'bottom'
}

/**
 * Các cạnh biên của hợp ô mở (cạnh ô có ô kề không mở hoặc ngoài hộp), theo px stage, mỗi cạnh dài đúng một ô; dùng
 * để vẽ viền vùng mở.
 */
export function cellOutlineEdges(set: CellSet, grid: CellGrid): CellEdge[] {
  const { c, board } = grid
  const out: CellEdge[] = []
  const { box } = set
  for (let j = 0; j < box.h; j++)
    for (let i = 0; i < box.w; i++) {
      const col = box.col + i
      const row = box.row + j
      if (!cellAt(set, col, row)) continue
      const x = board.x + col * c
      const y = board.y + row * c
      if (!cellAt(set, col - 1, row)) out.push({ x0: x, y0: y, x1: x, y1: y + c, side: 'left' })
      if (!cellAt(set, col + 1, row))
        out.push({ x0: x + c, y0: y, x1: x + c, y1: y + c, side: 'right' })
      if (!cellAt(set, col, row - 1)) out.push({ x0: x, y0: y, x1: x + c, y1: y, side: 'top' })
      if (!cellAt(set, col, row + 1))
        out.push({ x0: x, y0: y + c, x1: x + c, y1: y + c, side: 'bottom' })
    }
  return out
}
