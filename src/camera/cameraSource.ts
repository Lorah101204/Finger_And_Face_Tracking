// CAM-01: getUserMedia, video ẩn, requestVideoFrameCallback, FrameStamp, máy trạng thái camera (D-011, D-025).
// Đây là file duy nhất trong src/ gọi getUserMedia (tools/check-invariants.mjs kiểm). Mỗi lần gọi đều đi qua
// `gate` (app truyền assertCameraAllowed, bất biến I10) một cách đồng bộ, trong ngữ cảnh bấm nút.
import { DEFAULTS } from '../core/config'
import type { EpochCounter } from '../core/epoch'
import type { FrameStamp } from '../core/types'
import {
  IDLE,
  classifyCameraError,
  leftActive,
  reduceCamera,
  type CameraDevice,
  type CameraEvent,
  type CameraSnapshot,
  type CameraState,
} from './cameraState'
import type { FrameListener, FrameSource } from './frameSource'

export type CameraSourceOptions = {
  /** Gọi đồng bộ ngay trước mỗi getUserMedia; ném lỗi thì không xin camera (I10). */
  gate: () => void
  epoch: EpochCounter
  width?: number
  height?: number
  watchdogMs?: number
}

const VIDEO_ATTR = 'data-wct-camera'

export class CameraSource implements FrameSource {
  #gate: () => void
  #epoch: EpochCounter
  #ideal: { width: number; height: number }
  #watchdogMs: number

  #state: CameraState = IDLE
  #stalled = false
  #hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
  #devices: CameraDevice[] = []
  #snapshot: CameraSnapshot
  #listeners = new Set<() => void>()
  #frameListeners = new Set<FrameListener>()

  #video: HTMLVideoElement | null = null
  #stream: MediaStream | null = null
  /** Tăng mỗi lần start/stop để loại kết quả getUserMedia về muộn sau khi đã dừng hoặc đổi camera. */
  #seq = 0
  #frameId = -1
  #lastStamp: FrameStamp | null = null
  #lastFrameAt = 0
  #lastMediaTime = -1
  #rvfcHandle = 0
  #rafHandle = 0
  #watchdog: ReturnType<typeof setInterval> | null = null
  #listening = false

