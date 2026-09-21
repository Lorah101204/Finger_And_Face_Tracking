// BRAND-01 (D-056): logo chiến dịch khảm vào màn che. Hình học thuần, không DOM: ba khung của logo là thuộc tính rect
// trong src/assets/logo-verify-human.svg (nét 3,78 px vẽ giữa cạnh); hợp mép ngoài của ba khung là bóng logo và hộp
// bao của nó là LOGO_CROP (551,15 × 209,45 đơn vị viewBox, tỉ lệ 2,631). Rect logo tính từ cỡ stage (tỉ lệ bề rộng,
// trần chiều cao, lề, neo góc) rồi kẹp vào bảng, không đọc cols/rows, nên cỡ hiển thị không đổi theo số ô; ô logo là ô có ít nhất
// minCoverage diện tích nằm dưới hợp ba khung (chính xác cho hình chữ nhật: bao hàm–loại trừ). wordmarkSvg() dựng lớp
// chữ từ SVG gốc: bỏ khung (lớp fill:none), mực navy → màu chữ, mực xanh lá → màu VERIFY, dòng chữ sống font Heavitas
// thay bằng một <text> có textLength để font dự phòng vẫn chiếm đúng bề rộng, gốc <svg> có width/height bằng viewBox
// để rect nguồn của drawImage tính theo đơn vị viewBox. Chỉ import trong core/.
import { EMPTY_CELLS, type CellGrid, type CellSet } from './cells'
import type { CellBox, Rect, Size } from './types'

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
/** Ba khung (mép ngoài) chuẩn hóa trong [0, 1]² theo LOGO_CROP. */
export const LOGO_FRAMES: readonly Rect[] = LOGO_FRAMES_SVG.map((r) => {
  const o = outer(r, LOGO_STROKE)
  return {
    x: (o.x - LOGO_CROP.x) / LOGO_CROP.w,
    y: (o.y - LOGO_CROP.y) / LOGO_CROP.h,
    w: o.w / LOGO_CROP.w,
    h: o.h / LOGO_CROP.h,
  }
})

export type LogoAnchor = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center'

