// GRID-01: ba không gian tọa độ Cam, Stage, Cell và toàn bộ phép biến đổi (mục 4.1). Nơi duy nhất chứa transform.
// Quy ước: hậu tố Cam (px camera, chưa mirror), Stage (px thiết bị của canvas), Cell (ô lưới). Mirror chỉ là cờ của
// phép biến đổi: không flip video, không flip buffer suy luận (mục 3). Layout mang kích thước camera (D-026).
import type { CellBox, Point, Rect, RevealWindow, Size } from './types'

export type Layout = {
  stage: Size
  cols: number
  rows: number
  /** Cạnh ô, px thiết bị, nguyên. 0 khi stage chưa có kích thước. */
  c: number
  /** Bảng căn giữa stage, nguyên. */
  board: Rect
  /** px stage trên mỗi px camera (cover). 0 khi c = 0. */
  scale: number
  cam: Size
  /** Phần camera thực sự ánh xạ lên bảng (cover cắt phần thừa); số thực, px camera. */
  camVisibleRect: Rect
}

/** c = floor(min(stageW / cols, stageH / rows)); bảng căn giữa; camera phủ kín bảng kiểu cover (mục 3). */
export function computeLayout(
  stage: Size,
  grid: { cols: number; rows: number },
  cam: Size,
): Layout {
  const cols = Math.max(1, Math.floor(grid.cols))
  const rows = Math.max(1, Math.floor(grid.rows))
  const c = Math.max(0, Math.floor(Math.min(stage.w / cols, stage.h / rows)))
  const board: Rect = {
    x: Math.floor((stage.w - cols * c) / 2),
    y: Math.floor((stage.h - rows * c) / 2),
    w: cols * c,
    h: rows * c,
  }
  if (c === 0 || cam.w <= 0 || cam.h <= 0) {
    return {
      stage,
      cols,
      rows,
      c,
      board,
      scale: 0,
      cam,
      camVisibleRect: { x: 0, y: 0, w: Math.max(0, cam.w), h: Math.max(0, cam.h) },
    }
  }
  const scale = Math.max(board.w / cam.w, board.h / cam.h)
  const visW = board.w / scale
  const visH = board.h / scale
  const camVisibleRect: Rect = { x: (cam.w - visW) / 2, y: (cam.h - visH) / 2, w: visW, h: visH }
  return { stage, cols, rows, c, board, scale, cam, camVisibleRect }
}

export function cameraToStage(pCam: Point, layout: Layout, mirror: boolean): Point {
  const { board, scale, camVisibleRect } = layout
  const dx = (pCam.x - camVisibleRect.x) * scale
  const dy = (pCam.y - camVisibleRect.y) * scale
  return { x: mirror ? board.x + board.w - dx : board.x + dx, y: board.y + dy }
}

export function stageToCamera(pStage: Point, layout: Layout, mirror: boolean): Point {
  const { board, scale, camVisibleRect } = layout
  if (scale === 0) return { x: camVisibleRect.x, y: camVisibleRect.y }
  const dx = mirror ? board.x + board.w - pStage.x : pStage.x - board.x
  const dy = pStage.y - board.y
  return { x: camVisibleRect.x + dx / scale, y: camVisibleRect.y + dy / scale }
}

/** Rect camera → rect stage (mirror đảo trục x nên lấy min/max của hai góc). Số thực, không clip. */
export function rectCameraToStage(r: Rect, layout: Layout, mirror: boolean): Rect {
  const a = cameraToStage({ x: r.x, y: r.y }, layout, mirror)
  const b = cameraToStage({ x: r.x + r.w, y: r.y + r.h }, layout, mirror)
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  }
}

/** ROI-02: rect stage nguyên của một hộp ô; các hộp kề nhau chung cạnh, không chồng, không hở. Không clip. */
export function boxToStageRect(box: CellBox, layout: Layout): Rect {
  const { board, c } = layout
  return { x: board.x + box.col * c, y: board.y + box.row * c, w: box.w * c, h: box.h * c }
}

/**
 * ROI-02: rect camera nguyên của một hộp ô: hai góc đối diện ánh xạ qua stageToCamera (mirror đảo trái phải), làm
 * tròn từng cạnh (nên hộp kề nhau vẫn chung cạnh) rồi clip trong khung camera. Compositor, restrictedFrame (kể cả
 * các lỗ từng ô) dùng đúng rect này.
 */
export function boxToCameraRect(box: CellBox, layout: Layout, mirror: boolean): Rect {
  const s = boxToStageRect(box, layout)
  const a = stageToCamera({ x: s.x, y: s.y }, layout, mirror)
  const b = stageToCamera({ x: s.x + s.w, y: s.y + s.h }, layout, mirror)
  const x0 = clamp(Math.round(Math.min(a.x, b.x)), 0, layout.cam.w)
  const x1 = clamp(Math.round(Math.max(a.x, b.x)), 0, layout.cam.w)
  const y0 = clamp(Math.round(Math.min(a.y, b.y)), 0, layout.cam.h)
  const y1 = clamp(Math.round(Math.max(a.y, b.y)), 0, layout.cam.h)
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Rect stage nguyên của cửa sổ vuông (hộp n × n). */
export function windowToStageRect(win: RevealWindow, layout: Layout): Rect {
  return boxToStageRect({ col: win.col, row: win.row, w: win.n, h: win.n }, layout)
}

/** Rect camera nguyên của cửa sổ vuông (xem boxToCameraRect). */
export function windowToCameraRect(win: RevealWindow, layout: Layout, mirror: boolean): Rect {
  return boxToCameraRect({ col: win.col, row: win.row, w: win.n, h: win.n }, layout, mirror)
}

/** Tọa độ ô số thực (dùng cho hysteresis ở ROI-01); Infinity khi c = 0. */
export function stageToCell(pStage: Point, layout: Layout): { colF: number; rowF: number } {
  const { board, c } = layout
  return { colF: (pStage.x - board.x) / c, rowF: (pStage.y - board.y) / c }
}

/** ROI-00: cửa sổ n ô có tâm gần điểm stage nhất (làm tròn theo ô); chưa kẹp vào bảng (clampWindow ở grid.ts). */
export function windowAtCenter(pStage: Point, n: number, layout: Layout): RevealWindow {
  const { colF, rowF } = stageToCell(pStage, layout)
  return { col: Math.round(colF - n / 2), row: Math.round(rowF - n / 2), n }
}

/** Điểm stage nằm trong bảng (biên phải và dưới không tính). */
export function pointInBoard(pStage: Point, layout: Layout): boolean {
  const { board } = layout
  return (
    pStage.x >= board.x &&
    pStage.x < board.x + board.w &&
    pStage.y >= board.y &&
    pStage.y < board.y + board.h
  )
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}