  constructor(opts: CameraSourceOptions) {
    this.#gate = opts.gate
    this.#epoch = opts.epoch
    this.#ideal = {
      width: opts.width ?? DEFAULTS.camera.width,
      height: opts.height ?? DEFAULTS.camera.height,
    }
    this.#watchdogMs = opts.watchdogMs ?? DEFAULTS.camera.noFrameWatchdogMs
    this.#snapshot = this.#buildSnapshot()
  }

  // FrameSource
  get width(): number {
    return this.#state.status === 'active' ? this.#state.width : 0
  }
  get height(): number {
    return this.#state.status === 'active' ? this.#state.height : 0
  }
  get drawable(): CanvasImageSource | null {
    return this.#state.status === 'active' ? this.#video : null
  }
  get lastStamp(): FrameStamp | null {
    return this.#lastStamp
  }
  onFrame(cb: FrameListener): () => void {
    this.#frameListeners.add(cb)
    return () => {
      this.#frameListeners.delete(cb)
    }
  }

  // Store cho React (useSyncExternalStore); snapshot chỉ đổi tham chiếu khi có thay đổi trạng thái, không đổi mỗi frame.
  subscribe = (fn: () => void): (() => void) => {
    this.#listeners.add(fn)
    return () => {
      this.#listeners.delete(fn)
    }
  }
  getSnapshot = (): CameraSnapshot => this.#snapshot

  /**
   * Xin camera (deviceId null: mặc định). Gọi từ handler bấm nút. Đang active thì dừng track cũ trước rồi mới xin
   * track mới; output không bao giờ vẽ video ở lớp này nên không lóe khung hình toàn camera khi đổi.
   */
  async start(deviceId: string | null = null): Promise<void> {
    const seq = ++this.#seq
    this.#ensureListening()
    this.#releaseStream()
    this.#dispatch({ type: 'start', deviceId })
    try {
      this.#gate()
    } catch (err) {
      this.#dispatch({
        type: 'fail',
        kind: 'gate',
        message: err instanceof Error ? err.message : String(err),
      })
      return
    }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          width: { ideal: this.#ideal.width },
          height: { ideal: this.#ideal.height },
        },
        audio: false,
      })
    } catch (err) {
      if (seq !== this.#seq) return
      this.#dispatch({ type: 'fail', ...classifyCameraError(err) })
      return
    }
    if (seq !== this.#seq) {
      // Đã stop() hoặc start() lại trong lúc chờ: không dùng stream này.
      for (const t of stream.getTracks()) t.stop()
      return
    }
    const track = stream.getVideoTracks()[0]
    if (!track) {
      this.#dispatch({ type: 'fail', kind: 'unknown', message: 'stream không có video track' })
      return
    }
    this.#stream = stream
    const settings = track.getSettings()
    track.addEventListener('ended', () => {
      if (seq !== this.#seq) return
      this.#releaseStream()
      this.#dispatch({ type: 'track-ended' })
    })
    const video = this.#ensureVideo()
    video.srcObject = stream
    this.#lastFrameAt = performance.now()
    this.#lastMediaTime = -1
    this.#dispatch({
      type: 'stream',
      deviceId: settings.deviceId ?? deviceId ?? '',
      label: track.label,
      width: settings.width ?? 0,
      height: settings.height ?? 0,
      frameRate: settings.frameRate ?? null,
    })
    // play() có thể không resolve khi host tạm dừng media (S4); không chờ, watchdog sẽ báo stalled.
    void video.play().catch(() => {})
    this.#scheduleFrame(seq)
    this.#startWatchdog()
    void this.refreshDevices()
  }

  /** Dừng camera, về idle. Mọi lối ra khỏi active đều tăng epoch (D-025). */
  stop(): void {
    this.#seq++
    this.#releaseStream()
    this.#dispatch({ type: 'stop' })
  }

  /** Dừng và gỡ mọi listener, video element. Instance vẫn dùng lại được bằng start(). */
  dispose(): void {
    this.stop()
    if (this.#listening) {
      navigator.mediaDevices?.removeEventListener('devicechange', this.#onDeviceChange)
      document.removeEventListener('visibilitychange', this.#onVisibility)
      this.#listening = false
    }
    this.#video?.remove()
    this.#video = null
  }

  /** enumerateDevices không cần cổng (không phải getUserMedia); nhãn chỉ có sau khi đã được cấp quyền. */
  async refreshDevices(): Promise<void> {
    if (!navigator.mediaDevices?.enumerateDevices) return
    let list: MediaDeviceInfo[]
    try {
      list = await navigator.mediaDevices.enumerateDevices()
    } catch {
      return
    }
    const devices = list
      .filter((d) => d.kind === 'videoinput')
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }))
    const same =
      devices.length === this.#devices.length &&
      devices.every(
        (d, i) => d.deviceId === this.#devices[i].deviceId && d.label === this.#devices[i].label,
      )
    if (!same) {
      this.#devices = devices
      this.#emit()
    }
    if (this.#state.status === 'active' && this.#state.deviceId) {
      const id = this.#state.deviceId
      if (devices.length > 0 && !devices.some((d) => d.deviceId === id)) {
        this.#seq++
        this.#releaseStream()
        this.#dispatch({ type: 'device-removed' })
      }
    }
  }

  // ---- nội bộ ----

  #dispatch(event: CameraEvent): void {
    const prev = this.#state
    const next = reduceCamera(prev, event)
    if (next === prev) return
    this.#state = next
    if (next.status === 'requesting' || leftActive(prev, next)) this.#epoch.bump()
    if (next.status !== 'active' && this.#stalled) this.#stalled = false
    this.#emit()
  }

  #buildSnapshot(): CameraSnapshot {
    return {
      state: this.#state,
      stalled: this.#stalled,
      hidden: this.#hidden,
      devices: this.#devices,
      epoch: this.#epoch.current,
    }
  }

  #emit(): void {
    this.#snapshot = this.#buildSnapshot()
    for (const l of this.#listeners) l()
  }

  #ensureListening(): void {
    if (this.#listening) return
    this.#listening = true
    navigator.mediaDevices?.addEventListener('devicechange', this.#onDeviceChange)
    document.addEventListener('visibilitychange', this.#onVisibility)
  }

  #onDeviceChange = (): void => {
    void this.refreshDevices()
  }

  #onVisibility = (): void => {
    const hidden = document.visibilityState === 'hidden'
    if (hidden === this.#hidden) return
    this.#hidden = hidden
    this.#emit()
  }

  /** D-011: trong DOM nhưng ẩn bằng opacity 0 và đặt ngoài viewport; không dùng display: none. */
  #ensureVideo(): HTMLVideoElement {
    if (this.#video) return this.#video
    const v = document.createElement('video')
    v.muted = true
    v.playsInline = true
    v.autoplay = true
    v.setAttribute('aria-hidden', 'true')
    v.setAttribute(VIDEO_ATTR, '')
    Object.assign(v.style, {
      position: 'fixed',
      left: '-10000px',
      top: '0',
      width: '1px',
      height: '1px',
      opacity: '0',
      pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>)
    document.body.appendChild(v)
    this.#video = v
    return v
  }

  #releaseStream(): void {
    this.#cancelFrame()
    this.#stopWatchdog()
    if (this.#stream) {
      for (const t of this.#stream.getTracks()) t.stop()
      this.#stream = null
    }
    if (this.#video) this.#video.srcObject = null
  }

  #scheduleFrame(seq: number): void {
    const video = this.#video
    if (!video) return
    if (typeof video.requestVideoFrameCallback === 'function') {
      this.#rvfcHandle = video.requestVideoFrameCallback((_now, meta) => {
        if (seq !== this.#seq) return
        this.#onFrame(meta.mediaTime, meta.width, meta.height)
        this.#scheduleFrame(seq)
      })
      return
    }
    // Fallback rAF: chỉ phát khi currentTime đổi để không đếm trùng một frame.
    this.#rafHandle = requestAnimationFrame(() => {
      if (seq !== this.#seq) return
      if (video.readyState >= 2 && video.currentTime !== this.#lastMediaTime) {
        this.#onFrame(video.currentTime, video.videoWidth, video.videoHeight)
      }
      this.#scheduleFrame(seq)
    })
  }

  #cancelFrame(): void {
    if (this.#rvfcHandle && this.#video) {
      this.#video.cancelVideoFrameCallback(this.#rvfcHandle)
      this.#rvfcHandle = 0
    }
    if (this.#rafHandle) {
      cancelAnimationFrame(this.#rafHandle)
      this.#rafHandle = 0
    }
  }

  #onFrame(mediaTime: number, width: number, height: number): void {
    this.#frameId += 1
    const stamp: FrameStamp = { frameId: this.#frameId, ts: performance.now(), mediaTime }
    this.#lastStamp = stamp
    this.#lastFrameAt = stamp.ts
    this.#lastMediaTime = mediaTime
    if (width && height) this.#dispatch({ type: 'dimensions', width, height })
    if (this.#stalled) {
      this.#stalled = false
      this.#emit()
    }
    for (const cb of this.#frameListeners) cb(stamp)
  }

  #startWatchdog(): void {
    this.#stopWatchdog()
    const period = Math.max(50, Math.floor(this.#watchdogMs / 2))
    this.#watchdog = setInterval(() => {
      if (this.#state.status !== 'active') return
      const stalled = performance.now() - this.#lastFrameAt > this.#watchdogMs
      if (stalled !== this.#stalled) {
        this.#stalled = stalled
        this.#emit()
      }
    }, period)
  }

  #stopWatchdog(): void {
    if (this.#watchdog !== null) {
      clearInterval(this.#watchdog)
      this.#watchdog = null
    }
  }
}
