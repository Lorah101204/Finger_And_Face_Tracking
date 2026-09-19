// FACE-01 bước 3, 4: FaceClient ở main thread. Một tác vụ chạy tại một thời điểm: submit khi ready, accepting và
// không bận, ngược lại drop (bitmap được đóng ngay). rejectAll đánh dấu mọi taskId đã gửi là bị loại: tác vụ đang
// chạy trong worker không hủy được nên busy giữ tới khi kết quả về rồi bị bỏ (mục 5.10). Nhịp gợi ý
// minIntervalMs = max(1000 / targetHz, p50 inferMs). Chỉ import core/ và file cùng thư mục (lint:boundaries, I1);
// đây là nơi duy nhất tạo worker mặt. Giả định: taskId do vòng lặp cấp tăng dần.
import { DEFAULTS, modelUrls } from '../core/config'
import { createLatencyWindow, type LatencyWindow } from '../core/latency'
import type { Letterbox } from '../core/letterbox'
import type { FaceResult, Rect, RestrictedFrame } from '../core/types'
import type { FaceDelegate, FaceInitMessage, FaceWorkerIn, FaceWorkerOut } from './faceProtocol'

export type PendingTask = {
  taskId: number
  epoch: number
  frameId: number
  ts: number
  roiCam: Rect
  letterbox: Letterbox
  submittedAt: number
}

export type SubmitOutcome = 'submitted' | 'not-ready' | 'not-accepting' | 'busy' | 'failed'

export type FaceClientStats = {
  submitted: number
  dropped: number
  results: number
  discarded: number
  errors: number
  lastInferMs: number
  p50InferMs: number
  /** PERF-01: p95 trên cùng cửa sổ mẫu với p50. */
  p95InferMs: number
  lastFaces: number
  initMs: number
  warmupMs: number
}

export type FaceSnapshot = {
  ready: boolean
  failed: boolean
  delegate: FaceDelegate | null
  accepting: boolean
  busy: boolean
  pendingTaskId: number | null
  rejectedUpTo: number
  stats: FaceClientStats
  minIntervalMs: number
  lastError: string | null
}

/** Phần Worker mà client dùng; unit test thay bằng worker giả. */
export type WorkerLike = {
  postMessage(msg: FaceWorkerIn, transfer?: Transferable[]): void
  onmessage: ((e: MessageEvent<FaceWorkerOut>) => void) | null
  onerror: ((e: ErrorEvent) => void) | null
  terminate(): void
}

export type FaceClientOptions = {
  createWorker?: () => WorkerLike
  init?: Partial<Omit<FaceInitMessage, 'type'>>
  targetHz?: number
  /** Số mẫu inferMs gần nhất để tính p50. */
  window?: number
  onResult?: (result: FaceResult, task: PendingTask) => void
  onReady?: (snap: FaceSnapshot) => void
  onError?: (message: string, taskId: number | null) => void
  now?: () => number
  /** FACE-02 kịch bản delayWorker: trễ nhân tạo (ms) trước khi xử lý kết quả; busy giữ trong lúc trễ như worker chậm. */
  resultDelayMs?: () => number
}

export type ResultListener = (result: FaceResult, task: PendingTask) => void

/** D-008: wasm ở node_modules khi dev (Vite từ chối import() từ public/), ở /models/wasm khi build; REL-01: đã ghép base. */
export function defaultInit(): Omit<FaceInitMessage, 'type'> {
  const mp = DEFAULTS.mediapipe
  const urls = modelUrls()
  return {
    wasmBasePath: urls.wasmBase,
    modelPath: urls.faceModel,
    delegate: DEFAULTS.face.delegate,
    numFaces: DEFAULTS.face.numFaces,
    useModuleLoader: mp.useModuleLoader,
    warmupSize: DEFAULTS.face.inputSize,
  }
}

function createModuleWorker(): WorkerLike {
  return new Worker(new URL('./face.worker.ts', import.meta.url), {
    type: 'module',
  }) as unknown as WorkerLike
}

