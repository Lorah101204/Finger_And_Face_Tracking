// PERF-01 bước 1: sampler thống kê hiệu năng. Mỗi intervalMs (mặc định 250) ghi một mẫu các bộ đếm (frame vòng lặp,
// kết quả mặt, kết quả tay, kết quả phân loại) và tính tần suất trên cửa sổ windowMs (mặc định 2 s): Hz = Δđếm / Δt
// giữa mẫu cũ nhất và mới nhất trong cửa sổ. p50/p95 inferMs, thời gian vẽ và tick lấy trực tiếp từ các cửa sổ trễ
// (core/latency.ts) của FaceClient, HandClient và vòng lặp; frame rớt là số buffer không gửi được vì worker mặt bận
// (faceDetectDropped) và số frame tay bị bỏ vì worker tay bận. React đọc qua useSyncExternalStore(subscribe) nên
// overlay chỉ re-render 4 Hz, không theo frame (bước 4). Không gửi đi đâu (I9).
import type { LatencyStats } from '../core/latency'
import type { FrameOutput } from '../core/types'

export type StatsSources = {
  loop: () => {
    frames: number
    epoch: number
    status: FrameOutput['status']
    render: LatencyStats
    tick: LatencyStats
  }
  face: () => {
    results: number
    submitted: number
    dropped: number
    p50: number
    p95: number
    /** 0 hoặc 1: FaceClient chạy một tác vụ tại một thời điểm. */
    pending: number
  }
  hands: () => {
    results: number
    fed: number
    skipped: number
    p50: number
    p95: number
  }
  /** CLS-02 nối ClassifierClient; chưa có thì 0 Hz. */
  classifier?: () => { results: number }
}

export type StatsSnapshot = {
  /** frame vòng lặp (output) mỗi giây trên cửa sổ */
  fpsOutput: number
  handHz: number
  faceHz: number
  classifierHz: number
  face: { p50: number; p95: number; submitted: number; dropped: number; pending: number }
  hand: { p50: number; p95: number; fed: number; skipped: number }
  render: LatencyStats
  tick: LatencyStats
  epoch: number
  status: FrameOutput['status']
  windowMs: number
  /** số mẫu trong cửa sổ (dưới 2 thì mọi tần suất là 0) */
  samples: number
  sampledAt: number
}

export type StatsOptions = {
  intervalMs?: number
  windowMs?: number
  now?: () => number
  /** Lịch lặp (mặc định setInterval); unit test thay bằng lịch giả. Trả hàm hủy. */
  schedule?: (fn: () => void, ms: number) => () => void
}

export type Stats = {
  start(): void
  stop(): void
  /** Ghi một mẫu ngay (start() tự gọi theo lịch). */
  sample(now?: number): void
  snapshot(): StatsSnapshot
  subscribe(cb: () => void): () => void
  readonly running: boolean
}

type Sample = { t: number; frames: number; face: number; hand: number; cls: number }

export function createStats(sources: StatsSources, opts: StatsOptions = {}): Stats {
  const intervalMs = opts.intervalMs ?? 250
  const windowMs = opts.windowMs ?? 2000
  const now = opts.now ?? (() => performance.now())
  const schedule =
    opts.schedule ??
    ((fn: () => void, ms: number) => {
      const id = setInterval(fn, ms)
      return () => clearInterval(id)
    })
  const cap = Math.max(2, Math.ceil(windowMs / intervalMs) + 1)
  const samples: Sample[] = []
  const listeners = new Set<() => void>()
  let cancel: (() => void) | null = null
  let lastSampleAt = 0

  function sample(t = now()): void {
    samples.push({
      t,
      frames: sources.loop().frames,
      face: sources.face().results,
      hand: sources.hands().results,
      cls: sources.classifier?.().results ?? 0,
    })
    while (samples.length > cap) samples.shift()
    lastSampleAt = t
    for (const l of listeners) l()
  }

  const rate = (pick: (s: Sample) => number): number => {
    if (samples.length < 2) return 0
    const a = samples[0]
    const b = samples[samples.length - 1]
    const dt = (b.t - a.t) / 1000
    return dt > 0 ? Math.max(0, pick(b) - pick(a)) / dt : 0
  }

  return {
    get running() {
      return cancel !== null
    },
    start() {
      if (cancel) return
      cancel = schedule(() => sample(), intervalMs)
    },
    stop() {
      cancel?.()
      cancel = null
    },
    sample,
    subscribe(cb) {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    snapshot() {
      const l = sources.loop()
      const f = sources.face()
      const h = sources.hands()
      return {
        fpsOutput: rate((s) => s.frames),
        handHz: rate((s) => s.hand),
        faceHz: rate((s) => s.face),
        classifierHz: rate((s) => s.cls),
        face: {
          p50: f.p50,
          p95: f.p95,
          submitted: f.submitted,
          dropped: f.dropped,
          pending: f.pending,
        },
        hand: { p50: h.p50, p95: h.p95, fed: h.fed, skipped: h.skipped },
        render: l.render,
        tick: l.tick,
        epoch: l.epoch,
        status: l.status,
        windowMs,
        samples: samples.length,
        sampledAt: lastSampleAt,
      }
    },
  }
}

const ms = (v: number) => (v >= 10 ? v.toFixed(0) : v.toFixed(1))

/** Dòng overlay (chuỗi để useSyncExternalStore so sánh theo giá trị). */
export function describeStats(s: StatsSnapshot): string {
  return (
    `hiệu năng: output ${s.fpsOutput.toFixed(1)} fps · tay ${s.handHz.toFixed(1)} Hz (p50 ${ms(s.hand.p50)} / p95 ${ms(s.hand.p95)} ms,` +
    ` bỏ ${s.hand.skipped}) · mặt ${s.faceHz.toFixed(1)} Hz (p50 ${ms(s.face.p50)} / p95 ${ms(s.face.p95)} ms, rớt ${s.face.dropped},` +
    ` chờ ${s.face.pending}) · phân loại ${s.classifierHz.toFixed(1)} Hz · vẽ p50 ${ms(s.render.p50)} / p95 ${ms(s.render.p95)} ms` +
    ` · tick p95 ${ms(s.tick.p95)} ms · epoch ${s.epoch} · ${s.status}`
  )
}
