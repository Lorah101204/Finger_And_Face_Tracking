import { describe, expect, it } from 'vitest'
import {
  ClassifierClient,
  defaultClassifierInit,
  type ClassifierWorkerLike,
} from '../../src/classify/classifierClient'
import type { ClassifierWorkerIn, ClassifierWorkerOut } from '../../src/classify/classifierProtocol'
import type { RestrictedFrame } from '../../src/core/types'

// CLS-02 bước 4 (mục 7.23): ClassifierClient với worker giả, cùng khung với FaceClient: init, gating ready, accepting,
// busy; quyền sở hữu bitmap (transfer hoặc đóng ngay); rejectAll và kết quả về muộn; p50 và nhịp gợi ý 3 đến 5 Hz;
// lỗi worker.
class FakeWorker implements ClassifierWorkerLike {
  sent: ClassifierWorkerIn[] = []
  transfers: (Transferable[] | undefined)[] = []
  onmessage: ((e: MessageEvent<ClassifierWorkerOut>) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  terminated = false
  postMessage(msg: ClassifierWorkerIn, transfer?: Transferable[]) {
    this.sent.push(msg)
    this.transfers.push(transfer)
  }
  terminate() {
    this.terminated = true
  }
  emit(msg: ClassifierWorkerOut) {
    this.onmessage?.({ data: msg } as MessageEvent<ClassifierWorkerOut>)
  }
  result(taskId: number, probs: number[], inferMs = 30, epoch = 1) {
    this.emit({
      type: 'result',
      result: { taskId, epoch, frameId: taskId * 10, ts: taskId * 100, inferMs, probs },
    })
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
    roiCam: { x: 10, y: 20, w: 120, h: 100 },
    input: bitmap(),
    letterbox: { scale: 2, dx: 8, dy: 28, size: 256 },
  }
}

function setup(opts: ConstructorParameters<typeof ClassifierClient>[0] = {}) {
  const w = new FakeWorker()
  const errors: (number | null)[] = []
  const client = new ClassifierClient({
    createWorker: () => w,
    onError: (_m, id) => errors.push(id),
    ...opts,
  })
  const results: number[] = []
  client.subscribeResults((r) => results.push(r.taskId))
  client.start()
  return { w, client, results, errors }
}

const READY = {
  type: 'ready' as const,
  ep: 'wasm' as const,
  initMs: 200,
  warmupMs: 40,
  inputName: 'input',
  outputName: 'logits',
}

describe('ClassifierClient', () => {
  it('start gửi init với loader theo môi trường, model stub, EP webgpu rồi wasm, chuẩn hóa; start lần hai không tạo thêm', () => {
    const { w, client } = setup()
    expect(w.sent).toHaveLength(1)
    expect(w.sent[0]).toMatchObject({
      type: 'init',
      modelPath: '/models/classifier-stub.onnx',
      executionProviders: ['webgpu', 'wasm'],
      inputSize: 128,
      norm: { mean: 0.45, std: 0.225 },
      warmup: true,
    })
    expect(defaultClassifierInit().wasmPaths).toMatch(
      /^\/(node_modules\/onnxruntime-web\/dist|models\/ort)\//,
    )
    client.start()
    expect(w.sent).toHaveLength(1)
    const s = client.snapshot()
    expect(s.started).toBe(true)
    expect(s.ready).toBe(false)
    expect(s.modelPath).toBe('/models/classifier-stub.onnx')
  })

  it('chưa ready, chưa accepting hay đang bận thì drop và đóng bitmap; submit chuyển bitmap sang worker', () => {
    const { w, client } = setup()
    const f0 = frame(1)
    expect(client.submit(f0)).toBe('not-ready')
    expect(f0.input.closed).toBe(true)
    w.emit(READY)
    expect(client.ready).toBe(true)
    expect(client.snapshot()).toMatchObject({ ep: 'wasm', stats: { initMs: 200, warmupMs: 40 } })
    const f1 = frame(2)
    expect(client.submit(f1)).toBe('not-accepting')
    expect(f1.input.closed).toBe(true)
    client.setAccepting(true)
    expect(client.canAccept()).toBe(true)
    const f2 = frame(3)
    expect(client.submit(f2)).toBe('submitted')
    expect(f2.input.closed).toBe(false)
    expect(w.sent[1]).toMatchObject({ type: 'detect', frame: { taskId: 3 } })
    expect(w.transfers[1]).toEqual([f2.input])
    expect(client.busy).toBe(true)
    const f3 = frame(4)
    expect(client.submit(f3)).toBe('busy')
    expect(f3.input.closed).toBe(true)
    expect(client.stats).toMatchObject({ submitted: 1, dropped: 3 })
  })

  it('kết quả đúng tác vụ → listener, hết bận, p50/p95, lastProbs; nhịp gợi ý = max(1000 / 4, p50)', () => {
    const { w, client, results } = setup()
    w.emit(READY)
    client.setAccepting(true)
    expect(client.minIntervalMs()).toBe(250)
    client.submit(frame(1))
    w.result(1, [0.9, 0.1], 30)
    expect(results).toEqual([1])
    expect(client.busy).toBe(false)
    expect(client.stats).toMatchObject({
      results: 1,
      lastInferMs: 30,
      p50InferMs: 30,
      p95InferMs: 30,
      lastProbs: [0.9, 0.1],
    })
    // Cửa sổ 2 mẫu [30, 400]: hạng floor(p · (n − 1)) = 0 cho cả p50 lẫn p95 (core/latency.ts).
    client.submit(frame(2))
    w.result(2, [0.4, 0.6], 400)
    expect(client.stats.p50InferMs).toBe(30)
    expect(client.stats.p95InferMs).toBe(30)
    expect(client.minIntervalMs()).toBe(250)
    // 3 mẫu [30, 400, 400]: hạng 1 → p50 = p95 = 400 và nhịp gợi ý theo p50.
    client.submit(frame(3))
    w.result(3, [0.4, 0.6], 400)
    expect(client.stats.p50InferMs).toBe(400)
    expect(client.stats.p95InferMs).toBe(400)
    expect(client.minIntervalMs()).toBe(400)
  })

  it('rejectAll: kết quả về muộn của tác vụ đã loại bị bỏ (discarded), hết bận, không gọi listener; tác vụ mới sau đó nhận bình thường', () => {
    const { w, client, results } = setup()
    w.emit(READY)
    client.setAccepting(true)
    client.submit(frame(5))
    client.rejectAll()
    expect(client.rejectedUpTo).toBe(5)
    expect(client.busy).toBe(true)
    w.result(5, [0.9, 0.1])
    expect(results).toEqual([])
    expect(client.busy).toBe(false)
    expect(client.stats.discarded).toBe(1)
    client.submit(frame(6))
    w.result(6, [0.1, 0.9])
    expect(results).toEqual([6])
    // Kết quả không khớp tác vụ đang chờ cũng bị bỏ.
    client.submit(frame(7))
    w.result(99, [0.5, 0.5])
    expect(client.stats.discarded).toBe(2)
    expect(client.snapshot().pendingTaskId).toBe(7)
  })

  it('lỗi tác vụ: hết bận, đếm errors, giữ thông báo; lỗi init: failed, không ready; dispose terminate worker', () => {
    const { w, client, errors } = setup()
    w.emit(READY)
    client.setAccepting(true)
    client.submit(frame(1))
    w.emit({ type: 'error', taskId: 1, message: 'run lỗi' })
    expect(client.busy).toBe(false)
    expect(client.stats.errors).toBe(1)
    expect(client.snapshot().lastError).toBe('run lỗi')
    expect(errors).toEqual([1])
    w.emit({ type: 'error', taskId: null, message: 'model không nạp được' })
    expect(client.ready).toBe(false)
    expect(client.snapshot().failed).toBe(true)
    expect(errors).toEqual([1, null])
    client.dispose()
    expect(w.terminated).toBe(true)
  })
})
