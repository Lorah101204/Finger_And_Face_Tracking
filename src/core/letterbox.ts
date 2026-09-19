// MASK-02: toán letterbox thuần, nằm ở core để face/ và classify/ dùng được (D-003). Ảnh model vuông cạnh `size`,
// đệm màu đặc; crop w × h giữ tỉ lệ và đặt giữa. scale = size / max(w, h); dx, dy làm tròn xuống để ảnh không lệch
// nửa pixel; kích thước đích w·scale, h·scale giữ số thực nên ánh xạ ngược chính xác: góc (dx + w·scale, dy + h·scale)
// về đúng (w, h) của crop, tức góc dưới phải của cameraRect.
import type { Point, Rect } from './types'

export type Letterbox = { scale: number; dx: number; dy: number; size: number }

export function computeLetterbox(w: number, h: number, size: number): Letterbox {
  const scale = size / Math.max(w, h)
  return {
    scale,
    dx: Math.floor((size - w * scale) / 2),
    dy: Math.floor((size - h * scale) / 2),
    size,
  }
}

/** px trong ảnh letterbox → px crop (gốc tại góc trên trái roiCam). */
export function letterboxToCrop(p: Point, lb: Letterbox): Point {
  return { x: (p.x - lb.dx) / lb.scale, y: (p.y - lb.dy) / lb.scale }
}

/** px crop → px trong ảnh letterbox. */
export function cropToLetterbox(p: Point, lb: Letterbox): Point {
  return { x: lb.dx + p.x * lb.scale, y: lb.dy + p.y * lb.scale }
}

/** Điểm chuẩn hóa [0, 1] theo ảnh letterbox (đầu ra model) → px camera (cộng roiCam). FACE-02 dùng cho landmarks. */
export function letterboxNormToCam(p: Point, lb: Letterbox, roiCam: Rect): Point {
  const c = letterboxToCrop({ x: p.x * lb.size, y: p.y * lb.size }, lb)
  return { x: roiCam.x + c.x, y: roiCam.y + c.y }
}

/** px camera → px trong ảnh letterbox (kiểm và vẽ ngược). */
export function camToLetterbox(p: Point, lb: Letterbox, roiCam: Rect): Point {
  return cropToLetterbox({ x: p.x - roiCam.x, y: p.y - roiCam.y }, lb)
}
