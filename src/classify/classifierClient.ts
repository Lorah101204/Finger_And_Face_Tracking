// CLS-02 bước 4: ClassifierClient ở main thread, cùng khung với FaceClient (FACE-01): một tác vụ tại một thời điểm,
// submit khi ready, accepting và không bận, ngược lại drop (bitmap đóng ngay); rejectAll đánh dấu mọi taskId đã gửi là
// bị loại (kết quả về muộn bị bỏ, mục 5.10); nhịp gợi ý minIntervalMs = max(1000 / targetHz, p50 inferMs) với targetHz
// 3 đến 5. Chỉ import core/ và file cùng thư mục (lint:boundaries, I1); đây là nơi duy nhất tạo worker phân loại.
import { DEFAULTS, modelUrls } from '../core/config'
import { createLatencyWindow, type LatencyWindow } from '../core/latency'
import type { ClassifyResult, Rect, RestrictedFrame } from '../core/types'
import type {
  ClassifierEp,
  ClassifierInitMessage,
  ClassifierWorkerIn,
  ClassifierWorkerOut,
} from './classifierProtocol'

export type ClassifyTask = {
  taskId: number
  epoch: number
  frameId: number
  ts: number
  roiCam: Rect
  submittedAt: number
}

export type ClassifySubmitOutcome = 'submitted' | 'not-ready' | 'not-accepting' | 'busy' | 'failed'

export type ClassifierStats = {
  submitted: number
  dropped: number
  results: number
  discarded: number
  errors: number
  lastInferMs: number
  p50InferMs: number
  p95InferMs: number
  initMs: number
  warmupMs: number
  /** probs của kết quả gần nhất (kể cả bị loại) để debug. */
  lastProbs: number[]
}

export type ClassifierSnapshot = {
  started: boolean
  ready: boolean
  failed: boolean
  ep: ClassifierEp | null
  accepting: boolean
  busy: boolean
  pendingTaskId: number | null
  rejectedUpTo: number
  stats: ClassifierStats
  minIntervalMs: number
  lastError: string | null
  modelPath: string
}

export type ClassifierWorkerLike = {
  postMessage(msg: ClassifierWorkerIn, transfer?: Transferable[]): void
  onmessage: ((e: MessageEvent<ClassifierWorkerOut>) => void) | null
  onerror: ((e: ErrorEvent) => void) | null
  terminate(): void
}

export type ClassifierClientOptions = {
  createWorker?: () => ClassifierWorkerLike
  init?: Partial<Omit<ClassifierInitMessage, 'type'>>
  targetHz?: number
  window?: number
  onReady?: (snap: ClassifierSnapshot) => void
  onError?: (message: string, taskId: number | null) => void
  now?: () => number
}

export type ClassifyResultListener = (result: ClassifyResult, task: ClassifyTask) => void

/** D-013: loader ORT ở node_modules khi dev (Vite từ chối import() từ public/), ở /models/ort/ khi build; REL-01: đã ghép base. */
export function defaultClassifierInit(): Omit<ClassifierInitMessage, 'type'> {
  const c = DEFAULTS.classifier
  const urls = modelUrls()
  return {
    wasmPaths: urls.ortPaths,
    modelPath: urls.classifierModel,
    executionProviders: [...c.executionProviders],
    inputSize: c.inputSize,
    norm: { ...c.norm },
    warmup: true,
  }
}

function createModuleWorker(): ClassifierWorkerLike {
  return new Worker(new URL('./classifier.worker.ts', import.meta.url), {
    type: 'module',
  }) as unknown as ClassifierWorkerLike
}

