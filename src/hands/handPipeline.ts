// HAND-01 bước 4: nối HandClient (worker) với HandTracker và giữ HandFrame mới nhất cho vòng lặp, overlay debug và
// ROI-03 (fingertips đọc `latest`). Vòng lặp gọi feed() mỗi frame khi nguồn cửa sổ là tay: gửi frame gốc khi worker rảnh
// và nguồn có frame mới (không xếp hàng). Kết quả về → resultToDetections (chuẩn hóa handedness theo cờ swap hiện
// tại, D-010) → tracker.update → latest. Đổi cờ swap thì tracker reset (id mới) vì nhãn cũ không còn đúng.
// ROI-01 (debug, TEST-00): setFake(gen) thay worker bằng HandFrame giả lập sinh mỗi lần feed (kịch bản
// window.__scenario.hands) để e2e kiểm solver và cửa sổ theo tay không cần ảnh tay thật; worker không được gọi khi
// đang giả lập.
import { DEFAULTS } from '../core/config'
import type { HandFrame, HandResult } from '../core/types'
import type { FrameSource } from '../camera/frameSource'
import type { HandClient, HandSnapshot } from './handClient'
import { resultToDetections } from './handLandmarker'
import { HandTracker, type HandTrackerStats } from './handTracker'

export type HandPipelineStats = {
  /** số lần feed() gửi được frame */
  fed: number
  /** số lần feed() có frame mới nhưng worker chưa sẵn sàng hoặc bận */
  skipped: number
  results: number
}

export type HandPipelineSnapshot = {
  client: HandSnapshot
  latest: HandFrame | null
  swap: boolean
  /** ROI-01 debug: HandFrame đang do kịch bản giả lập, worker không chạy. */
  fake: boolean
  stats: HandPipelineStats
  tracker: HandTrackerStats
}

export type HandPipelineOptions = {
  client: HandClient
  tracker?: HandTracker
  /** Cờ đảo trái/phải hiện tại (settings.handednessSwap); mặc định theo config. */
  swap?: () => boolean
}

/** Sinh HandFrame giả lập tại thời điểm now (ms của vòng lặp), frameId tăng dần. */
export type FakeHandFrames = (now: number, frameId: number) => HandFrame | null

export type HandPipeline = {
  /**
   * Gửi frame gốc hiện tại nếu worker rảnh và frameId mới; tự start() worker lần đầu (và sau dispose). `now` là mốc
   * của frame render (rAF), chỉ dùng cho giả lập.
   */
  feed(source: FrameSource, epoch: number, now?: number): void
  readonly latest: HandFrame | null
  /** Debug: thay worker bằng HandFrame giả lập (null để về worker thật); đổi thì xóa track và HandFrame. */
  setFake(gen: FakeHandFrames | null): void
  /** Xóa track và HandFrame (khi nguồn cửa sổ rời khỏi tay, đổi camera). */
  reset(): void
  snapshot(): HandPipelineSnapshot
  dispose(): void
}

export function createHandPipeline(opts: HandPipelineOptions): HandPipeline {
  const { client } = opts
  const tracker = opts.tracker ?? new HandTracker()
  const swapOf = opts.swap ?? (() => DEFAULTS.hands.handednessSwap)
  let latest: HandFrame | null = null
  let lastFedFrameId = -1
  let lastSwap = swapOf()
  let fake: FakeHandFrames | null = null
  let fakeFrameId = 0
  const stats: HandPipelineStats = { fed: 0, skipped: 0, results: 0 }

  function onResult(r: HandResult): void {
    const swap = swapOf()
    if (swap !== lastSwap) {
      lastSwap = swap
      tracker.reset()
    }
    stats.results++
    latest = tracker.update(resultToDetections(r, { swap }), r.frameId, r.ts, r.width, r.height)
  }
  // Giữ đăng ký qua dispose: StrictMode dispose rồi mount lại và feed() start worker mới trên cùng client.
  client.subscribeResults(onResult)

  return {
    feed(source, epoch, now = performance.now()) {
      if (fake) {
        latest = fake(now, ++fakeFrameId)
        return
      }
      if (!client.started) client.start()
      const stamp = source.lastStamp
      if (!stamp || stamp.frameId === lastFedFrameId || !source.drawable) return
      if (!client.canAccept()) {
        stats.skipped++
        return
      }
      if (client.submit(source, stamp, epoch) === 'submitted') {
        lastFedFrameId = stamp.frameId
        stats.fed++
      }
    },
    get latest() {
      return latest
    },
    reset() {
      tracker.reset()
      latest = null
    },
    setFake(gen) {
      fake = gen
      tracker.reset()
      latest = null
    },
    snapshot() {
      return {
        client: client.snapshot(),
        latest,
        swap: lastSwap,
        fake: fake !== null,
        stats: { ...stats },
        tracker: { ...tracker.stats },
      }
    },
    dispose() {
      client.dispose()
      latest = null
      lastFedFrameId = -1
    },
  }
}
