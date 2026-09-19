import { describe, expect, it } from 'vitest'
import type { FrameSource } from '../../src/camera/frameSource'
import type { FrameStamp } from '../../src/core/types'
import { HandClient, type HandWorkerLike } from '../../src/hands/handClient'
import { createHandPipeline } from '../../src/hands/handPipeline'
import type { HandWorkerIn, HandWorkerOut } from '../../src/hands/handProtocol'

// HAND-01 bước 4: pipeline chỉ gửi khi worker rảnh và nguồn có frameId mới; kết quả → tracker → latest; đổi cờ swap
// thì tracker reset (id mới); reset và dispose.
class FakeWorker implements HandWorkerLike {
  sent: HandWorkerIn[] = []
  onmessage: ((e: MessageEvent<HandWorkerOut>) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  terminated = false
  postMessage(msg: HandWorkerIn) {
    this.sent.push(msg)
  }
  terminate() {
    this.terminated = true
  }
  emit(msg: HandWorkerOut) {
    this.onmessage?.({ data: msg } as MessageEvent<HandWorkerOut>)
  }
}

const NORM = Array.from(
  { length: 21 },
  (_, i) => [0.4 + 0.005 * i, 0.5, 0] as [number, number, number],
)
const flush = () => new Promise((r) => setTimeout(r, 0))

function makeSource(): FrameSource & { stamp: FrameStamp | null } {
  const s = {
    width: 1280,
    height: 720,
    drawable: {} as CanvasImageSource,
    stamp: null as FrameStamp | null,
    get lastStamp() {
      return s.stamp
    },
    onFrame: () => () => {},
    stop() {},
  }
  return s
}

function setup() {
  const w = new FakeWorker()
  const client = new HandClient({
    createWorker: () => w,
    createBitmap: async () => ({ width: 1280, height: 720, close() {} }) as ImageBitmap,
  })
  let swap = false
  const pipe = createHandPipeline({ client, swap: () => swap })
  const source = makeSource()
  const emit = (frameId: number, label = 'Right') =>
    w.emit({
      type: 'result',
      result: {
        frameId,
        ts: frameId * 33,
        epoch: 1,
        inferMs: 30,
        width: 1280,
        height: 720,
        hands: [{ label, score: 0.9, landmarksNorm: NORM }],
      },
    })
  return { w, client, pipe, source, emit, setSwap: (v: boolean) => (swap = v) }
}

describe('createHandPipeline', () => {
  it('feed lần đầu start worker; chưa ready hoặc chưa có frame thì không gửi; ready thì gửi mỗi frameId mới một lần', async () => {
    const { w, client, pipe, source } = setup()
    expect(client.started).toBe(false)
    pipe.feed(source, 1)
    expect(client.started).toBe(true)
    expect(pipe.snapshot().stats).toEqual({ fed: 0, skipped: 0, results: 0 })
    source.stamp = { frameId: 1, ts: 33 }
    pipe.feed(source, 1)
    expect(pipe.snapshot().stats.skipped).toBe(1)
    w.emit({ type: 'ready', delegate: 'CPU', initMs: 100, warmupMs: 10 })
    pipe.feed(source, 1)
    pipe.feed(source, 1)
    await flush()
    expect(w.sent.filter((m) => m.type === 'detect')).toHaveLength(1)
    expect(pipe.snapshot().stats).toMatchObject({ fed: 1 })
    source.stamp = { frameId: 2, ts: 66 }
    pipe.feed(source, 1)
    expect(pipe.snapshot().stats.skipped).toBe(2)
  })

  it('kết quả về → HandFrame với track px camera; đổi swap thì tracker reset và nhãn đảo; reset xóa latest; dispose terminate', async () => {
    const { w, client, pipe, source, emit, setSwap } = setup()
    // feed đầu tiên mới start worker (onmessage được gắn), sau đó worker mới báo ready.
    pipe.feed(source, 1)
    w.emit({ type: 'ready', delegate: 'CPU', initMs: 100, warmupMs: 10 })
    source.stamp = { frameId: 1, ts: 33 }
    pipe.feed(source, 1)
    await flush()
    emit(1)
    const f1 = pipe.latest!
    expect(f1.frameId).toBe(1)
    expect(f1.hands.map((h) => [h.id, h.handedness])).toEqual([[1, 'right']])
    expect(f1.hands[0].landmarksCam[0]).toEqual({ x: 0.4 * 1280, y: 360 })
    expect(pipe.snapshot()).toMatchObject({ swap: false, stats: { results: 1 } })
    source.stamp = { frameId: 2, ts: 66 }
    pipe.feed(source, 1)
    await flush()
    setSwap(true)
    emit(2)
    expect(pipe.latest!.hands.map((h) => [h.id, h.handedness])).toEqual([[2, 'left']])
    expect(pipe.snapshot().swap).toBe(true)
    pipe.reset()
    expect(pipe.latest).toBeNull()
    pipe.dispose()
    expect(w.terminated).toBe(true)
    expect(client.started).toBe(false)
    // Mount lại (StrictMode): feed start worker mới trên cùng client và vẫn nhận kết quả.
    pipe.feed(source, 1)
    expect(client.started).toBe(true)
    w.emit({ type: 'ready', delegate: 'CPU', initMs: 100, warmupMs: 10 })
    source.stamp = { frameId: 3, ts: 99 }
    pipe.feed(source, 1)
    await flush()
    emit(3)
    expect(pipe.latest?.frameId).toBe(3)
  })

  it('ROI-01 debug: setFake thay worker bằng HandFrame giả lập sinh mỗi feed với now của vòng lặp; worker không được start', () => {
    const { w, client, pipe, source } = setup()
    pipe.setFake((now, frameId) => ({ frameId, ts: now, hands: [], uncertain: false }))
    source.stamp = { frameId: 1, ts: 33 }
    pipe.feed(source, 1, 500)
    expect(client.started).toBe(false)
    expect(w.sent).toHaveLength(0)
    expect(pipe.latest).toEqual({ frameId: 1, ts: 500, hands: [], uncertain: false })
    pipe.feed(source, 1, 516)
    expect(pipe.latest).toMatchObject({ frameId: 2, ts: 516 })
    expect(pipe.snapshot()).toMatchObject({ fake: true, stats: { fed: 0 } })
    pipe.reset()
    expect(pipe.latest).toBeNull()
    pipe.feed(source, 1, 533)
    expect(pipe.latest?.frameId).toBe(3)
    pipe.setFake(null)
    expect(pipe.latest).toBeNull()
    expect(pipe.snapshot().fake).toBe(false)
    pipe.feed(source, 1)
    expect(client.started).toBe(true)
  })
})