export class ClassifierClient {
  #opts: ClassifierClientOptions
  #init: Omit<ClassifierInitMessage, 'type'>
  #targetHz: number
  #now: () => number
  #worker: ClassifierWorkerLike | null = null
  #started = false
  #ready = false
  #failed = false
  #ep: ClassifierEp | null = null
  #accepting = false
  #busy = false
  #pending: ClassifyTask | null = null
  #lastTaskId = 0
  #rejectedUpTo = 0
  #lastError: string | null = null
  #infer: LatencyWindow
  #listeners = new Set<ClassifyResultListener>()
  #stats: ClassifierStats = {
    submitted: 0,
    dropped: 0,
    results: 0,
    discarded: 0,
    errors: 0,
    lastInferMs: 0,
    p50InferMs: 0,
    p95InferMs: 0,
    initMs: 0,
    warmupMs: 0,
    lastProbs: [],
  }

  constructor(opts: ClassifierClientOptions = {}) {
    this.#opts = opts
    this.#init = { ...defaultClassifierInit(), ...opts.init }
    this.#targetHz = opts.targetHz ?? DEFAULTS.classifier.targetHz
    this.#infer = createLatencyWindow(opts.window ?? 20)
    this.#now = opts.now ?? (() => performance.now())
  }

  /** Tạo worker và gửi init. Đang có worker thì không làm gì. */
  start(): void {
    if (this.#worker) return
    const w = (this.#opts.createWorker ?? createModuleWorker)()
    w.onmessage = (e) => this.#onMessage(e.data)
    w.onerror = (e) => this.#fail(e.message || 'lỗi worker phân loại')
    this.#worker = w
    this.#started = true
    w.postMessage({ type: 'init', ...this.#init })
  }

  get started(): boolean {
    return this.#started
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
  get stats(): Readonly<ClassifierStats> {
    return this.#stats
  }
  get rejectedUpTo(): number {
    return this.#rejectedUpTo
  }

  subscribeResults(cb: ClassifyResultListener): () => void {
    this.#listeners.add(cb)
    return () => {
      this.#listeners.delete(cb)
    }
  }

  setAccepting(on: boolean): void {
    this.#accepting = on
  }

  canAccept(): boolean {
    return this.#ready && this.#accepting && !this.#busy
  }

  /** Nhịp gửi gợi ý: không nhanh hơn targetHz (3 đến 5 Hz) và không nhanh hơn p50 inferMs. */
  minIntervalMs(): number {
    return Math.max(1000 / this.#targetHz, this.#stats.p50InferMs)
  }

  /** Luôn nhận quyền sở hữu bitmap: transfer sang worker, hoặc đóng ngay khi drop. */
  submit(frame: RestrictedFrame): ClassifySubmitOutcome {
    const w = this.#worker
    let outcome: ClassifySubmitOutcome = 'submitted'
    if (!w || !this.#ready) outcome = 'not-ready'
    else if (!this.#accepting) outcome = 'not-accepting'
    else if (this.#busy) outcome = 'busy'
    if (!w || outcome !== 'submitted') {
      frame.input.close()
      this.#stats.dropped++
      return outcome
    }
    const task: ClassifyTask = {
      taskId: frame.taskId,
      epoch: frame.epoch,
      frameId: frame.frameId,
      ts: frame.ts,
      roiCam: { ...frame.roiCam },
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

  /** Loại mọi tác vụ đã gửi; tác vụ đang chạy vẫn giữ busy tới khi worker trả về. */
  rejectAll(): void {
    this.#rejectedUpTo = this.#lastTaskId
    this.#pending = null
  }

  snapshot(): ClassifierSnapshot {
    return {
      started: this.#started,
      ready: this.#ready,
      failed: this.#failed,
      ep: this.#ep,
      accepting: this.#accepting,
      busy: this.#busy,
      pendingTaskId: this.#pending?.taskId ?? null,
      rejectedUpTo: this.#rejectedUpTo,
      stats: { ...this.#stats, lastProbs: [...this.#stats.lastProbs] },
      minIntervalMs: this.minIntervalMs(),
      lastError: this.#lastError,
      modelPath: this.#init.modelPath,
    }
  }

  dispose(): void {
    this.#worker?.terminate()
    this.#worker = null
    this.#ready = false
    this.#busy = false
    this.#pending = null
  }

  #onMessage(msg: ClassifierWorkerOut): void {
    if (msg.type === 'ready') {
      this.#ready = true
      this.#failed = false
      this.#ep = msg.ep
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
    const r = msg.result
    this.#busy = false
    this.#infer.push(r.inferMs)
    const s = this.#infer.stats()
    this.#stats.lastInferMs = r.inferMs
    this.#stats.p50InferMs = s.p50
    this.#stats.p95InferMs = s.p95
    this.#stats.lastProbs = [...r.probs]
    const task = this.#pending
    if (!task || task.taskId !== r.taskId || r.taskId <= this.#rejectedUpTo) {
      this.#stats.discarded++
      if (task && task.taskId === r.taskId) this.#pending = null
      return
    }
    this.#pending = null
    this.#stats.results++
    for (const cb of this.#listeners) cb(r, task)
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
