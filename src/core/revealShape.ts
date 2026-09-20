// PERF-02: so sánh hình điều khiển vùng mở theo giá trị. Vòng lặp dùng để biết hình của frame này có đúng bằng hình
// của frame trước không: bằng thì dùng lại RevealMask cũ (rasterize với cùng đa giác và prev là chính nó cho ra đúng
// tập ô cũ: ô đang mở vẫn chạm ô nới rộng, ô đang đóng vẫn không qua ngưỡng bật), không gọi buildMask. Thuần, unit test
// trong Node.
import type { RevealShape } from './types'

export function shapeEquals(a: RevealShape, b: RevealShape): boolean {
  if (a === b) return true
  if (a.kind !== b.kind) return false
  if (a.kind === 'window' && b.kind === 'window') {
    return (
      a.window.col === b.window.col && a.window.row === b.window.row && a.window.n === b.window.n
    )
  }
  if (a.kind === 'polygon' && b.kind === 'polygon') {
    const p = a.polygonStage
    const q = b.polygonStage
    if (p.length !== q.length) return false
    for (let i = 0; i < p.length; i++) if (p[i].x !== q[i].x || p[i].y !== q[i].y) return false
    return true
  }
  return false
}
