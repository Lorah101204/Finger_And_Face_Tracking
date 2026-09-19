// TEST-00: nguồn camera tổng hợp vẽ vào canvas theo kịch bản (bước 1): nền magenta, vùng "người" xanh lá tại tọa độ
// cấu hình, ảnh mặt tĩnh tùy chọn (chỉ ảnh được phép, nạp từ cùng origin), có thể di chuyển theo thời gian.
// Implement FrameSource như CameraSource nên vòng lặp và compositor không phân biệt. Chỉ bật với
// #/app?debug=1&source=synthetic. drawImage ở đây vẽ VÀO canvas camera tổng hợp (nó chính là camera), không phải
// lên output; tools/check-invariants.mjs cho phép file này và vẫn buộc 9 tham số.
import type { FrameStamp } from '../core/types'
import type { FrameListener, FrameSource } from './frameSource'

export type SyntheticPerson = {
  x: number
  y: number
  w: number
  h: number
  color: string
  /** px camera mỗi giây; vùng chạy vòng quanh khung. */
  vx: number
  vy: number
}

/**
 * Ảnh tĩnh vẽ vào cảnh (mặt cho FACE-02, hai bàn tay cho HAND-01); chỉ ảnh cùng origin. vx, vy (px camera mỗi giây)
 * cho ảnh chạy vòng quanh khung như person, mặc định đứng yên; chuyển động tính từ lúc đặt ảnh (setScene), nên đặt
 * lại cùng x, y kèm vx sau khi pipeline đã ổn định thì ảnh đi tiếp từ vị trí hiện tại, không nhảy.
 */
export type SyntheticFace = {
  src: string
  x: number
  y: number
  w: number
  h: number
  vx?: number
  vy?: number
}

export type SyntheticScene = {
  width: number
  height: number
  fps: number
  background: string
  person: SyntheticPerson | null
  face: SyntheticFace | null
}

/** Nửa trái camera là "người" xanh lá, nửa phải là nền magenta: mirror bật thì nửa phải bảng xanh lá. */
export const DEFAULT_SCENE: SyntheticScene = {
  width: 1280,
  height: 720,
  fps: 30,
  background: '#ff00ff',
  person: { x: 0, y: 0, w: 640, h: 720, color: '#00ff00', vx: 0, vy: 0 },
  face: null,
}

export class SyntheticCameraSource implements FrameSource {
  #canvas = document.createElement('canvas')
  #ctx: CanvasRenderingContext2D
  #scene: SyntheticScene
  #timer: ReturnType<typeof setInterval> | null = null
  #frameId = -1
  #lastStamp: FrameStamp | null = null
  #listeners = new Set<FrameListener>()
  #t0 = 0
  #faceImg: HTMLImageElement | null = null
  #faceSrc = ''
  /** Mốc thời gian (giây kể từ start) lúc đặt ảnh: chuyển động của ảnh tính từ đây. */
  #faceSince = 0

  constructor(scene: Partial<SyntheticScene> = {}) {
    this.#scene = { ...DEFAULT_SCENE, ...scene }
    this.#canvas.width = this.#scene.width
    this.#canvas.height = this.#scene.height
    const ctx = this.#canvas.getContext('2d')
    if (!ctx) throw new Error('SyntheticCameraSource: không tạo được context 2d')
    this.#ctx = ctx
    this.#loadFace()
    this.#draw(0)
  }

  get width(): number {
    return this.#scene.width
  }
  get height(): number {
    return this.#scene.height
  }
  get drawable(): CanvasImageSource | null {
    return this.#canvas
  }
  get lastStamp(): FrameStamp | null {
    return this.#lastStamp
  }
  get scene(): SyntheticScene {
    return this.#scene
  }

  onFrame(cb: FrameListener): () => void {
    this.#listeners.add(cb)
    return () => {
      this.#listeners.delete(cb)
    }
  }

  start(): void {
    if (this.#timer !== null) return
    this.#t0 = performance.now()
    this.#timer = setInterval(() => this.#tick(), 1000 / this.#scene.fps)
  }

  stop(): void {
    if (this.#timer === null) return
    clearInterval(this.#timer)
    this.#timer = null
  }

  /** Đổi kịch bản khi đang chạy; đổi kích thước thì canvas đặt lại (người dùng phải setCamSize lại cho store). */
  setScene(patch: Partial<SyntheticScene>): void {
    const running = this.#timer !== null
    this.#scene = { ...this.#scene, ...patch }
    if (this.#canvas.width !== this.#scene.width || this.#canvas.height !== this.#scene.height) {
      this.#canvas.width = this.#scene.width
      this.#canvas.height = this.#scene.height
    }
    this.#loadFace()
    if (running && patch.fps !== undefined) {
      this.stop()
      this.start()
    }
    const t = running ? (performance.now() - this.#t0) / 1000 : 0
    if (patch.face !== undefined) this.#faceSince = t
    this.#draw(t)
  }

  #loadFace(): void {
    const face = this.#scene.face
    if (!face) {
      this.#faceImg = null
      this.#faceSrc = ''
      return
    }
    if (face.src === this.#faceSrc) return
    this.#faceSrc = face.src
    this.#faceImg = null
    const img = new Image()
    img.onload = () => {
      if (this.#faceSrc === face.src) this.#faceImg = img
    }
    img.src = face.src
  }

  #tick(): void {
    const now = performance.now()
    const t = (now - this.#t0) / 1000
    this.#draw(t)
    this.#frameId += 1
    const stamp: FrameStamp = { frameId: this.#frameId, ts: now, mediaTime: t }
    this.#lastStamp = stamp
    for (const cb of this.#listeners) cb(stamp)
  }

  #draw(t: number): void {
    const ctx = this.#ctx
    const { width, height, background, person, face } = this.#scene
    ctx.fillStyle = background
    ctx.fillRect(0, 0, width, height)
    if (person) {
      const x = wrap(person.x + person.vx * t, person.w, width)
      const y = wrap(person.y + person.vy * t, person.h, height)
      ctx.fillStyle = person.color
      ctx.fillRect(x, y, person.w, person.h)
    }
    const img = this.#faceImg
    if (face && img) {
      const dt = Math.max(0, t - this.#faceSince)
      const fx = wrap(face.x + (face.vx ?? 0) * dt, face.w, width)
      const fy = wrap(face.y + (face.vy ?? 0) * dt, face.h, height)
      ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, fx, fy, face.w, face.h)
    }
  }
}

/** Vị trí chạy vòng: ra khỏi mép phải thì vào lại từ mép trái. */
function wrap(pos: number, size: number, extent: number): number {
  const span = extent + size
  return ((((pos + size) % span) + span) % span) - size
}
