// ROI-00: cửa sổ điều khiển bằng chuột, chế độ debug và nguồn cho e2e (giữ vĩnh viễn, mục 6 ROI-00 bước 4).
// Bấm trên bảng mở cửa sổ tại con trỏ; kéo để dời; lăn chuột đổi n quanh tâm; Esc đóng; Space mở lại.
// Kẹp trong bảng, luôn vuông, báo `limited` (clampWindow). Không có tọa độ trần: chuyển CSS px sang px stage
// theo tỷ lệ canvas.width / rect.width rồi dùng windowAtCenter của coords.ts.
import { DEFAULTS } from '../core/config'
import { windowAtCenter, windowToStageRect, type Layout } from '../core/coords'
import { clampWindow } from '../core/grid'
import type { Point, RevealWindow } from '../core/types'
import { noWindow, type WindowSample, type WindowSource } from './windowSource'

export type MouseWindowOptions = {
  getLayout: () => Layout
  nMin?: number
  initialN?: number
}

const EDIT_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'])

export class MouseWindowSource implements WindowSource {
  readonly kind = 'mouse' as const
  #getLayout: () => Layout
  #nMin: number
  #n: number
  #open = false
  #col = 0
  #row = 0
  /** Tâm mong muốn theo px stage; giữ lại để đổi n phóng quanh tâm và để Space mở lại đúng chỗ. */
  #center: Point | null = null
  #canvas: HTMLCanvasElement | null = null
  #dragging = false
  /** Layout của lần đặt cửa sổ gần nhất: layout đổi (lưới, resize) thì đặt lại từ tâm để cửa sổ giữ chỗ trên màn hình. */
  #placedLayout: Layout | null = null

  constructor(opts: MouseWindowOptions) {
    this.#getLayout = opts.getLayout
    this.#nMin = opts.nMin ?? DEFAULTS.reveal.nMin
    this.#n = opts.initialN ?? DEFAULTS.reveal.mouseInitialN
  }

  /** Gắn vào canvas output; gọi lại detach() trước khi gắn canvas khác. */
  attach(canvas: HTMLCanvasElement): void {
    if (this.#canvas === canvas) return
    this.detach()
    this.#canvas = canvas
    canvas.addEventListener('pointerdown', this.#onPointerDown)
    canvas.addEventListener('pointermove', this.#onPointerMove)
    canvas.addEventListener('pointerup', this.#onPointerUp)
    canvas.addEventListener('pointercancel', this.#onPointerUp)
    canvas.addEventListener('wheel', this.#onWheel, { passive: false })
    window.addEventListener('keydown', this.#onKeyDown)
  }

  detach(): void {
    const canvas = this.#canvas
    if (!canvas) return
    canvas.removeEventListener('pointerdown', this.#onPointerDown)
    canvas.removeEventListener('pointermove', this.#onPointerMove)
    canvas.removeEventListener('pointerup', this.#onPointerUp)
    canvas.removeEventListener('pointercancel', this.#onPointerUp)
    canvas.removeEventListener('wheel', this.#onWheel)
    window.removeEventListener('keydown', this.#onKeyDown)
    this.#canvas = null
    this.#dragging = false
  }

  current(): WindowSample {
    if (!this.#open) return noWindow('user')
    const layout = this.#getLayout()
    if (layout.c === 0) return noWindow('config-changed')
    if (layout !== this.#placedLayout) this.#place()
    const { window, limited } = clampWindow(
      { col: this.#col, row: this.#row, n: this.#n },
      layout,
      this.#nMin,
    )
    return { shape: { kind: 'window', window }, limited }
  }

  dispose(): void {
    this.detach()
    this.#open = false
  }

  /** Kịch bản (TEST-00): đặt cửa sổ theo ô, không cần chuột; tâm lưu lại để kéo, lăn hay đổi lưới tiếp được. */
  setWindow(win: RevealWindow): void {
    const layout = this.#getLayout()
    this.#n = win.n
    this.#col = win.col
    this.#row = win.row
    this.#open = true
    this.#dragging = false
    this.#placedLayout = layout
    if (layout.c > 0) {
      const r = windowToStageRect(win, layout)
      this.#center = { x: r.x + r.w / 2, y: r.y + r.h / 2 }
    }
  }

  moveWindow(col: number, row: number): void {
    this.setWindow({ col, row, n: this.#n })
  }

  /** Đổi cạnh, giữ tâm (như lăn chuột nhưng đặt thẳng giá trị). */
  resizeWindow(n: number): void {
    this.#n = Math.max(1, Math.round(n))
    if (this.#open) this.#place()
  }

  close(): void {
    this.#open = false
    this.#dragging = false
  }

  // ---- nội bộ ----

  #stagePoint(e: PointerEvent): Point | null {
    const canvas = this.#canvas
    if (!canvas) return null
    const r = canvas.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return null
    return {
      x: ((e.clientX - r.left) * canvas.width) / r.width,
      y: ((e.clientY - r.top) * canvas.height) / r.height,
    }
  }

  #place(): void {
    const layout = this.#getLayout()
    if (!this.#center || layout.c === 0) return
    const w = windowAtCenter(this.#center, this.#n, layout)
    this.#col = w.col
    this.#row = w.row
    this.#placedLayout = layout
  }

  #onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return
    const p = this.#stagePoint(e)
    if (!p || this.#getLayout().c === 0) return
    e.preventDefault()
    // UX-01: preventDefault chặn đổi focus, nên tự bỏ focus khỏi ô nhập đang sửa để Esc, Space, F chạy ngay sau khi bấm
    // lên canvas.
    const active = document.activeElement
    if (active instanceof HTMLElement && active !== this.#canvas) active.blur()
    this.#center = p
    this.#open = true
    this.#dragging = true
    this.#canvas?.setPointerCapture(e.pointerId)
    this.#place()
  }

  #onPointerMove = (e: PointerEvent): void => {
    if (!this.#dragging) return
    const p = this.#stagePoint(e)
    if (!p) return
    this.#center = p
    this.#place()
  }

  #onPointerUp = (e: PointerEvent): void => {
    if (!this.#dragging) return
    this.#dragging = false
    if (this.#canvas?.hasPointerCapture(e.pointerId))
      this.#canvas.releasePointerCapture(e.pointerId)
  }

  #onWheel = (e: WheelEvent): void => {
    if (!this.#open) return
    e.preventDefault()
    const layout = this.#getLayout()
    const nMax = Math.max(1, Math.min(layout.cols, layout.rows))
    const dir = e.deltaY < 0 ? 1 : -1
    this.#n = Math.min(nMax, Math.max(Math.min(this.#nMin, nMax), this.#n + dir))
    this.#place()
  }

  #onKeyDown = (e: KeyboardEvent): void => {
    const t = e.target
    if (t instanceof HTMLElement && (EDIT_TAGS.has(t.tagName) || t.isContentEditable)) return
    if (e.key === 'Escape') {
      this.#open = false
      this.#dragging = false
      return
    }
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault()
      if (this.#open) return
      const layout = this.#getLayout()
      if (layout.c === 0) return
      if (!this.#center) {
        const { board } = layout
        this.#center = { x: board.x + board.w / 2, y: board.y + board.h / 2 }
      }
      this.#open = true
      this.#place()
    }
  }
}
