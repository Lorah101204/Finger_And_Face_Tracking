import { afterEach, describe, expect, it, vi } from 'vitest'
import { FaceClient, type WorkerLike } from '../../src/face/faceClient'
import type { FaceWorkerIn, FaceWorkerOut } from '../../src/face/faceProtocol'
import type { RestrictedFrame } from '../../src/core/types'

// FACE-01: FaceClient với worker giả (mục 7.11). Kiểm init, gating ready/accepting/busy, quyền sở hữu bitmap,
// rejectAll và kết quả về muộn, p50 và nhịp gợi ý, lỗi worker.
class FakeWorker implements WorkerLike {
  sent: FaceWorkerIn[] = []
  transfers: (Transferable[] | undefined)[] = []
  onmessage: ((e: MessageEvent<FaceWorkerOut>) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  terminated = false
  postMessage(msg: FaceWorkerIn, transfer?: Transferable[]) {
    this.sent.push(msg)
    this.transfers.push(transfer)
  }
  terminate() {
    this.terminated = true
  }
  emit(msg: FaceWorkerOut) {
    this.onmessage?.({ data: msg } as MessageEvent<FaceWorkerOut>)
  }
}

type Bitmap = ImageBitmap & { closed: boolean }
function bitmap(): Bitmap {
  const b = { width: 256, height: 256, closed: false, close() {} }
  b.close = () => {
    b.closed = true
  }
  return b as unknown as Bitmap
}

function frame(taskId: number, epoch = 1): RestrictedFrame & { input: Bitmap } {
  return {
    taskId,
    epoch,
    frameId: taskId * 10,
    ts: taskId * 100,
    roiCam: { x: 10, y: 20, w: 100, h: 100 },
    input: bitmap(),
    letterbox: { scale: 2.56, dx: 0, dy: 0, size: 256 },
  }
}

function setup(opts: ConstructorParameters<typeof FaceClient>[0] = {}) {
  const w = new FakeWorker()
  const results: number[] = []
  const errors: (number | null)[] = []
  const client = new FaceClient({
    createWorker: () => w,
    onResult: (r) => results.push(r.taskId),
    onError: (_m, id) => errors.push(id),
    ...opts,
  })
  client.start()
  return { w, client, results, errors }
}

const ready = (w: FakeWorker) =>
  w.emit({ type: 'ready', delegate: 'GPU', initMs: 300, warmupMs: 20 })
const result = (w: FakeWorker, taskId: number, faces = 0, inferMs = 10, epoch = 1) =>
  w.emit({
    type: 'result',
    result: {
      taskId,
      epoch,
      frameId: taskId * 10,
      ts: taskId * 100,
      inferMs,
      faces: Array.from({ length: faces }, () => ({ landmarksNorm: [[0.5, 0.5, 0]] })),
    },
  })

describe('FaceClient', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('start gửi init với mặc định D-008; chưa ready thì submit bị drop và bitmap được đóng', () => {
    const { w, client } = setup()
    expect(w.sent).toHaveLength(1)
    expect(w.sent[0]).toMatchObject({
      type: 'init',
      modelPath: '/models/face_landmarker.task',
      delegate: 'GPU',
      numFaces: 2,
      useModuleLoader: true,
      warmupSize: 256,
    })
    expect((w.sent[0] as { wasmBasePath: string }).wasmBasePath).toMatch(/wasm$/)
    client.start()
    expect(w.sent).toHaveLength(1)
    const f = frame(1)
    expect(client.submit(f)).toBe('not-ready')
    expect(f.input.closed).toBe(true)
    expect(client.snapshot()).toMatchObject({ ready: false, busy: false, stats: { dropped: 1 } })
    expect(w.sent).toHaveLength(1)
  })

  it('ready rồi: chỉ gửi khi accepting và không bận; detect transfer đúng bitmap; kết quả về thì rảnh và gọi onResult với task', () => {
    const { w, client, results } = setup()
    ready(w)
    expect(client.snapshot()).toMatchObject({
      ready: true,
      delegate: 'GPU',
      stats: { initMs: 300 },
    })
    const f0 = frame(1)
    expect(client.submit(f0)).toBe('not-accepting')
    expect(f0.input.closed).toBe(true)
    client.setAccepting(true)
    expect(client.canAccept()).toBe(true)
    const f1 = frame(2)
    expect(client.submit(f1)).toBe('submitted')
    expect(f1.input.closed).toBe(false)
    expect(w.sent.at(-1)).toEqual({ type: 'detect', frame: f1 })
    expect(w.transfers.at(-1)).toEqual([f1.input])
    expect(client.busy).toBe(true)
    expect(client.canAccept()).toBe(false)
    const f2 = frame(3)
    expect(client.submit(f2)).toBe('busy')
    expect(f2.input.closed).toBe(true)
    result(w, 2, 1, 12)
    expect(client.busy).toBe(false)
    expect(results).toEqual([2])
    expect(client.snapshot().stats).toMatchObject({
      submitted: 1,
      dropped: 2,
      results: 1,
      lastFaces: 1,
      lastInferMs: 12,
      p50InferMs: 12,
    })
  })

  it('onResult nhận task đã lưu: roiCam, letterbox, ts, epoch là bản sao lúc gửi', () => {
    let seen: { roiCam: unknown; letterbox: unknown; ts: number; epoch: number } | null = null
    const { w, client } = setup({ onResult: (_r, t) => (seen = t), now: () => 777 })
    ready(w)
    client.setAccepting(true)
    const f = frame(5, 3)
    client.submit(f)
    f.roiCam.x = 999
    result(w, 5, 0, 8, 3)
    expect(seen).toMatchObject({
      taskId: 5,
      epoch: 3,
      ts: 500,
      roiCam: { x: 10, y: 20, w: 100, h: 100 },
      letterbox: { scale: 2.56, dx: 0, dy: 0, size: 256 },
      submittedAt: 777,
    })
  })

  it('rejectAll khi bận: busy giữ tới khi kết quả về rồi bị loại; kết quả lạ cũng bị loại; gửi lại được', () => {
    const { w, client, results } = setup()
    ready(w)
    client.setAccepting(true)
    client.submit(frame(1))
    client.rejectAll()
    expect(client.busy).toBe(true)
    expect(client.snapshot()).toMatchObject({ pendingTaskId: null, rejectedUpTo: 1 })
    result(w, 1)
    expect(client.busy).toBe(false)
    expect(results).toEqual([])
    expect(client.snapshot().stats.discarded).toBe(1)
    result(w, 99)
    expect(client.snapshot().stats.discarded).toBe(2)
    client.submit(frame(2))
    result(w, 2)
    expect(results).toEqual([2])
  })

  it('nhịp gợi ý: max(1000 / targetHz, p50 inferMs) trên cửa sổ mẫu trượt', () => {
    const { w, client } = setup({ targetHz: 12, window: 3 })
    ready(w)
    client.setAccepting(true)
    expect(client.minIntervalMs()).toBeCloseTo(1000 / 12, 6)
    for (const [id, ms] of [
      [1, 100],
      [2, 120],
      [3, 90],
    ] as const) {
      client.submit(frame(id))
      result(w, id, 0, ms)
    }
    expect(client.snapshot().stats.p50InferMs).toBe(100)
    expect(client.minIntervalMs()).toBe(100)
    client.submit(frame(4))
    result(w, 4, 0, 30)
    // cửa sổ 3 mẫu: [120, 90, 30] → p50 = 90 ≥ 83.3
    expect(client.snapshot().stats.p50InferMs).toBe(90)
    client.submit(frame(5))
    result(w, 5, 0, 20)
    // [90, 30, 20] → p50 = 30 < 83.3 → nhịp về targetHz
    expect(client.minIntervalMs()).toBeCloseTo(1000 / 12, 6)
  })

  it('lỗi tác vụ: rảnh lại, đếm errors, onError với taskId; lỗi init (taskId null): failed, không ready', () => {
    const { w, client, errors } = setup()
    ready(w)
    client.setAccepting(true)
    client.submit(frame(1))
    w.emit({ type: 'error', taskId: 1, message: 'detect hỏng' })
    expect(client.busy).toBe(false)
    expect(client.snapshot()).toMatchObject({
      ready: true,
      failed: false,
      pendingTaskId: null,
      lastError: 'detect hỏng',
      stats: { errors: 1 },
    })
    expect(errors).toEqual([1])
    w.emit({ type: 'error', taskId: null, message: 'wasm không nạp được' })
    expect(client.snapshot()).toMatchObject({ ready: false, failed: true })
    const f = frame(2)
    expect(client.submit(f)).toBe('not-ready')
    expect(f.input.closed).toBe(true)
    expect(errors).toEqual([1, null])
  })

  it('worker onerror: failed; dispose thì terminate và không còn ready', () => {
    const { w, client } = setup()
    ready(w)
    w.onerror?.({ message: 'crash' } as ErrorEvent)
    expect(client.snapshot()).toMatchObject({ failed: true, ready: false, lastError: 'crash' })
    client.dispose()
    expect(w.terminated).toBe(true)
    expect(client.ready).toBe(false)
  })

  it('subscribeResults nhận (result, task) sau lọc rejectAll; hủy đăng ký thì thôi', () => {
    const { w, client } = setup()
    ready(w)
    client.setAccepting(true)
    const seen: number[] = []
    const off = client.subscribeResults((r, t) => seen.push(r.taskId * 100 + t.taskId))
    client.submit(frame(1))
    result(w, 1)
    client.submit(frame(2))
    client.rejectAll()
    result(w, 2)
    off()
    client.submit(frame(3))
    result(w, 3)
    expect(seen).toEqual([101])
  })

  it('resultDelayMs: kết quả được giữ lại đúng khoảng trễ, busy giữ trong lúc chờ (kịch bản delayWorker)', () => {
    vi.useFakeTimers()
    let delay = 500
    const { w, client, results } = setup({ resultDelayMs: () => delay })
    ready(w)
    client.setAccepting(true)
    client.submit(frame(1))
    result(w, 1)
    expect(client.busy).toBe(true)
    expect(results).toEqual([])
    vi.advanceTimersByTime(499)
    expect(client.busy).toBe(true)
    vi.advanceTimersByTime(1)
    expect(client.busy).toBe(false)
    expect(results).toEqual([1])
    delay = 0
    client.submit(frame(2))
    result(w, 2)
    expect(results).toEqual([1, 2])
  })

  it('postMessage ném lỗi: failed outcome, bitmap đóng, không bận', () => {
    const w = new FakeWorker()
    w.postMessage = (msg) => {
      if (msg.type === 'detect') throw new Error('detached')
    }
    const client = new FaceClient({ createWorker: () => w })
    client.start()
    ready(w)
    client.setAccepting(true)
    const f = frame(1)
    expect(client.submit(f)).toBe('failed')
    expect(f.input.closed).toBe(true)
    expect(client.busy).toBe(false)
    expect(client.snapshot().stats).toMatchObject({ submitted: 0, errors: 1 })
  })
})
