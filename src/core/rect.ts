// FACE-02: toán hình chữ nhật thuần (px). Cạnh phải và dưới không tính vào trong: [x, x + w) × [y, y + h).
import type { Point, Rect } from './types'

export function insetRect(r: Rect, m: number): Rect {
  return { x: r.x + m, y: r.y + m, w: Math.max(0, r.w - 2 * m), h: Math.max(0, r.h - 2 * m) }
}

/** inner nằm trọn trong outer (cạnh chạm vẫn tính là trong). */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  )
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

export function pointInRect(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h
}

/** Hộp bao nhỏ nhất của các điểm; null khi không có điểm. */
export function bboxOfPoints(pts: readonly Point[]): Rect | null {
  if (pts.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/**
 * CLS-05, CLS-06: hai rect (crop hay bbox mặt ở hai thời điểm) là cùng một mục tiêu: tâm của mỗi rect nằm trong rect kia
 * (cạnh chạm vẫn tính) và cạnh ngắn không đổi quá hai lần. Dùng để bộ làm mượt xác suất và bộ phát hiện chớp mắt không
 * gộp hai mặt khác nhau.
 */
export function rectsSameTarget(a: Rect, b: Rect): boolean {
  const inside = (r: Rect, x: number, y: number) =>
    x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h
  const sa = Math.min(a.w, a.h)
  const sb = Math.min(b.w, b.h)
  if (sa <= 0 || sb <= 0) return false
  const ratio = sa > sb ? sa / sb : sb / sa
  return (
    ratio <= 2 && inside(a, b.x + b.w / 2, b.y + b.h / 2) && inside(b, a.x + a.w / 2, a.y + a.h / 2)
  )
}
