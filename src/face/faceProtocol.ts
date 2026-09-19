// FACE-01: giao thức main ↔ face.worker (mục 4.5). Chỉ 'detect' mang ảnh, và ảnh chỉ là RestrictedFrame.input
// (ImageBitmap letterbox, transfer); không có message nào mang video, MediaStream hay frame toàn khung (bất biến I1).
// File này chỉ import core/ để cả worker (lib WebWorker) lẫn client (lib DOM) dùng được.
import type { FaceResult, RestrictedFrame } from '../core/types'

export type FaceDelegate = 'GPU' | 'CPU'

export type FaceInitMessage = {
  type: 'init'
  wasmBasePath: string
  modelPath: string
  delegate: FaceDelegate
  numFaces: number
  /** D-008: loader ES module cho module worker (forVisionTasks(base, true)). */
  useModuleLoader: boolean
  /** Cạnh ảnh xám warm-up ngay sau init. */
  warmupSize: number
}
export type FaceDetectMessage = { type: 'detect'; frame: RestrictedFrame }
export type FaceWorkerIn = FaceInitMessage | FaceDetectMessage

export type FaceReadyMessage = {
  type: 'ready'
  delegate: FaceDelegate
  initMs: number
  warmupMs: number
}
export type FaceResultMessage = { type: 'result'; result: FaceResult }
/** taskId null: lỗi init (worker không dùng được); có taskId: lỗi của một tác vụ. */
export type FaceErrorMessage = { type: 'error'; taskId: number | null; message: string }
export type FaceWorkerOut = FaceReadyMessage | FaceResultMessage | FaceErrorMessage
