// UX-03 (D-049): hình học của minh họa động trên màn hình bắt đầu (LandingPreview), thuần để unit test trong Node.
// Dùng đúng toán của app: lưới ô vuông căn giữa (công thức GRID-01), bao lồi các đầu ngón (ROI-03, `convexHull`),
// mask là tập ô giao với đa giác (ROI-02, `rasterizePolygon`), mặt full khi hộp mặt nằm trọn trong các ô mở và partial
// khi chỉ giao (FACE-02). Không có camera, không ảnh: "cảnh" trong cửa sổ là hình vẽ.
import {
  convexHull,
  rasterizePolygon,
  stageRectInsideCells,
  stageRectTouchesCells,
  type CellGrid,
  type CellSet,
} from '../core/cells'
import type { CellBox, FingerTip, Handedness, Point, Rect } from '../core/types'

export type SceneVariant = 'hands' | 'window'

export type SceneTip = { p: Point; hand: Handedness; tip: FingerTip }

export type SceneFace = { cx: number; cy: number; rx: number; ry: number; rect: Rect }

export type SceneFrame = {
  cells: CellSet
  /** Bao lồi các đầu ngón (px), null với cửa sổ vuông. */
  polygon: Point[] | null
  /** Hộp ô của cửa sổ vuông, null với bao lồi. */
  box: CellBox | null
  tips: SceneTip[]
  face: SceneFace
  faceStatus: 'full' | 'partial' | 'none'
}

/** Lưới của minh họa: ô vuông cạnh c = floor(min(w / cols, h / rows)), bảng căn giữa (cùng công thức GRID-01). */
export function sceneGrid(w: number, h: number, cols: number, rows: number): CellGrid {
  const c = Math.max(1, Math.floor(Math.min(w / cols, h / rows)))
  const bw = c * cols
  const bh = c * rows
  return {
    cols,
    rows,
    c,
    board: { x: Math.floor((w - bw) / 2), y: Math.floor((h - bh) / 2), w: bw, h: bh },
  }
}

/** Vị trí gốc (đơn vị ô của lưới 64 × 36) của năm đầu ngón mỗi tay: cái, trỏ, giữa, áp út, út. */
const LEFT_TIPS: readonly (readonly [number, number])[] = [
  [22, 25.5],
  [19, 21.5],
  [18, 16.5],
  [19, 12],
  [22, 9],
]
const RIGHT_TIPS: readonly (readonly [number, number])[] = [
  [42, 25.5],
  [45, 21.5],
  [46, 16.5],
  [45, 12],
  [42, 9],
]
const TIPS: readonly FingerTip[] = [4, 8, 12, 16, 20]
/** Biên độ rung của đầu ngón (ô) và tần số (rad/s) đủ thấy đa giác "thở" mà không đổi tập ô liên tục. */
const SWAY_CELLS = 0.35

/** Mười đầu ngón của hai tay giả lập (px stage), rung nhẹ theo thời gian t (giây). */
export function sceneFingertips(t: number, grid: CellGrid): SceneTip[] {
  const out: SceneTip[] = []
  const sx = grid.cols / 64
  const sy = grid.rows / 36
  for (let k = 0; k < 5; k++) {
    const l = LEFT_TIPS[k]
    const r = RIGHT_TIPS[k]
    out.push({
      hand: 'left',
      tip: TIPS[k],
      p: toPx(
        grid,
        (l[0] + Math.sin(t * 0.9 + k) * SWAY_CELLS) * sx,
        (l[1] + Math.cos(t * 0.7 + k * 1.3) * SWAY_CELLS) * sy,
      ),
    })
    out.push({
      hand: 'right',
      tip: TIPS[k],
      p: toPx(
        grid,
        (r[0] + Math.sin(t * 0.8 + k + 2) * SWAY_CELLS) * sx,
        (r[1] + Math.cos(t * 0.6 + k * 1.1) * SWAY_CELLS) * sy,
      ),
    })
  }
  return out
}

function toPx(grid: CellGrid, col: number, row: number): Point {
  return { x: grid.board.x + col * grid.c, y: grid.board.y + row * grid.c }
}

/** Cửa sổ vuông mẫu (kiosk): n ô, trôi quanh khuôn mặt theo quỹ đạo Lissajous, kẹp trong bảng. */
export function sceneWindow(t: number, grid: CellGrid, n: number, anchorX: number): CellBox {
  const size = Math.min(n, grid.cols, grid.rows)
  const cx = grid.cols * anchorX + Math.sin(t * 0.35) * grid.cols * 0.09
  const cy = grid.rows * 0.5 + Math.cos(t * 0.27) * grid.rows * 0.14
  const col = Math.max(0, Math.min(grid.cols - size, Math.round(cx - size / 2)))
  const row = Math.max(0, Math.min(grid.rows - size, Math.round(cy - size / 2)))
  return { col, row, w: size, h: size }
}

/** Khuôn mặt cách điệu: tâm tại anchorX (tỉ lệ chiều rộng bảng) và giữa chiều cao; bán trục theo chiều cao bảng. */
export function sceneFace(grid: CellGrid, anchorX: number): SceneFace {
  const { board } = grid
  const cx = board.x + board.w * anchorX
  const cy = board.y + board.h * 0.5
  const rx = board.h * 0.14
  const ry = board.h * 0.17
  return {
    cx,
    cy,
    rx,
    ry,
    rect: { x: cx - rx * 1.12, y: cy - ry * 1.3, w: rx * 2.24, h: ry * 2.36 },
  }
}

/** Một frame của minh họa: tập ô mở, hình điều khiển và trạng thái mặt theo quy tắc FACE-02. */
export function sceneFrame(
  t: number,
  grid: CellGrid,
  variant: SceneVariant,
  anchorX = 0.5,
): SceneFrame {
  const face = sceneFace(grid, anchorX)
  let cells: CellSet
  let polygon: Point[] | null = null
  let box: CellBox | null = null
  let tips: SceneTip[] = []
  if (variant === 'hands') {
    tips = sceneFingertips(t, grid)
    polygon = convexHull(tips.map((s) => s.p))
    cells = rasterizePolygon(polygon, grid)
  } else {
    box = sceneWindow(t, grid, Math.round(grid.rows * 0.5), anchorX)
    const poly: Point[] = [
      toPx(grid, box.col, box.row),
      toPx(grid, box.col + box.w, box.row),
      toPx(grid, box.col + box.w, box.row + box.h),
      toPx(grid, box.col, box.row + box.h),
    ]
    // Đa giác đúng biên ô: thu vào nửa px để không lấn sang ô kề.
    cells = rasterizePolygon(shrink(poly, 0.5), grid)
  }
  const faceStatus =
    cells.cellCount === 0
      ? 'none'
      : stageRectInsideCells(face.rect, cells, grid)
        ? 'full'
        : stageRectTouchesCells(face.rect, cells, grid)
          ? 'partial'
          : 'none'
  return { cells, polygon, box, tips, face, faceStatus }
}

function shrink(poly: readonly Point[], d: number): Point[] {
  const cx = poly.reduce((a, p) => a + p.x, 0) / poly.length
  const cy = poly.reduce((a, p) => a + p.y, 0) / poly.length
  return poly.map((p) => ({ x: p.x + (p.x < cx ? d : -d), y: p.y + (p.y < cy ? d : -d) }))
}
