// BRAND-01 (D-056, D-057, D-058): lớp logo trên màn che: ảnh logo gốc (SVG bundle qua logoSvg, nạp bằng Image từ blob
// URL cùng origin, I9) vẽ theo hình học của core/brandLogo.ts. Khớp ô (D-058): ba khung vẽ riêng, mỗi khung là một
// drawImage từ rect khung trong SVG (kể cả nửa nét) vào rect ô của khung trên bảng, nên nét khung của SVG nằm đúng trên
// vạch ô và chữ bên trong co giãn theo khung (≤ 5 %). Không khớp: một drawImage LOGO_CROP vào rect cố định. Mỗi layout
// dựng một canvas ngoài màn một lần (không rasterize lại mỗi frame khi vùng mở); compositor vẽ canvas đó bằng một
// drawImage 9 tham số sau vạch lưới (nét khung đè vạch, phần trong suốt vẫn thấy vạch) và trước video: video trong clip
// hợp ô mở đè lên nên ô nào mở thì mất phần logo ở ô đó, mép cắt đi theo ô (khảm). Không phải pixel camera (I4):
// nguồn drawImage duy nhất ở đây là Image của asset bundle và canvas riêng; tools/check-invariants.mjs cho phép file
// này với cùng quy tắc 9 tham số. Chưa nạp xong thì không vẽ gì.
import {
  LOGO_CROP,
  LOGO_FRAMES_SVG,
  LOGO_STROKE,
  logoGeometry,
  logoSvg,
  type LogoGeometry,
  type LogoPlacement,
} from '../core/brandLogo'
import type { Layout } from '../core/coords'
import type { Rect } from '../core/types'

export type LogoLayerOptions = LogoPlacement & {
  fonts: string
  textLength: number
  /** Công tắc "Logo trên màn che" (ui.logo); vòng lặp bỏ lớp khi tắt. */
  enabled: boolean
}

type Canvas2D = OffscreenCanvas | HTMLCanvasElement
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** Canvas của lớp phủ rect logo nới `pad` px mỗi phía (nửa nét khung tràn ra ngoài vạch ô). */
type Painted = {
  layout: Layout
  version: number
  canvas: Canvas2D
  x: number
  y: number
  w: number
  h: number
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
  /** Tăng khi ảnh sẵn sàng; vòng lặp vẽ lại khi thấy khác. */
  #version = 1
  readonly #geometry = new WeakMap<Layout, LogoGeometry | null>()
  #painted: Painted | null = null

  /** `svg`: nội dung SVG gốc (import ?raw); null thì không có logo. */
  constructor(svg: string | null, opts: LogoLayerOptions) {
    this.#opts = { ...opts }
    if (svg && typeof Image !== 'undefined' && typeof Blob !== 'undefined') this.#load(svg)
  }

  #load(svg: string): void {
    const markup = logoSvg(svg, { fonts: this.#opts.fonts, textLength: this.#opts.textLength })
    const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }))
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      this.#img = img
      this.#ready = true
      this.#version++
    }
    img.onerror = () => {
      // Không nạp được: không có logo (màn che trơn).
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
  get enabled(): boolean {
    return this.#opts.enabled
  }
  setEnabled(on: boolean): void {
    this.#opts.enabled = on
  }

  /** Hình học logo cho layout (tính một lần mỗi đối tượng layout); null khi bảng rỗng. */
  geometry(layout: Layout): LogoGeometry | null {
    let g = this.#geometry.get(layout)
    if (g === undefined) {
      g = logoGeometry(layout, this.#opts)
      this.#geometry.set(layout, g)
    }
    return g
  }

  /** Rect logo cho layout; null khi bảng rỗng. */
  rect(layout: Layout): Rect | null {
    return this.geometry(layout)?.rect ?? null
  }

  /** Vẽ lớp logo (đã dựng sẵn) lên ctx; false khi chưa có ảnh hay không có chỗ. */
  draw(ctx: Ctx2D, layout: Layout): boolean {
    const g = this.geometry(layout)
    if (!g || !this.#img) return false
    const p = this.#paint(layout, g)
    if (!p) return false
    ctx.drawImage(p.canvas, 0, 0, p.w, p.h, p.x, p.y, p.w, p.h)
    return true
  }

  #paint(layout: Layout, g: LogoGeometry): Painted | null {
    const hit = this.#painted
    if (hit && hit.layout === layout && hit.version === this.#version) return hit
    const img = this.#img
    if (!img) return null
    // Tỉ lệ px stage trên đơn vị viewBox của từng khung (khớp ô: mỗi khung một tỉ lệ; không khớp: chung).
    const scales = g.frames.map((f, i) => ({
      x: f.w / LOGO_FRAMES_SVG[i].w,
      y: f.h / LOGO_FRAMES_SVG[i].h,
    }))
    const pad =
      Math.ceil((LOGO_STROKE / 2) * Math.max(...scales.map((s) => Math.max(s.x, s.y)))) + 1
    const w = g.rect.w + 2 * pad
    const h = g.rect.h + 2 * pad
    const canvas = createCanvas(w, h)
    const gctx = canvas ? ((canvas as HTMLCanvasElement).getContext('2d') as Ctx2D | null) : null
    if (!canvas || !gctx) return null
    const x = g.rect.x - pad
    const y = g.rect.y - pad
    if (g.snapped) {
      // Từng khung: rect khung SVG nới nửa nét → rect ô nới nửa nét đã co giãn; tâm nét rơi đúng vạch ô.
      g.frames.forEach((f, i) => {
        const src = LOGO_FRAMES_SVG[i]
        const sx = scales[i].x
        const sy = scales[i].y
        gctx.drawImage(
          img,
          src.x - LOGO_STROKE / 2,
          src.y - LOGO_STROKE / 2,
          src.w + LOGO_STROKE,
          src.h + LOGO_STROKE,
          f.x - x - (LOGO_STROKE / 2) * sx,
          f.y - y - (LOGO_STROKE / 2) * sy,
          f.w + LOGO_STROKE * sx,
          f.h + LOGO_STROKE * sy,
        )
      })
    } else {
      gctx.drawImage(
        img,
        LOGO_CROP.x,
        LOGO_CROP.y,
        LOGO_CROP.w,
        LOGO_CROP.h,
        pad,
        pad,
        g.rect.w,
        g.rect.h,
      )
    }
    this.#painted = { layout, version: this.#version, canvas, x, y, w, h }
    return this.#painted
  }
}
