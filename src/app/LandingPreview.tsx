import { useEffect, useRef } from 'react'
import { subjectText } from '../classify/subjectRule'
import { cellOutlineEdges, listCells, type CellGrid } from '../core/cells'
import {
  FACE_FULL_COLOR,
  FACE_PARTIAL_COLOR,
  FINGER_COLORS,
  GRID_LINE_COLOR,
  WINDOW_OUTLINE_COLOR,
} from '../mask/compositor'
import { sceneFrame, sceneGrid, type SceneFrame, type SceneVariant } from './landingScene'

// UX-03 (D-049, thay minh họa SVG tĩnh của UX-02): minh họa động của màn hình bắt đầu vẽ bằng canvas 2D, không camera,
// không ảnh, không drawImage (check:invariants): bảng trắng chia ô, hai tay giả lập với mười đầu ngón rung nhẹ mở một
// bao lồi (variant `hands`, thẻ minh họa) hoặc một cửa sổ vuông trôi quanh khuôn mặt (variant `window`, nền kiosk);
// chỉ các ô mở hiện "cảnh" (một người cách điệu), ngoài cửa sổ luôn trắng; bbox mặt full hay partial theo FACE-02.
// Trang trí: aria-hidden, mô tả nằm ở figcaption của LandingPage. Tôn trọng prefers-reduced-motion (một khung tĩnh).
export function LandingPreview({
  variant = 'hands',
  cols = variant === 'hands' ? 32 : 64,
  rows = variant === 'hands' ? 18 : 36,
  anchorX = 0.5,
  className,
}: {
  variant?: SceneVariant
  cols?: number
  rows?: number
  /** Vị trí khuôn mặt theo tỉ lệ chiều rộng bảng (kiosk đặt lệch phải để thẻ đồng ý không che). */
  anchorX?: number
  className?: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let reduced = false
    try {
      reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    } catch {
      // matchMedia thiếu (môi trường test): coi như có chuyển động.
    }
    const t0 = performance.now()
    let raf = 0
    let last = 0
    const paint = (now: number) => {
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const W = Math.max(1, Math.round(rect.width))
      const H = Math.max(1, Math.round(rect.height))
      if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
        canvas.width = W * dpr
        canvas.height = H * dpr
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const grid = sceneGrid(W, H, cols, rows)
      const t = reduced ? 1.2 : (now - t0) / 1000
      drawFrame(ctx, W, H, grid, sceneFrame(t, grid, variant, anchorX))
    }
    const loop = (now: number) => {
      // Khoảng 30 khung/giây là đủ cho chuyển động chậm; tiết kiệm CPU cho trang chào.
      if (now - last >= 33) {
        last = now
        paint(now)
      }
      raf = requestAnimationFrame(loop)
    }
    paint(t0)
    if (!reduced) raf = requestAnimationFrame(loop)
    const ro = new ResizeObserver(() => paint(performance.now()))
    ro.observe(canvas)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [variant, cols, rows, anchorX])

  return (
    <canvas
      ref={ref}
      className={className}
      aria-hidden="true"
      data-testid="landing-preview"
      data-variant={variant}
    />
  )
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  grid: CellGrid,
  frame: SceneFrame,
): void {
  const { board, c, cols, rows } = grid
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = GRID_LINE_COLOR
  for (let i = 0; i <= cols; i++)
    ctx.fillRect(board.x + i * c - (i === cols ? 1 : 0), board.y, 1, board.h)
  for (let j = 0; j <= rows; j++)
    ctx.fillRect(board.x, board.y + j * c - (j === rows ? 1 : 0), board.w, 1)

  const cells = listCells(frame.cells)
  if (cells.length > 0) {
    ctx.save()
    ctx.beginPath()
    for (const cl of cells) ctx.rect(board.x + cl.col * c, board.y + cl.row * c, c, c)
    ctx.clip()
    drawScene(ctx, grid, frame)
    ctx.restore()

    // Viền cửa sổ 2 px nằm trọn trong ô mở, như drawWindowOutline của compositor; đa giác nét đứt mảnh.
    ctx.strokeStyle = WINDOW_OUTLINE_COLOR
    ctx.lineWidth = 2
    if (frame.box) {
      const b = frame.box
      ctx.strokeRect(board.x + b.col * c + 1, board.y + b.row * c + 1, b.w * c - 2, b.h * c - 2)
    } else {
      ctx.beginPath()
      for (const e of cellOutlineEdges(frame.cells, grid)) {
        const dx = e.side === 'left' ? 1 : e.side === 'right' ? -1 : 0
        const dy = e.side === 'top' ? 1 : e.side === 'bottom' ? -1 : 0
        ctx.moveTo(e.x0 + dx, e.y0 + dy)
        ctx.lineTo(e.x1 + dx, e.y1 + dy)
      }
      ctx.stroke()
    }
    if (frame.polygon && frame.polygon.length >= 3) {
      ctx.lineWidth = 1
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      frame.polygon.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
      ctx.closePath()
      ctx.stroke()
      ctx.setLineDash([])
    }
    if (frame.faceStatus !== 'none') drawFaceBox(ctx, grid, frame, cells)
  }

  // Chấm đầu ngón màu theo tay (ROI-03), viền trắng để nổi trên vạch lưới.
  const r = Math.max(4, c * 0.3)
  for (const s of frame.tips) {
    ctx.fillStyle = FINGER_COLORS[s.hand]
    ctx.beginPath()
    ctx.arc(s.p.x, s.p.y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = '#fff'
    ctx.stroke()
  }
}

/** "Cảnh camera" cách điệu: nền, sàn, vai, đầu, tóc, mắt, miệng; chỉ thấy qua clip các ô mở. */
function drawScene(ctx: CanvasRenderingContext2D, grid: CellGrid, frame: SceneFrame): void {
  const { board } = grid
  const { cx, cy, rx, ry } = frame.face
  ctx.fillStyle = '#dfe8f5'
  ctx.fillRect(board.x, board.y, board.w, board.h)
  ctx.fillStyle = '#c9d7ec'
  ctx.fillRect(board.x, board.y + board.h * 0.62, board.w, board.h * 0.38)
  ctx.fillStyle = '#6f8fb8'
  ellipse(ctx, cx, board.y + board.h * 1.05, board.h * 0.5, board.h * 0.4)
  ctx.fillStyle = '#f2c9a8'
  ellipse(ctx, cx, cy, rx, ry)
  ctx.fillStyle = '#5b4636'
  ctx.beginPath()
  ctx.moveTo(cx - rx * 1.05, cy - ry * 0.3)
  ctx.quadraticCurveTo(cx, cy - ry * 1.55, cx + rx * 1.05, cy - ry * 0.3)
  ctx.quadraticCurveTo(cx + rx * 0.9, cy - ry * 0.75, cx, cy - ry * 0.8)
  ctx.quadraticCurveTo(cx - rx * 0.9, cy - ry * 0.75, cx - rx * 1.05, cy - ry * 0.3)
  ctx.fill()
  ctx.fillStyle = '#3b2e25'
  const eye = Math.max(1.5, ry * 0.07)
  ellipse(ctx, cx - rx * 0.38, cy - ry * 0.1, eye, eye)
  ellipse(ctx, cx + rx * 0.38, cy - ry * 0.1, eye, eye)
  ctx.strokeStyle = '#3b2e25'
  ctx.lineWidth = Math.max(1.5, ry * 0.05)
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(cx - rx * 0.32, cy + ry * 0.4)
  ctx.quadraticCurveTo(cx, cy + ry * 0.62, cx + rx * 0.32, cy + ry * 0.4)
  ctx.stroke()
}

function ellipse(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
): void {
  ctx.beginPath()
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
  ctx.fill()
}

/** bbox mặt như FACE-02: full nét liền kèm nhãn phân loại (CLS-02), partial nét đứt; chỉ trong ô mở. */
function drawFaceBox(
  ctx: CanvasRenderingContext2D,
  grid: CellGrid,
  frame: SceneFrame,
  cells: { col: number; row: number }[],
): void {
  const { board, c } = grid
  const f = frame.face
  const full = frame.faceStatus === 'full'
  const color = full ? FACE_FULL_COLOR : FACE_PARTIAL_COLOR
  ctx.save()
  ctx.beginPath()
  for (const cl of cells) ctx.rect(board.x + cl.col * c, board.y + cl.row * c, c, c)
  ctx.clip()
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.setLineDash(full ? [] : [6, 4])
  ctx.strokeRect(f.rect.x, f.rect.y, f.rect.w, f.rect.h)
  ctx.setLineDash([])
  ctx.fillStyle = color
  for (let a = 0; a < 12; a++) {
    const ang = (a / 12) * Math.PI * 2
    ellipse(ctx, f.cx + Math.cos(ang) * f.rx * 0.85, f.cy + Math.sin(ang) * f.ry * 0.85, 2, 2)
  }
  if (full) {
    const label = subjectText({ subjectType: 'person', confidence: 0.93 })
    ctx.font = 'bold 12px system-ui, sans-serif'
    const tw = ctx.measureText(label).width + 12
    ctx.fillRect(f.rect.x, f.rect.y - 18, tw, 18)
    ctx.fillStyle = '#fff'
    ctx.fillText(label, f.rect.x + 6, f.rect.y - 5)
  }
  ctx.restore()
}
