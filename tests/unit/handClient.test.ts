import { describe, expect, it } from 'vitest'
import type { FrameSource } from '../../src/camera/frameSource'
import type { FrameStamp, HandResult } from '../../src/core/types'
import { HandClient, type HandWorkerLike } from '../../src/hands/handClient'
import type { HandWorkerIn, HandWorkerOut } from '../../src/hands/handProtocol'

// HAND-01 bước 1 (mục 7.13): HandClient với worker giả và createImageBitmap giả. Kiểm init, gating ready/busy, bitmap
// transfer và quyền sở hữu, kết quả, lỗi, dispose trong lúc chờ bitmap.
class FakeWorker implements HandWorkerLike {
  sent: HandWorkerIn[] = []
  transfers: (Transferable[] | undefined)[] = []
  onmessage: ((e: MessageEvent<HandWorkerOut>) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  terminated = false
  postMessage(msg: HandWorkerIn, transfer?: Transferable[]) {
    this.sent.push(msg)
    this.transfers.push(transfer)
  }
  terminate() {
    this.terminated = true
  }
  emit(msg: HandWorkerOut) {
    this.onmessage?.({ data: msg } as MessageEvent<HandWorkerOut>)
  }
}

type Bitmap = ImageBitmap & { closed: boolean }
function bitmap(): Bitmap {
  const b = { width: 1280, height: 720, closed: false, close() {} }
  b.close = () => {
    b.closed = true
  }
  return b as unknown as Bitmap
}

function source(stamp: FrameStamp | null, drawable = true): FrameSource {
  return {
    width: 1280,
    height: 720,
    drawable: drawable ? ({} as CanvasImageSource) : null,
    lastStamp: stamp,
    onFrame: () => () => {},
    stop() {},
  }
}

const stamp = (frameId: number): FrameStamp => ({ frameId, ts: 1000 + frameId * 33 })
const flush = () => new Promise((r) => setTimeout(r, 0))

function setup(opts: ConstructorParameters<typeof HandClient>[0] = {}) {
  const w = new FakeWorker()
  const bitmaps: Bitmap[] = []
  const results: HandResult[] = []
  const errors: (number | null)[] = []
  const client = new HandClient({
    createWorker: () => w,
    createBitmap: async () => {
      const b = bitmap()
      bitmaps.push(b)
      return b
    },
    onError: (_m, id) => errors.push(id),
    ...opts,
  })
  client.subscribeResults((r) => results.push(r))
  client.start()
  return { w, client, bitmaps, results, errors }
}

const ready = (w: FakeWorker) =>
  w.emit({ type: 'ready', delegate: 'CPU', initMs: 200, warmupMs: 30 })
const result = (w: FakeWorker, frameId: number, hands = 0, inferMs = 40): void =>
  w.emit({
    type: 'result',
    result: {
      frameId,
      ts: 1000 + frameId * 33,
      epoch: 1,
      inferMs,
      width: 1280,
      height: 720,
      hands: Array.from({ length: hands }, () => ({
        label: 'Right',
        score: 0.9,
        landmarksNorm: [[0.5, 0.5, 0]],
      })),
    },
  })

describe('HandClient', () => {
  it('start gửi init mặc định (D-009: CPU, 2 tay); start lại không gửi thêm; chưa ready thì not-ready và không bận', () => {
    const { w, client } = setup()
    expect(w.sent).toHaveLength(1)
    expect(w.sent[0]).toMatchObject({
      type: 'init',
      modelPath: '/models/hand_landmarker.task',
      delegate: 'CPU',
      numHands: 2,
      useModuleLoader: true,
      warmupSize: 256,
    })
    client.start()
    expect(w.sent).toHaveLength(1)
    expect(client.started).toBe(true)
    expect(client.submit(source(stamp(1)), stamp(1), 1)).toBe('not-ready')
    expect(client.busy).toBe(false)
  })

  it('ready: submit bận ngay, bitmap được tạo rồi transfer trong detect; bận thì busy; kết quả về thì rảnh và báo listener', async () => {
    const { w, client, bitmaps, results } = setup()
    ready(w)
    expect(client.snapshot()).toMatchObject({
      ready: true,
      delegate: 'CPU',
      stats: { initMs: 200 },
    })
    expect(client.canAccept()).toBe(true)
    expect(client.submit(source(stamp(1)), stamp(1), 5)).toBe('submitted')
    expect(client.busy).toBe(true)
    expect(client.submit(source(stamp(2)), stamp(2), 5)).toBe('busy')
    await flush()
    expect(w.sent).toHaveLength(2)
    expect(w.sent[1]).toEqual({
      type: 'detect',
      frame: { frameId: 1, ts: 1033, epoch: 5, input: bitmaps[0] },
    })
    expect(w.transfers[1]).toEqual([bitmaps[0]])
    expect(bitmaps[0].closed).toBe(false)
    expect(client.stats.submitted).toBe(1)
    result(w, 1, 2, 40)
    expect(client.busy).toBe(false)
    expect(results).toHaveLength(1)
    expect(results[0].hands).toHaveLength(2)
    expect(client.snapshot().stats).toMatchObject({
      results: 1,
      lastHands: 2,
      lastInferMs: 40,
      p50InferMs: 40,
    })
  })

  it('nguồn chưa có drawable: no-frame, không bận; kết quả lệch frameId: bỏ (discarded)', async () => {
    const { w, client, results } = setup()
    ready(w)
    expect(client.submit(source(stamp(1), false), stamp(1), 1)).toBe('no-frame')
    expect(client.busy).toBe(false)
    expect(client.submit(source(stamp(2)), stamp(2), 1)).toBe('submitted')
    await flush()
    result(w, 99)
    expect(client.busy).toBe(false)
    expect(results).toHaveLength(0)
    expect(client.stats.discarded).toBe(1)
  })

  it('dispose trong lúc chờ bitmap: bitmap đóng, không gửi detect, worker terminate', async () => {
    const { w, client, bitmaps } = setup()
    ready(w)
    client.submit(source(stamp(1)), stamp(1), 1)
    client.dispose()
    await flush()
    expect(w.terminated).toBe(true)
    expect(w.sent).toHaveLength(1)
    expect(bitmaps[0].closed).toBe(true)
    expect(client.busy).toBe(false)
    expect(client.ready).toBe(false)
    // Start lại sau dispose (StrictMode mount lại): worker mới, init gửi lại.
    client.start()
    expect(client.started).toBe(true)
    expect(w.sent.filter((m) => m.type === 'init')).toHaveLength(2)
  })

  it('lỗi của một frame: rảnh, errors++, onError; lỗi init: failed, ready false; createImageBitmap lỗi: rảnh', async () => {
    const { w, client, errors } = setup()
    ready(w)
    client.submit(source(stamp(1)), stamp(1), 1)
    await flush()
    w.emit({ type: 'error', frameId: 1, message: 'x' })
    expect(client.busy).toBe(false)
    expect(client.stats.errors).toBe(1)
    expect(errors).toEqual([1])
    w.emit({ type: 'error', frameId: null, message: 'init' })
    expect(client.snapshot()).toMatchObject({ failed: true, ready: false, lastError: 'init' })
    expect(errors).toEqual([1, null])

    const bad = new FakeWorker()
    const c2 = new HandClient({
      createWorker: () => bad,
      createBitmap: () => Promise.reject(new Error('no bitmap')),
    })
    c2.start()
    bad.emit({ type: 'ready', delegate: 'GPU', initMs: 1, warmupMs: 1 })
    expect(c2.submit(source(stamp(3)), stamp(3), 1)).toBe('submitted')
    await flush()
    expect(c2.busy).toBe(false)
    expect(c2.stats.errors).toBe(1)
    expect(bad.sent).toHaveLength(1)
  })
})
