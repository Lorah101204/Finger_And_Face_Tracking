// BRAND-01 (D-056, sửa D-057, D-058): logo chiến dịch khảm vào màn che. Hình học thuần, không DOM: ba khung của logo là
// thuộc tính rect trong src/assets/logo-verify-human.svg (nét 3,78 px vẽ giữa cạnh); hộp bao mép ngoài của ba khung là
// LOGO_CROP (551,15 × 209,45 đơn vị viewBox, tỉ lệ 2,631). D-058: ba khung nằm trên một lưới module 21 × 8 ô (đơn vị
// = bề rộng khung / 15; sai lệch mọi cạnh ≤ 0,1 ô), nên logo đặt lên đúng lưới bảng với module = k ô thì viền khung
// trùng vạch ô; k chọn để bề rộng gần widthRatio × stage nhất; lưới quá thô (21 k ô vượt snapMaxWidthRatio × stage)
// thì về cỡ cố định theo stage (D-057) không khớp ô. Vùng mở cắt logo theo từng ô vì compositor vẽ video trong clip
// hợp ô mở đè lên. logoSvg() chuẩn bị SVG gốc để nạp qua Image: giữ nguyên khung và màu, chỉ thay dòng chữ sống font
// Heavitas bằng một <text> có textLength để font dự phòng vẫn chiếm đúng bề rộng, và đặt width/height gốc bằng viewBox
// để rect nguồn của drawImage tính theo đơn vị viewBox. Chỉ import trong core/.
import type { CellGrid } from './cells'
import type { Rect, Size } from './types'

export const LOGO_VIEWBOX = { w: 700, h: 400 } as const
/** Bề dày nét khung trong SVG (stroke-width). */
export const LOGO_STROKE = 3.78
/** Màu mực trong SVG gốc: navy (chữ, khung) và xanh lá ("VERIFY:"). */
export const LOGO_NAVY = '#1f3566'
export const LOGO_GREEN = '#99b43e'
/** Ba khung theo thứ tự "VERIFY:", "Human", "AI ETHIC CAMPAIGN" (thuộc tính x, y, width, height của rect). */
export const LOGO_FRAMES_SVG: readonly Rect[] = [
  { x: 231.73, y: 92.8, w: 391.29, h: 77.93 },
  { x: 75.65, y: 170.73, w: 391.29, h: 77.93 },
  { x: 309.77, y: 248.66, w: 313.25, h: 49.81 },
]

function outer(r: Rect, stroke: number): Rect {
  return { x: r.x - stroke / 2, y: r.y - stroke / 2, w: r.w + stroke, h: r.h + stroke }
}

