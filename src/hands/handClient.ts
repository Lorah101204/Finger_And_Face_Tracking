// HAND-01 bước 1: HandClient ở main thread, cùng mẫu FaceClient. Một frame chạy tại một thời điểm: submit khi ready
// và không bận, ngược lại bỏ qua (không xếp hàng: frame cũ vô giá trị). Frame gốc lấy từ FrameSource.drawable bằng
// createImageBitmap (D-009: 0,1 ms ở 720p) rồi transfer sang hand.worker; đây là nơi duy nhất trong src/ gọi
// createImageBitmap (tools/check-invariants.mjs kiểm) nên đường đi của frame gốc tới worker chỉ có một.
import { DEFAULTS, modelUrls } from '../core/config'
import { createLatencyWindow, type LatencyWindow } from '../core/latency'
import type { FrameStamp, HandResult } from '../core/types'
import type { FrameSource } from '../camera/frameSource'
import { resolveHandDelegate } from './handDelegate'
import type { HandDelegate, HandInitMessage, HandWorkerIn, HandWorkerOut } from './handProtocol'

export type HandSubmitOutcome = 'submitted' | 'not-ready' | 'busy' | 'no-frame'

export type HandClientStats = {
  submitted: number
  results: number
  discarded: number
  errors: number
  lastInferMs: number
  p50InferMs: number
  /** PERF-01: p95 trên cùng cửa sổ mẫu với p50. */
  p95InferMs: number
  lastBitmapMs: number
  lastHands: number
  initMs: number
  warmupMs: number
}

export type HandSnapshot = {
  started: boolean
  ready: boolean
  failed: boolean
  delegate: HandDelegate | null
  busy: boolean
  pendingFrameId: number | null
  stats: HandClientStats
  lastError: string | null
}

/** Phần Worker mà client dùng; unit test thay bằng worker giả. */
export type HandWorkerLike = {
  postMessage(msg: HandWorkerIn, transfer?: Transferable[]): void
  onmessage: ((e: MessageEvent<HandWorkerOut>) => void) | null
  onerror: ((e: ErrorEvent) => void) | null
  terminate(): void
}

export type HandClientOptions = {
  createWorker?: () => HandWorkerLike
  init?: Partial<Omit<HandInitMessage, 'type'>>
  /** Số mẫu inferMs gần nhất để tính p50. */
  window?: number
  onReady?: (snap: HandSnapshot) => void
  onError?: (message: string, frameId: number | null) => void
  now?: () => number
  /** Unit test thay createImageBitmap. */
  createBitmap?: (source: CanvasImageSource) => Promise<ImageBitmap>
}

export type HandResultListener = (result: HandResult) => void

/**
 * D-008: wasm ở node_modules khi dev, /models/wasm khi build (REL-01: đã ghép base). D-045: delegate `auto` không biết renderer ở đây thì
 * là CPU (chạy được ở mọi nơi); StagePage truyền delegate đã quyết theo WebGL qua `init.delegate`.
 */
export function defaultHandInit(): Omit<HandInitMessage, 'type'> {
  const mp = DEFAULTS.mediapipe
  const urls = modelUrls()
  return {
    wasmBasePath: urls.wasmBase,
    modelPath: urls.handModel,
    delegate: resolveHandDelegate(DEFAULTS.hands.delegate, null),
    numHands: DEFAULTS.hands.numHands,
    useModuleLoader: mp.useModuleLoader,
    warmupSize: DEFAULTS.hands.warmupSize,
  }
}

function createModuleWorker(): HandWorkerLike {
  return new Worker(new URL('./hand.worker.ts', import.meta.url), {
    type: 'module',
  }) as unknown as HandWorkerLike
}

