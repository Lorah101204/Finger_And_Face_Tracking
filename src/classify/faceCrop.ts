// CLS-05 (D-070): crop quanh khuôn mặt cho classifier, thuần. Classifier không còn nhìn cả vùng mở (tay ở các đỉnh bao
// lồi, vai, nền, ô lỗ xám) mà nhìn một hình vuông quanh bbox landmark của mặt đã validate: cạnh = scale × cạnh dài
// bbox, dời vào trong `bounds` (cameraRect của mask) để giữ hình vuông khi được, cạnh vượt bounds thì cắt theo bounds.
// Kết quả luôn là rect nguyên nằm trong bounds, nên restrictedFrame vẫn chỉ đọc pixel của hộp bao vùng mở và tô xám ô
// lỗ như cũ (I1, I3). tools/train/dataset.py (face_crop_box) dùng đúng công thức này; hai bên có cùng ca kiểm thử.
// Chỉ import core/ (I1).
import type { Rect, ValidatedFace } from '../core/types'

/** Math.round của JS (nửa làm tròn lên); Python dùng floor(x + 0,5) cho cùng kết quả. */
const round = (v: number) => Math.round(v)

/**
 * Mặt classifier sẽ nhìn: mặt full lớn nhất (theo diện tích bboxCam); không có mặt full thì partial lớn nhất; null khi
 * không có mặt nào.
 */
export function pickTargetFace(faces: readonly ValidatedFace[]): ValidatedFace | null {
  let best: ValidatedFace | null = null
  const score = (f: ValidatedFace) => (f.status === 'full' ? 1e12 : 0) + f.bboxCam.w * f.bboxCam.h
  for (const f of faces) if (!best || score(f) > score(best)) best = f
  return best
}

/** Một trục: đoạn dài `len` (≤ boundLen) quanh tâm `center`, dời vào [b0, b0 + boundLen]. */
function axis(center: number, side: number, b0: number, boundLen: number): [number, number] {
  const len = Math.min(side, boundLen)
  const start = Math.max(b0, Math.min(b0 + boundLen - len, round(center - len / 2)))
  return [start, len]
}

/**
 * Crop vuông quanh bbox mặt (px camera), nằm trong `bounds` (rect nguyên). null khi bbox rỗng hay bounds rỗng.
 */
export function faceCropRect(face: Rect, bounds: Rect, scale: number): Rect | null {
  if (face.w <= 0 || face.h <= 0 || bounds.w <= 0 || bounds.h <= 0) return null
  const side = Math.max(1, round(Math.max(face.w, face.h) * scale))
  const [x, w] = axis(face.x + face.w / 2, side, bounds.x, bounds.w)
  const [y, h] = axis(face.y + face.h / 2, side, bounds.y, bounds.h)
  return { x, y, w, h }
}

/** Mặt này là mục tiêu của một kết quả phân loại có crop `roiCam`: tâm bbox mặt nằm trong crop. */
export function faceInCrop(face: Rect, roiCam: Rect): boolean {
  const cx = face.x + face.w / 2
  const cy = face.y + face.h / 2
  return cx >= roiCam.x && cx <= roiCam.x + roiCam.w && cy >= roiCam.y && cy <= roiCam.y + roiCam.h
}