/** Hộp bao của một dãy rect (rỗng → rect 0). */
export function unionRect(rects: readonly Rect[]): Rect {
  if (rects.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const r of rects) {
    x0 = Math.min(x0, r.x)
    y0 = Math.min(y0, r.y)
    x1 = Math.max(x1, r.x + r.w)
    y1 = Math.max(y1, r.y + r.h)
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Hộp bao mép ngoài của ba khung trong đơn vị viewBox: phần SVG được vẽ vào rect logo. */
export const LOGO_CROP: Rect = unionRect(LOGO_FRAMES_SVG.map((r) => outer(r, LOGO_STROKE)))
export const LOGO_ASPECT = LOGO_CROP.w / LOGO_CROP.h
/** Ba khung (mép ngoài) chuẩn hóa trong [0, 1]² theo LOGO_CROP (probe, e2e định vị vùng chữ). */
export const LOGO_FRAMES: readonly Rect[] = LOGO_FRAMES_SVG.map((r) => {
  const o = outer(r, LOGO_STROKE)
  return {
    x: (o.x - LOGO_CROP.x) / LOGO_CROP.w,
    y: (o.y - LOGO_CROP.y) / LOGO_CROP.h,
    w: o.w / LOGO_CROP.w,
    h: o.h / LOGO_CROP.h,
  }
})

/**
 * D-058: lưới module của logo (21 × 8 ô, đơn vị = bề rộng khung / 15 = 26,09 đơn vị viewBox): "VERIFY:" 15 × 3 ô từ cột
 * 6, "Human" 15 × 3 ô từ cột 0, "AI ETHIC CAMPAIGN" 12 × 2 ô từ cột 9 hàng 6. Unit test so với LOGO_FRAMES_SVG (≤ 0,1 ô).
 */
export const LOGO_GRID = { w: 21, h: 8 } as const
export const LOGO_FRAME_CELLS: readonly Rect[] = [
  { x: 6, y: 0, w: 15, h: 3 },
  { x: 0, y: 3, w: 15, h: 3 },
  { x: 9, y: 6, w: 12, h: 2 },
]

export type LogoAnchor = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center'

export type LogoPlacement = {
  /** Bề rộng logo theo bề rộng stage (0 < r ≤ 1). */
  widthRatio: number
  /** Trần chiều cao theo chiều cao stage; vượt thì thu theo tỉ lệ. */
  maxHeightRatio: number
  /** Lề tới mép stage theo bề rộng stage (không dùng với neo giữa). */
  marginRatio: number
  anchor: LogoAnchor
  /** D-058: khớp ô chỉ khi 21 k ô không vượt chừng này bề rộng stage; quá thì về cỡ cố định không khớp ô. */
  snapMaxWidthRatio: number
}

export type LogoGeometry = {
  rect: Rect
  /** Ba khung trong px stage (mép = tâm nét); khớp ô thì mỗi cạnh nằm trên một vạch ô. */
  frames: Rect[]
  snapped: boolean
  /** Cỡ một ô module (k × c px) khi khớp ô; 0 khi không. */
  module: number
}

/**
 * Rect logo (px stage, nguyên): bề rộng widthRatio × bề rộng stage (canvas), chiều cao theo LOGO_ASPECT, trần
 * maxHeightRatio × chiều cao stage; neo theo anchor với lề marginRatio × bề rộng stage tính từ mép stage, rồi kẹp vào
 * bảng (bảng là cols × c căn giữa stage, thiếu tới một ô so với stage tùy preset: đo theo stage thì cỡ và vị trí không
 * đổi theo số ô, kẹp vào bảng để luôn nằm trên ô). null khi bảng rỗng hay logo dưới 1 px.
 */
export function logoRect(stage: Size, board: Rect, p: LogoPlacement): Rect | null {
  if (board.w <= 0 || board.h <= 0 || stage.w <= 0 || stage.h <= 0) return null
  let w = Math.round(stage.w * p.widthRatio)
  let h = Math.round(w / LOGO_ASPECT)
  const maxH = Math.floor(stage.h * p.maxHeightRatio)
  if (h > maxH) {
    h = maxH
    w = Math.round(h * LOGO_ASPECT)
  }
  w = Math.min(w, board.w)
  h = Math.min(h, board.h)
  if (w < 1 || h < 1) return null
  const m = Math.round(stage.w * p.marginRatio)
  const clampX = (x: number) => Math.min(Math.max(x, board.x), board.x + board.w - w)
  const clampY = (y: number) => Math.min(Math.max(y, board.y), board.y + board.h - h)
  const left = clampX(m)
  const right = clampX(stage.w - m - w)
  const top = clampY(m)
  const bottom = clampY(stage.h - m - h)
  const cx = clampX(Math.floor((stage.w - w) / 2))
  const cy = clampY(Math.floor((stage.h - h) / 2))
  switch (p.anchor) {
    case 'top-left':
      return { x: left, y: top, w, h }
    case 'top-right':
      return { x: right, y: top, w, h }
    case 'bottom-left':
      return { x: left, y: bottom, w, h }
    case 'bottom-right':
      return { x: right, y: bottom, w, h }
    case 'center':
      return { x: cx, y: cy, w, h }
  }
}

/** Ba khung trong px stage cho một rect logo. */
export function logoFramesIn(rect: Rect): Rect[] {
  return LOGO_FRAMES.map((f) => ({
    x: rect.x + f.x * rect.w,
    y: rect.y + f.y * rect.h,
    w: f.w * rect.w,
    h: f.h * rect.h,
  }))
}

/**
 * D-058: vị trí logo trên lưới bảng. Khớp ô: module k = round(widthRatio × stage.w / (21 c)) ≥ 1, logo 21 k × 8 k ô
 * tại góc theo anchor với lề round(marginRatio × stage.w / c) ô, kẹp vào bảng; ba khung là LOGO_FRAME_CELLS nhân k c
 * nên mọi cạnh khung nằm trên vạch ô. Không khớp (c = 0, 21 k ô quá snapMaxWidthRatio × stage, vượt trần chiều cao
 * hay không đủ ô): rect cố định theo stage (logoRect) với ba khung theo tỉ lệ SVG. null khi bảng rỗng.
 */
export function logoGeometry(
  grid: CellGrid & { stage: Size },
  p: LogoPlacement,
): LogoGeometry | null {
  const { stage, board, c, cols, rows } = grid
  if (c > 0 && stage.w > 0 && stage.h > 0) {
    const k = Math.max(1, Math.round((p.widthRatio * stage.w) / (LOGO_GRID.w * c)))
    const wCells = LOGO_GRID.w * k
    const hCells = LOGO_GRID.h * k
    const w = wCells * c
    const h = hCells * c
    if (
      w <= p.snapMaxWidthRatio * stage.w &&
      h <= p.maxHeightRatio * stage.h &&
      wCells <= cols &&
      hCells <= rows
    ) {
      const m = Math.round((p.marginRatio * stage.w) / c)
      const clampC = (v: number) => Math.min(Math.max(v, 0), cols - wCells)
      const clampR = (v: number) => Math.min(Math.max(v, 0), rows - hCells)
      const left = clampC(m)
      const right = clampC(cols - m - wCells)
      const top = clampR(m)
      const bottom = clampR(rows - m - hCells)
      const cx = clampC(Math.floor((cols - wCells) / 2))
      const cy = clampR(Math.floor((rows - hCells) / 2))
      const at: Record<LogoAnchor, [number, number]> = {
        'top-left': [left, top],
        'top-right': [right, top],
        'bottom-left': [left, bottom],
        'bottom-right': [right, bottom],
        center: [cx, cy],
      }
      const [col0, row0] = at[p.anchor]
      const rect: Rect = { x: board.x + col0 * c, y: board.y + row0 * c, w, h }
      const u = k * c
      const frames = LOGO_FRAME_CELLS.map((f) => ({
        x: rect.x + f.x * u,
        y: rect.y + f.y * u,
        w: f.w * u,
        h: f.h * u,
      }))
      return { rect, frames, snapped: true, module: u }
    }
  }
  const rect = logoRect(stage, board, p)
  return rect ? { rect, frames: logoFramesIn(rect), snapped: false, module: 0 } : null
}

export type LogoTextOptions = {
  /** Chuỗi font-family cho dòng chữ sống (font gốc trước, dự phòng sau). */
  fonts: string
  /** Bề rộng dòng chữ trong đơn vị viewBox; font dự phòng bị ép vào đúng bề rộng này. */
  textLength: number
}

/**
 * SVG để nạp qua Image từ SVG logo gốc: khung, path và màu giữ nguyên; mỗi <text> (dòng chữ sống với tspan giãn chữ
 * cho font Heavitas) thành một <text> phẳng cùng class, cùng transform, có textLength/lengthAdjust và font-family nội
 * tuyến; gốc <svg> có width/height bằng viewBox (Chrome lấy cỡ nội tại của SVG không có width/height là 300 × 150 theo
 * tỉ lệ viewBox, làm rect nguồn của drawImage lệch). Thuần chuỗi, không phụ thuộc tên lớp.
 */
export function logoSvg(source: string, opts: LogoTextOptions): string {
  let s = source.replace(/<text([^>]*)>([\s\S]*?)<\/text>/g, (_m, attrs: string, inner: string) => {
    const text = inner
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    const cls = /class="([^"]*)"/.exec(attrs)?.[1]
    const tf = /transform="([^"]*)"/.exec(attrs)?.[1]
    const a = [
      cls ? `class="${cls}"` : '',
      tf ? `transform="${tf}"` : '',
      `textLength="${opts.textLength}"`,
      'lengthAdjust="spacingAndGlyphs"',
      `style="font-family:${opts.fonts.replace(/"/g, "'")}"`,
    ]
      .filter(Boolean)
      .join(' ')
    return `<text ${a}>${text}</text>`
  })
  s = s.replace(/<svg\b([^>]*)>/, (m, attrs: string) => {
    if (/\swidth=/.test(attrs)) return m
    const vb = /viewBox="\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)\s*"/.exec(attrs)
    const w = vb ? vb[1] : String(LOGO_VIEWBOX.w)
    const h = vb ? vb[2] : String(LOGO_VIEWBOX.h)
    return `<svg width="${w}" height="${h}"${attrs}>`
  })
  return s
}
