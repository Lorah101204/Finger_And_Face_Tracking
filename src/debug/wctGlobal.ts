// Điểm móc debug duy nhất trên window (UC-11, UC-16): chỉ đọc số đếm và snapshot trong trang, không gửi đi đâu (I9).
import type { CameraSnapshot } from '../camera/cameraState'
import type { FaceSnapshot } from '../face/faceClient'
import type { HandPipelineSnapshot } from '../hands/handPipeline'
import type { LogoSnapshot } from './logoProbe'
import type { LoopSnapshot } from '../loop/frameLoop'
import type { StageState } from '../loop/store'
import type { HandWindowSnapshot } from '../reveal/handWindowSource'
import type { Probes } from './probes'
import type { StatsSnapshot } from './stats'
import type { RecorderSnapshot, Sample, SampleMeta, SessionMeta } from '../dataset/recorder'
import type { ClassifierSnapshot } from '../classify/classifierClient'
import type { EnvSnapshot, GpuAdapterInfo } from './envProbe'
import type { LogProbe } from './logProbe'

export type CameraProbe = {
  frames: number
  lastFrameId: number
  /** Số lần frameId không bằng frameId trước + 1 (bỏ qua frame đầu tiên). */
  gaps: number
  /** Số lần frameId lặp lại hoặc giảm. */
  duplicates: number
  firstTs: number
  lastTs: number
  /** fps trung bình từ frame đầu tới frame cuối. */
  fps: number
}

export type WctGlobal = {
  camera?: { probe: CameraProbe; snapshot: () => CameraSnapshot }
  stage?: { snapshot: () => StageState }
  loop?: { snapshot: () => LoopSnapshot; events: EventTarget }
  /** FACE-01: trạng thái FaceClient. */
  face?: { snapshot: () => FaceSnapshot }
  /** BRAND-01: lớp logo trên màn che (công tắc, đang vẽ, rect và ô theo layout). */
  logo?: { snapshot: () => LogoSnapshot }
  /** HAND-01: trạng thái hand pipeline (worker, tracker, HandFrame mới nhất). */
  hands?: { snapshot: () => HandPipelineSnapshot }
  /** ROI-01: trạng thái HandWindowSource (solver, cửa sổ đã giải). */
  handWindow?: { snapshot: () => HandWindowSnapshot }
  /** TEST-00: chỉ có khi ?debug=1. */
  probes?: Probes
  /** PERF-01: FPS, Hz từng pipeline, p50/p95, frame rớt (sampler 4 Hz). */
  stats?: { snapshot: () => StatsSnapshot }
  /** CLS-02: trạng thái ClassifierClient (worker, EP, probs gần nhất). */
  classifier?: { snapshot: () => ClassifierSnapshot }
  /** QA-02: môi trường trình duyệt và API (ma trận thiết bị). */
  env?: { snapshot: () => EnvSnapshot; gpuAdapter: () => Promise<GpuAdapterInfo> }
  /** LOG-02: nhật ký cục bộ (đọc, xóa, dọn, ghi thẳng để test giới hạn). */
  log?: LogProbe
  /** CLS-01: dataset mode (trạng thái, metadata, mẫu trong bộ nhớ, zip). */
  dataset?: {
    snapshot: () => RecorderSnapshot
    metas: () => readonly SampleMeta[]
    samples: () => readonly Sample[]
    sessions: () => readonly SessionMeta[]
    zip: () => Promise<Uint8Array>
  }
}

declare global {
  interface Window {
    __wct?: WctGlobal
  }
}

export function wct(): WctGlobal {
  window.__wct ??= {}
  return window.__wct
}