export type LogoPlacement = {
  /** Bề rộng logo theo bề rộng bảng (0 < r ≤ 1). */
  widthRatio: number
  /** Trần chiều cao theo chiều cao bảng; vượt thì thu theo tỉ lệ. */
  maxHeightRatio: number
  /** Lề tới mép bảng theo bề rộng bảng (không dùng với neo giữa). */
  marginRatio: number
  anchor: LogoAnchor
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

function intersect(a: Rect, b: Rect): Rect | null {
  const x0 = Math.max(a.x, b.x)
  const y0 = Math.max(a.y, b.y)
  const x1 = Math.min(a.x + a.w, b.x + b.w)
  const y1 = Math.min(a.y + a.h, b.y + b.h)
  if (x1 <= x0 || y1 <= y0) return null
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/**
 * Phần diện tích của `cell` nằm dưới hợp các khung (0 đến 1), bao hàm–loại trừ trên mọi tổ hợp khung (ba khung: bảy
 * số hạng); chính xác vì giao của các hình chữ nhật song song trục vẫn là hình chữ nhật.
 */
export function coverage(frames: readonly Rect[], cell: Rect): number {
  if (cell.w <= 0 || cell.h <= 0) return 0
  const parts = frames.map((f) => intersect(f, cell)).filter((r): r is Rect => r !== null)
  const n = parts.length
  let area = 0
  for (let mask = 1; mask < 1 << n; mask++) {
    let acc: Rect | null = null
    let bits = 0
    let empty = false
    for (let i = 0; i < n; i++) {
      if (!(mask & (1 << i))) continue
      bits++
      const next: Rect | null = acc === null ? parts[i] : intersect(acc, parts[i])
      if (next === null) {
        empty = true
        break
      }
      acc = next
    }
    if (!empty && acc) area += (bits % 2 === 1 ? 1 : -1) * acc.w * acc.h
  }
  return area / (cell.w * cell.h)
}

/**
 * Tập ô logo trên lưới: ô có ít nhất minCoverage diện tích dưới hợp ba khung của `rect`. Quét đúng dải ô mà rect chạm;
 * kết quả gói trong hộp bao nhỏ nhất như rasterizePolygon. EMPTY_CELLS khi c = 0 hay không ô nào đạt.
 */
export function logoCells(rect: Rect, grid: CellGrid, minCoverage = 0.5): CellSet {
  const { cols, rows, c, board } = grid
  if (c <= 0 || rect.w <= 0 || rect.h <= 0) return EMPTY_CELLS
  const frames = logoFramesIn(rect)
  const c0 = Math.max(0, Math.floor((rect.x - board.x) / c))
  const c1 = Math.min(cols - 1, Math.ceil((rect.x + rect.w - board.x) / c) - 1)
  const r0 = Math.max(0, Math.floor((rect.y - board.y) / c))
  const r1 = Math.min(rows - 1, Math.ceil((rect.y + rect.h - board.y) / c) - 1)
  if (c1 < c0 || r1 < r0) return EMPTY_CELLS
  const w = c1 - c0 + 1
  const h = r1 - r0 + 1
  const cells = new Uint8Array(w * h)
  let count = 0
  let bc0 = Infinity
  let bc1 = -Infinity
  let br0 = Infinity
  let br1 = -Infinity
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      const cell: Rect = { x: board.x + col * c, y: board.y + row * c, w: c, h: c }
      if (coverage(frames, cell) + 1e-9 < minCoverage) continue
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

export type WordmarkColors = {
  /** Màu thay cho mực navy (chữ "Human", dòng chiến dịch). */
  text: string
  /** Màu thay cho mực xanh lá ("VERIFY:"). */
  verify: string
  /** Chuỗi font-family cho dòng chữ sống (font gốc trước, dự phòng sau). */
  fonts: string
  /** Bề rộng dòng chữ trong đơn vị viewBox; font dự phòng bị ép vào đúng bề rộng này. */
  textLength: number
}

/**
 * SVG lớp chữ từ SVG logo gốc: bỏ mọi <rect> thuộc lớp có fill:none (khung), đổi màu mực navy và xanh lá theo
 * `colors`, thay <text> (dòng chữ sống với tspan giãn chữ cho font Heavitas) bằng một <text> phẳng cùng class, cùng
 * transform, có textLength/lengthAdjust và font-family nội tuyến. Thuần chuỗi, không phụ thuộc tên lớp.
 */
export function wordmarkSvg(source: string, colors: WordmarkColors): string {
  let s = source
  const style = /<style>([\s\S]*?)<\/style>/.exec(s)?.[1] ?? ''
  const noFill = new Set<string>()
  for (const m of style.matchAll(/((?:\.[\w-]+\s*,\s*)*\.[\w-]+)\s*\{([^}]*)\}/g)) {
    if (!/fill\s*:\s*none/i.test(m[2])) continue
    for (const cls of m[1].split(',')) noFill.add(cls.trim().slice(1))
  }
  for (const cls of noFill) {
    s = s.replace(new RegExp(`<rect\\s+class="${cls}"[^>]*?/>`, 'g'), '')
  }
  s = s.replace(new RegExp(`fill\\s*:\\s*${LOGO_NAVY}`, 'gi'), `fill:${colors.text}`)
  s = s.replace(new RegExp(`fill\\s*:\\s*${LOGO_GREEN}`, 'gi'), `fill:${colors.verify}`)
  s = s.replace(/<text([^>]*)>([\s\S]*?)<\/text>/g, (_m, attrs: string, inner: string) => {
    const text = inner
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    const cls = /class="([^"]*)"/.exec(attrs)?.[1]
    const tf = /transform="([^"]*)"/.exec(attrs)?.[1]
    const a = [
      cls ? `class="${cls}"` : '',
      tf ? `transform="${tf}"` : '',
      `textLength="${colors.textLength}"`,
      'lengthAdjust="spacingAndGlyphs"',
      `style="font-family:${colors.fonts.replace(/"/g, "'")}"`,
    ]
      .filter(Boolean)
      .join(' ')
    return `<text ${a}>${text}</text>`
  })
  // Chrome lấy cỡ nội tại của SVG không có width/height là 300 × 150 theo tỉ lệ viewBox, nên rect nguồn của
  // drawImage (đơn vị viewBox) sẽ lệch: đặt width/height bằng viewBox để một đơn vị viewBox là một px nguồn.
  s = s.replace(/<svg\b([^>]*)>/, (m, attrs: string) => {
    if (/\swidth=/.test(attrs)) return m
    const vb = /viewBox="\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)\s*"/.exec(attrs)
    const w = vb ? vb[1] : String(LOGO_VIEWBOX.w)
    const h = vb ? vb[2] : String(LOGO_VIEWBOX.h)
    return `<svg width="${w}" height="${h}"${attrs}>`
  })
  return s
}