export class FaceClient {
  #opts: FaceClientOptions
  #init: Omit<FaceInitMessage, 'type'>
  #targetHz: number
  #window: number
  #now: () => number
  #worker: WorkerLike | null = null
  #ready = false
  #failed = false
  #delegate: FaceDelegate | null = null
  #accepting = false
  #busy = false
  #pending: PendingTask | null = null
  #lastTaskId = 0
  #rejectedUpTo = 0
  #lastError: string | null = null
  #infer: LatencyWindow = createLatencyWindow(20)
  #resultListeners = new Set<ResultListener>()
  #stats: FaceClientStats = {
    submitted: 0,
    dropped: 0,
    results: 0,
    discarded: 0,
    errors: 0,
    lastInferMs: 0,
    p50InferMs: 0,
    p95InferMs: 0,
    lastFaces: 0,
    initMs: 0,
    warmupMs: 0,
  }

  constructor(opts: FaceClientOptions = {}) {
    this.#opts = opts
    this.#init = { ...defaultInit(), ...opts.init }
    this.#targetHz = opts.targetHz ?? DEFAULTS.face.targetHz
    this.#window = opts.window ?? 20
    if (this.#window !== this.#infer.size) this.#infer = createLatencyWindow(this.#window)
    this.#now = opts.now ?? (() => performance.now())
  }

  /** Tạo worker và gửi init; gọi lúc app start. Đang có worker thì không làm gì. */
  start(): void {
    if (this.#worker) return
    const w = (this.#opts.createWorker ?? createModuleWorker)()
    w.onmessage = (e) => this.#onMessage(e.data)
    w.onerror = (e) => this.#fail(e.message || 'lỗi worker mặt')
    this.#worker = w
    w.postMessage({ type: 'init', ...this.#init })
  }

  get ready(): boolean {
    return this.#ready
  }
  get accepting(): boolean {
    return this.#accepting
  }
  get busy(): boolean {
    return this.#busy
  }
  get stats(): Readonly<FaceClientStats> {
    return this.#stats
  }
  /** Mọi taskId ≤ giá trị này đã bị rejectAll (validate dùng, mục 5.10). */
  get rejectedUpTo(): number {
    return this.#rejectedUpTo
  }

  /** FACE-02: vòng lặp nhận kết quả đã qua lọc rejectAll để validate theo mask hiện tại. */
  subscribeResults(cb: ResultListener): () => void {
    this.#resultListeners.add(cb)
    return () => {
      this.#resultListeners.delete(cb)
    }
  }

  /** Vòng lặp bật khi vùng mở, tắt khi đóng (mục 4.4 bước 4). */
  setAccepting(on: boolean): void {
    this.#accepting = on
  }

  canAccept(): boolean {
    return this.#ready && this.#accepting && !this.#busy
  }

  /** Nhịp gửi gợi ý (bước 4): không nhanh hơn targetHz và không nhanh hơn p50 inferMs. */
  minIntervalMs(): number {
    return Math.max(1000 / this.#targetHz, this.#stats.p50InferMs)
  }

  /** Luôn nhận quyền sở hữu bitmap: transfer sang worker, hoặc đóng ngay khi drop. */
  submit(frame: RestrictedFrame): SubmitOutcome {
    const w = this.#worker
    let outcome: SubmitOutcome = 'submitted'
    if (!w || !this.#ready) outcome = 'not-ready'
    else if (!this.#accepting) outcome = 'not-accepting'
    else if (this.#busy) outcome = 'busy'
    if (!w || outcome !== 'submitted') {
      frame.input.close()
      this.#stats.dropped++
      return outcome
    }
    const task: PendingTask = {
      taskId: frame.taskId,
      epoch: frame.epoch,
      frameId: frame.frameId,
      ts: frame.ts,
      roiCam: { ...frame.roiCam },
      letterbox: { ...frame.letterbox },
      submittedAt: this.#now(),
    }
    try {
      w.postMessage({ type: 'detect', frame }, [frame.input])
    } catch (err) {
      frame.input.close()
      this.#stats.errors++
      this.#lastError = String(err)
      return 'failed'
    }
    this.#lastTaskId = frame.taskId
    this.#pending = task
    this.#busy = true
    this.#stats.submitted++
    return 'submitted'
  }

  /** Loại mọi tác vụ đã gửi; tác vụ đang chạy vẫn giữ busy tới khi worker trả về (mục 5.10). */
  rejectAll(): void {
    this.#rejectedUpTo = this.#lastTaskId
    this.#pending = null
  }

  snapshot(): FaceSnapshot {
    return {
      ready: this.#ready,
      failed: this.#failed,
      delegate: this.#delegate,
      accepting: this.#accepting,
      busy: this.#busy,
      pendingTaskId: this.#pending?.taskId ?? null,
      rejectedUpTo: this.#rejectedUpTo,
      stats: { ...this.#stats },
      minIntervalMs: this.minIntervalMs(),
      lastError: this.#lastError,
    }
  }

  dispose(): void {
    this.#worker?.terminate()
    this.#worker = null
    this.#ready = false
    this.#busy = false
    this.#pending = null
  }

  #onMessage(msg: FaceWorkerOut): void {
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
      if (msg.taskId === null) {
        this.#fail(msg.message)
        return
      }
      this.#busy = false
      if (this.#pending?.taskId === msg.taskId) this.#pending = null
      this.#stats.errors++
      this.#lastError = msg.message
      this.#opts.onError?.(msg.message, msg.taskId)
      return
    }
    const delay = this.#opts.resultDelayMs?.() ?? 0
    if (delay > 0) {
      setTimeout(() => this.#handleResult(msg.result), delay)
      return
    }
    this.#handleResult(msg.result)
  }

  #handleResult(r: FaceResult): void {
    this.#busy = false
    this.#pushInfer(r.inferMs)
    const task = this.#pending
    if (!task || task.taskId !== r.taskId || r.taskId <= this.#rejectedUpTo) {
      // Kết quả về muộn của tác vụ đã bị loại, hoặc không khớp tác vụ đang chờ: bỏ, không vẽ.
      this.#stats.discarded++
      if (task && task.taskId === r.taskId) this.#pending = null
      return
    }
    this.#pending = null
    this.#stats.results++
    this.#stats.lastFaces = r.faces.length
    this.#opts.onResult?.(r, task)
    for (const cb of this.#resultListeners) cb(r, task)
  }

  /** PERF-01: p50 và p95 trên cửa sổ trượt (core/latency.ts); p50 giữ nguyên quy ước cũ. */
  #pushInfer(ms: number): void {
    this.#infer.push(ms)
    const s = this.#infer.stats()
    this.#stats.lastInferMs = ms
    this.#stats.p50InferMs = s.p50
    this.#stats.p95InferMs = s.p95
  }

  #fail(message: string): void {
    this.#failed = true
    this.#ready = false
    this.#busy = false
    this.#pending = null
    this.#lastError = message
    this.#opts.onError?.(message, null)
  }
}
