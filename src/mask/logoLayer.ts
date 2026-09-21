// BRAND-01 (D-056): lớp logo trên màn che. Hình học từ core/brandLogo.ts (rect theo bảng, ô theo độ phủ); lớp chữ là
// SVG gốc đã biến đổi (wordmarkSvg) nạp qua Image từ blob URL cùng origin (không có gì rời trình duyệt, I9). Mỗi layout
// dựng một canvas ngoài màn đúng bằng hộp bao các ô logo: tô từng ô màu `fill`, rồi (khi có chữ) clip vào hợp ô và
// drawImage LOGO_CROP của SVG vào rect logo ở cỡ cố định (chữ không bị băm, chỉ bị khối cắt ở lưới thô). Compositor
// vẽ canvas này bằng một drawImage 9 tham số trước vạch lưới. Không phải pixel camera (I4): nguồn drawImage duy nhất ở
// đây là Image của asset bundle và canvas riêng; tools/check-invariants.mjs cho phép file này với cùng quy tắc 9 tham số.
import { LOGO_CROP, logoCells, logoRect, wordmarkSvg, type LogoPlacement } from '../core/brandLogo'
import { cachedCells, type CellSet } from '../core/cells'
import type { Layout } from '../core/coords'
import type { Rect } from '../core/types'

export type LogoLayerOptions = LogoPlacement & {
  minCoverage: number
  fill: string
  text: string
  verify: string
  fonts: string
  textLength: number
  /** Vẽ chữ lên khối (tắt thì chỉ khối đặc: kịch bản e2e đo màu ô). */
  wordmark: boolean
  /** Công tắc "Logo trên màn che" (ui.logo); vòng lặp bỏ lớp khi tắt. */
  enabled: boolean
}

export type LogoGeometry = { rect: Rect; cells: CellSet }

type Canvas2D = OffscreenCanvas | HTMLCanvasElement
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

type Painted = {
  layout: Layout
  version: number
  canvas: Canvas2D
  w: number
  h: number
  x: number
  y: number
}

function createCanvas(w: number, h: number): Canvas2D | null {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    return c
  }
  return null
}

export class LogoLayer {
  readonly #opts: LogoLayerOptions
  #img: HTMLImageElement | null = null
  #ready = false
  /** Tăng khi lớp chữ sẵn sàng hay tùy chọn vẽ đổi; vòng lặp vẽ lại khi thấy khác. */
  #version = 1
  readonly #geometry = new WeakMap<Layout, LogoGeometry | null>()
  #painted: Painted | null = null

  /** `svg`: nội dung SVG gốc (import ?raw); null thì chỉ khối đặc. */
  constructor(svg: string | null, opts: LogoLayerOptions) {
    this.#opts = { ...opts }
    if (svg && typeof Image !== 'undefined' && typeof Blob !== 'undefined') this.#load(svg)
  }

  #load(svg: string): void {
    const markup = wordmarkSvg(svg, {
      text: this.#opts.text,
      verify: this.#opts.verify,
      fonts: this.#opts.fonts,
      textLength: this.#opts.textLength,
    })
    const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }))
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      this.#img = img
      this.#ready = true
      this.#version++
    }
    img.onerror = () => {
      // Không nạp được chữ: giữ khối đặc.
      URL.revokeObjectURL(url)
    }
    img.src = url
  }

  get ready(): boolean {
    return this.#ready
  }
  get version(): number {
    return this.#version
  }
  get wordmark(): boolean {
    return this.#opts.wordmark
  }
  get enabled(): boolean {
    return this.#opts.enabled
  }
  setEnabled(on: boolean): void {
    this.#opts.enabled = on
  }
  setWordmark(on: boolean): void {
    if (on === this.#opts.wordmark) return
    this.#opts.wordmark = on
    this.#version++
  }

  /** Rect và tập ô logo cho layout (tính một lần mỗi đối tượng layout); null khi bảng rỗng hay không ô nào. */
  geometry(layout: Layout): LogoGeometry | null {
    let g = this.#geometry.get(layout)
    if (g === undefined) {
      const rect = logoRect(layout.stage, layout.board, this.#opts)
      const cells = rect ? logoCells(rect, layout, this.#opts.minCoverage) : null
      g = rect && cells && cells.cellCount > 0 ? { rect, cells } : null
      this.#geometry.set(layout, g)
    }
    return g
  }

  /** Vẽ lớp logo (đã dựng sẵn) lên ctx; trả về false khi không có gì để vẽ. */
  draw(ctx: Ctx2D, layout: Layout): boolean {
    const g = this.geometry(layout)
    if (!g) return false
    const p = this.#paint(layout, g)
    if (!p) return false
    ctx.drawImage(p.canvas, 0, 0, p.w, p.h, p.x, p.y, p.w, p.h)
    return true
  }

  #paint(layout: Layout, g: LogoGeometry): Painted | null {
    const hit = this.#painted
    if (hit && hit.layout === layout && hit.version === this.#version) return hit
    const { c, board } = layout
    const { box } = g.cells
    const w = box.w * c
    const h = box.h * c
    const x = board.x + box.col * c
    const y = board.y + box.row * c
    const canvas = createCanvas(w, h)
    const gctx = canvas ? ((canvas as HTMLCanvasElement).getContext('2d') as Ctx2D | null) : null
    if (!canvas || !gctx) return null
    const cells = cachedCells(g.cells)
    gctx.fillStyle = this.#opts.fill
    for (const cell of cells)
      gctx.fillRect((cell.col - box.col) * c, (cell.row - box.row) * c, c, c)
    if (this.#opts.wordmark && this.#img) {
      gctx.save()
      gctx.beginPath()
      for (const cell of cells) gctx.rect((cell.col - box.col) * c, (cell.row - box.row) * c, c, c)
      gctx.clip()
      gctx.drawImage(
        this.#img,
        LOGO_CROP.x,
        LOGO_CROP.y,
        LOGO_CROP.w,
        LOGO_CROP.h,
        g.rect.x - x,
        g.rect.y - y,
        g.rect.w,
        g.rect.h,
      )
      gctx.restore()
    }
    this.#painted = { layout, version: this.#version, canvas, w, h, x, y }
    return this.#painted
  }
}
