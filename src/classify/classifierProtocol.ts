// CLS-02: giao thức main ↔ classifier.worker (mục 4.5), cùng khung với faceProtocol: chỉ 'detect' mang ảnh và ảnh chỉ là
// RestrictedFrame.input (ImageBitmap letterbox, transfer); không có message nào mang video hay frame toàn khung (I1).
// File này chỉ import core/ để cả worker (lib WebWorker) lẫn client (lib DOM) dùng được.
import type { ClassifyResult, RestrictedFrame } from '../core/types'

export type ClassifierEp = 'webgpu' | 'wasm'

export type ClassifierInitMessage = {
  type: 'init'
  /** Thư mục loader wasm của ORT (dev: node_modules, build: /models/ort/), D-013. */
  wasmPaths: string
  modelPath: string
  executionProviders: ClassifierEp[]
  /** Cạnh input cố định của model (128 hoặc 160). */
  inputSize: number
  /** Chuẩn hóa (x / 255 − mean) / std cho cả ba kênh; script huấn luyện dùng cùng giá trị. */
  norm: { mean: number; std: number }
  /** Chạy một tensor 0 sau init để lần suy luận đầu không gánh chi phí biên dịch. */
  warmup: boolean
}
export type ClassifierDetectMessage = { type: 'detect'; frame: RestrictedFrame }
export type ClassifierWorkerIn = ClassifierInitMessage | ClassifierDetectMessage

export type ClassifierReadyMessage = {
  type: 'ready'
  ep: ClassifierEp
  initMs: number
  warmupMs: number
  inputName: string
  outputName: string
}
export type ClassifierResultMessage = { type: 'result'; result: ClassifyResult }
/** taskId null: lỗi init (worker không dùng được); có taskId: lỗi của một tác vụ. */
export type ClassifierErrorMessage = { type: 'error'; taskId: number | null; message: string }
export type ClassifierWorkerOut =
  ClassifierReadyMessage | ClassifierResultMessage | ClassifierErrorMessage

/** softmax ổn định số cho logits nhỏ. */
export function softmax(logits: ArrayLike<number>): number[] {
  let max = -Infinity
  for (let i = 0; i < logits.length; i++) if (logits[i] > max) max = logits[i]
  const exps: number[] = []
  let sum = 0
  for (let i = 0; i < logits.length; i++) {
    const e = Math.exp(logits[i] - max)
    exps.push(e)
    sum += e
  }
  return exps.map((e) => e / sum)
}
