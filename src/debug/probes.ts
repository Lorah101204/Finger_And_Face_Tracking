// TEST-00 bước 2: probe debug, chỉ bật với ?debug=1. onRestrictedFrame nhận bản sao ImageData của buffer đúng như gửi
// cho worker (MASK-02 gọi emitRestrictedFrame ngay trước transfer, mục 5.9); onOutputFrame nhận ImageData canvas output
// (vòng lặp gọi emitOutputFrame sau khi vẽ). Đọc ngược getImageData đắt (D-012) nên chỉ chạy khi có listener và giới hạn
// tần suất. Bộ đếm faceDetectSubmitted, faceDetectDropped, classifierSubmitted do FACE-01 và CLS-02 tăng.
import type { Rect } from '../core/types'

export type ProbeFrameMeta = { epoch: number; frameId: number; ts: number }
export type RestrictedMeta = ProbeFrameMeta & { taskId: number; roiCam: Rect }

export type ProbeCounters = {
  faceDetectSubmitted: number
  faceDetectDropped: number
  classifierSubmitted: number
  restrictedFrames: number
  outputFrames: number
}

export type RestrictedListener = (img: ImageData, meta: RestrictedMeta) => void
export type OutputListener = (img: ImageData, meta: ProbeFrameMeta) => void

export type Probes = {
  readonly enabled: boolean
  readonly counters: ProbeCounters
  /** ms tối thiểu giữa hai lần đọc ngược cho mỗi loại (D-012: restricted tối đa 2 Hz). */
  minIntervalMs: { restricted: number; output: number }
  /** FACE-02: trễ nhân tạo (ms) cho worker mặt, đặt bằng kịch bản delayWorker. */
  workerDelayMs: number
  /**
   * QA-01: tuổi tối đa (ms) của kết quả mặt thay cho freshness.faceResultMaxAgeMs khi > 0, đặt bằng kịch bản
   * faceMaxAge: e2e dời cửa sổ khi tác vụ đang chạy cần kết quả của ROI cũ được nhận dù suy luận chậm dưới tải.
   */
  faceMaxAgeMs: number
  onRestrictedFrame(cb: RestrictedListener): () => void
  onOutputFrame(cb: OutputListener): () => void
  /** MASK-02 hỏi trước khi tốn getImageData: có ai nghe và đã tới nhịp chưa. */
  wantsRestrictedFrame(now: number): boolean
  emitRestrictedFrame(img: ImageData, meta: RestrictedMeta): void
  /** Vòng lặp gọi sau khi vẽ; tự bỏ qua khi tắt, không có listener hoặc chưa tới nhịp. */
  emitOutputFrame(ctx: CanvasRenderingContext2D, meta: ProbeFrameMeta): void
}

export function createProbes(enabled: boolean): Probes {
  const counters: ProbeCounters = {
    faceDetectSubmitted: 0,
    faceDetectDropped: 0,
    classifierSubmitted: 0,
    restrictedFrames: 0,
    outputFrames: 0,
  }
  const restricted = new Set<RestrictedListener>()
  const output = new Set<OutputListener>()
  let lastRestrictedAt = -Infinity
  let lastOutputAt = -Infinity

  const probes: Probes = {
    enabled,
    counters,
    minIntervalMs: { restricted: 500, output: 250 },
    workerDelayMs: 0,
    faceMaxAgeMs: 0,
    onRestrictedFrame(cb) {
      restricted.add(cb)
      return () => {
        restricted.delete(cb)
      }
    },
    onOutputFrame(cb) {
      output.add(cb)
      return () => {
        output.delete(cb)
      }
    },
    wantsRestrictedFrame(now) {
      return (
        enabled && restricted.size > 0 && now - lastRestrictedAt >= probes.minIntervalMs.restricted
      )
    },
    emitRestrictedFrame(img, meta) {
      if (!enabled || restricted.size === 0) return
      lastRestrictedAt = meta.ts
      counters.restrictedFrames++
      for (const cb of restricted) cb(img, meta)
    },
    emitOutputFrame(ctx, meta) {
      if (!enabled || output.size === 0) return
      if (meta.ts - lastOutputAt < probes.minIntervalMs.output) return
      lastOutputAt = meta.ts
      const { width, height } = ctx.canvas
      if (width === 0 || height === 0) return
      const img = ctx.getImageData(0, 0, width, height)
      counters.outputFrames++
      for (const cb of output) cb(img, meta)
    },
  }
  return probes
}