export class HandClient {
  #opts: HandClientOptions
  #init: Omit<HandInitMessage, 'type'>
  #window: number
  #now: () => number
  #createBitmap: (source: CanvasImageSource) => Promise<ImageBitmap>
  #worker: HandWorkerLike | null = null
  #disposed = false
  #ready = false
  #failed = false
  #delegate: HandDelegate | null = null
  #busy = false
  #pendingFrameId: number | null = null
  #lastError: string | null = null
  #infer: LatencyWindow = createLatencyWindow(20)
  #listeners = new Set<HandResultListener>()
  #stats: HandClientStats = {
    submitted: 0,
    results: 0,
    discarded: 0,
    errors: 0,
    lastInferMs: 0,
    p50InferMs: 0,
    p95InferMs: 0,
    lastBitmapMs: 0,
    lastHands: 0,
    initMs: 0,
    warmupMs: 0,
  }

  constructor(opts: HandClientOptions = {}) {
    this.#opts = opts
    this.#init = { ...defaultHandInit(), ...opts.init }
    this.#window = opts.window ?? 20
    if (this.#window !== this.#infer.size) this.#infer = createLatencyWindow(this.#window)
    this.#now = opts.now ?? (() => performance.now())
    this.#createBitmap = opts.createBitmap ?? ((src) => createImageBitmap(src))
  }

  /** Tạo worker và gửi init. Đang có worker thì không làm gì; sau dispose có thể start lại (React StrictMode mount lại). */
  start(): void {
    if (this.#worker) return
    this.#disposed = false
    const w = (this.#opts.createWorker ?? createModuleWorker)()
    w.onmessage = (e) => this.#onMessage(e.data)
    w.onerror = (e) => this.#fail(e.message || 'lỗi worker tay')
    this.#worker = w
    w.postMessage({ type: 'init', ...this.#init })
  }

  get started(): boolean {
    return this.#worker !== null
  }
  get ready(): boolean {
    return this.#ready
  }
  get busy(): boolean {
    return this.#busy
  }
  get stats(): Readonly<HandClientStats> {
    return this.#stats
  }

  subscribeResults(cb: HandResultListener): () => void {
    this.#listeners.add(cb)
    return () => {
      this.#listeners.delete(cb)
    }
  }

  canAccept(): boolean {
    return this.#ready && !this.#busy
  }

  /**
   * Gửi frame gốc hiện tại của nguồn. Bận từ lúc gọi tới khi worker trả về (createImageBitmap là bất đồng bộ nhưng
   * ngắn); bitmap luôn được đóng nếu không gửi được hoặc client đã dispose trong lúc chờ.
   */
  submit(source: FrameSource, stamp: FrameStamp, epoch: number): HandSubmitOutcome {
    const w = this.#worker
    if (!w || !this.#ready) return 'not-ready'
    if (this.#busy) return 'busy'
    const drawable = source.drawable
    if (!drawable) return 'no-frame'
    this.#busy = true
    this.#pendingFrameId = stamp.frameId
    const t0 = this.#now()
    this.#createBitmap(drawable).then(
      (bmp) => {
        if (this.#disposed || this.#worker !== w || this.#pendingFrameId !== stamp.frameId) {
          bmp.close()
          this.#busy = false
          return
        }
        this.#stats.lastBitmapMs = this.#now() - t0
        try {
          w.postMessage(
            { type: 'detect', frame: { frameId: stamp.frameId, ts: stamp.ts, epoch, input: bmp } },
            [bmp],
          )
          this.#stats.submitted++
        } catch (err) {
          bmp.close()
          this.#error(String(err), stamp.frameId)
        }
      },
      (err) => this.#error(String(err), stamp.frameId),
    )
    return 'submitted'
  }

  snapshot(): HandSnapshot {
    return {
      started: this.#worker !== null,
      ready: this.#ready,
      failed: this.#failed,
      delegate: this.#delegate,
      busy: this.#busy,
      pendingFrameId: this.#pendingFrameId,
      stats: { ...this.#stats },
      lastError: this.#lastError,
    }
  }

  dispose(): void {
    this.#disposed = true
    this.#worker?.terminate()
    this.#worker = null
    this.#ready = false
    this.#busy = false
    this.#pendingFrameId = null
  }

  #onMessage(msg: HandWorkerOut): void {
    if (msg.type === 'ready') {
      this.#ready = true
      this.#failed = false
      this.#delegate = msg.delegate
      this.#stats.initMs = msg.initMs
      this.#stats.warmupMs = msg.warmupMs
      this.#opts.onReady?.(this.snapshot())
      return
    }
    if (msg.type === 'error') {
      if (msg.frameId === null) this.#fail(msg.message)
      else this.#error(msg.message, msg.frameId)
      return
    }
    const r = msg.result
    this.#busy = false
    this.#pushInfer(r.inferMs)
    if (this.#pendingFrameId !== r.frameId) {
      this.#stats.discarded++
      return
    }
    this.#pendingFrameId = null
    this.#stats.results++
    this.#stats.lastHands = r.hands.length
    for (const cb of this.#listeners) cb(r)
  }

  /** PERF-01: p50 và p95 trên cửa sổ trượt (core/latency.ts); p50 giữ nguyên quy ước cũ. */
  #pushInfer(ms: number): void {
    this.#infer.push(ms)
    const s = this.#infer.stats()
    this.#stats.lastInferMs = ms
    this.#stats.p50InferMs = s.p50
    this.#stats.p95InferMs = s.p95
  }

  #error(message: string, frameId: number): void {
    this.#busy = false
    if (this.#pendingFrameId === frameId) this.#pendingFrameId = null
    this.#stats.errors++
    this.#lastError = message
    this.#opts.onError?.(message, frameId)
  }

  #fail(message: string): void {
    this.#failed = true
    this.#ready = false
    this.#busy = false
    this.#pendingFrameId = null
    this.#lastError = message
    this.#opts.onError?.(message, null)
  }
}
