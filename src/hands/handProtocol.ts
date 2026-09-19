// HAND-01: giao thức main ↔ hand.worker (cùng khung với mục 4.5). Khác worker mặt, 'detect' mang frame GỐC toàn khung
// (ImageBitmap tạo bằng createImageBitmap từ FrameSource.drawable, transfer) vì hand tracker được đọc frame gốc theo
// bảng quyền đọc của kế hoạch (mục 5.4). File này chỉ import core/ để cả worker (lib WebWorker) lẫn client (lib DOM)
// dùng được. Không có message nào mang HTMLVideoElement hay MediaStream.
import type { HandResult } from '../core/types'

export type HandDelegate = 'GPU' | 'CPU'

export type HandInitMessage = {
  type: 'init'
  wasmBasePath: string
  modelPath: string
  delegate: HandDelegate
  numHands: number
  /** D-008: loader ES module cho module worker (forVisionTasks(base, true)). */
  useModuleLoader: boolean
  /** Cạnh ảnh xám warm-up ngay sau init. */
  warmupSize: number
}

/** Frame gốc gửi cho worker: bitmap toàn khung camera, chưa mirror (D-010). */
export type HandRawFrame = {
  frameId: number
  /** ts của FrameStamp (performance.now của main), dùng làm timestamp VIDEO mode. */
  ts: number
  epoch: number
  input: ImageBitmap
}

export type HandDetectMessage = { type: 'detect'; frame: HandRawFrame }
export type HandWorkerIn = HandInitMessage | HandDetectMessage

export type HandReadyMessage = {
  type: 'ready'
  delegate: HandDelegate
  initMs: number
  warmupMs: number
}
export type HandResultMessage = { type: 'result'; result: HandResult }
/** frameId null: lỗi init (worker không dùng được); có frameId: lỗi của một frame. */
export type HandErrorMessage = { type: 'error'; frameId: number | null; message: string }
export type HandWorkerOut = HandReadyMessage | HandResultMessage | HandErrorMessage
