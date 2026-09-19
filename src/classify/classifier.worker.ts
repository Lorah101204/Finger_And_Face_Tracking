// CLS-02 bước 4: ONNX Runtime Web trong module worker; chỉ nhận RestrictedFrame qua message 'detect' (bất biến I1).
// Không import camera/, mask/, loop/, debug/ (lint:boundaries); không giữ lại frame nào; input.close() trong finally.
// D-013: executionProviders ['webgpu', 'wasm']: có adapter WebGPU thì nạp bundle webgpu, lỗi thì tạo lại với wasm;
// loader wasm theo môi trường (wasmPaths) như MediaPipe. Ảnh letterbox (256) được vẽ về cạnh input của model (128) trên
// OffscreenCanvas riêng của worker (drawImage với rect nguồn đầy đủ, nguồn chỉ là bitmap của RestrictedFrame), đọc
// ImageData, chuẩn hóa CHW, chạy session, softmax → probs [person, mannequin].
import { installSameOriginGuard } from '../core/networkGuard'
import type { ClassifyResult, RestrictedFrame } from '../core/types'
import {
  softmax,
  type ClassifierEp,
  type ClassifierInitMessage,
  type ClassifierWorkerIn,
  type ClassifierWorkerOut,
} from './classifierProtocol'

type OrtLib = typeof import('onnxruntime-web')
type Session = Awaited<ReturnType<OrtLib['InferenceSession']['create']>>

const scope = self as unknown as DedicatedWorkerGlobalScope
// REL-01 (D-050): chặn mọi fetch khác origin của thư viện trong worker (telemetry MediaPipe) trước khi nạp gì (I9).
installSameOriginGuard(scope)
let ort: OrtLib | null = null
let session: Session | null = null
let inputName = 'input'
let outputName = 'logits'
let size = 128
let mean = 0.45
let std = 0.225
let canvas: OffscreenCanvas | null = null
let ctx: OffscreenCanvasRenderingContext2D | null = null
let pixels: Float32Array | null = null

function post(msg: ClassifierWorkerOut): void {
  scope.postMessage(msg)
}

async function hasWebGpuAdapter(): Promise<boolean> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
  if (!gpu) return false
  try {
    return (await gpu.requestAdapter()) !== null
  } catch {
    return false
  }
}

async function loadOrt(wantGpu: boolean): Promise<OrtLib> {
  // Bundle webgpu chứa cả wasm; chỉ nạp khi có navigator.gpu để không tốn loader jsep khi máy không có WebGPU.
  return (wantGpu
    ? await import('onnxruntime-web/webgpu')
    : await import('onnxruntime-web')) as unknown as OrtLib
}

async function createSession(
  lib: OrtLib,
  modelPath: string,
  eps: ClassifierEp[],
): Promise<Session> {
  return lib.InferenceSession.create(modelPath, { executionProviders: eps })
}

async function init(msg: ClassifierInitMessage): Promise<void> {
  const t0 = performance.now()
  try {
    size = msg.inputSize
    mean = msg.norm.mean
    std = msg.norm.std
    // Headless shell có navigator.gpu nhưng không có adapter: ORT sẽ tự bỏ EP webgpu và âm thầm chạy wasm, nên hỏi
    // adapter trước để báo đúng EP và không nạp bundle jsep vô ích.
    const wantGpu = msg.executionProviders.includes('webgpu') && (await hasWebGpuAdapter())
    const lib = await loadOrt(wantGpu)
    lib.env.wasm.wasmPaths = msg.wasmPaths
    // Không có COOP/COEP nên wasm đơn luồng (S6); đặt rõ để ORT không thử tạo thread.
    lib.env.wasm.numThreads = 1
    ort = lib
    const eps = wantGpu
      ? msg.executionProviders
      : msg.executionProviders.filter((e) => e !== 'webgpu')
    let ep: ClassifierEp = eps[0] ?? 'wasm'
    try {
      session = await createSession(lib, msg.modelPath, eps.length ? eps : ['wasm'])
    } catch (err) {
      if (ep !== 'webgpu') throw err
      ep = 'wasm'
      session = await createSession(lib, msg.modelPath, ['wasm'])
    }
    inputName = session.inputNames[0] ?? 'input'
    outputName = session.outputNames[0] ?? 'logits'
    canvas = new OffscreenCanvas(size, size)
    ctx = canvas.getContext('2d', { willReadFrequently: true })
    pixels = new Float32Array(3 * size * size)
    const initMs = performance.now() - t0
    let warmupMs = 0
    if (msg.warmup) {
      const t1 = performance.now()
      const tensor = new lib.Tensor('float32', new Float32Array(3 * size * size), [
        1,
        3,
        size,
        size,
      ])
      await session.run({ [inputName]: tensor })
      warmupMs = performance.now() - t1
    }
    post({ type: 'ready', ep, initMs, warmupMs, inputName, outputName })
  } catch (err) {
    post({ type: 'error', taskId: null, message: String(err) })
  }
}

/** Bitmap letterbox → tensor CHW đã chuẩn hóa. Nguồn drawImage chỉ là RestrictedFrame.input (I1). */
function toTensor(lib: OrtLib, bitmap: ImageBitmap) {
  if (!ctx || !canvas || !pixels) throw new Error('worker phân loại chưa init')
  ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, 0, 0, size, size)
  const img = ctx.getImageData(0, 0, size, size).data
  const plane = size * size
  for (let i = 0; i < plane; i++) {
    const o = i * 4
    pixels[i] = (img[o] / 255 - mean) / std
    pixels[plane + i] = (img[o + 1] / 255 - mean) / std
    pixels[2 * plane + i] = (img[o + 2] / 255 - mean) / std
  }
  return new lib.Tensor('float32', pixels, [1, 3, size, size])
}

/** Handler duy nhất nhận ảnh. Bitmap được đóng dù thành công hay lỗi. */
async function detect(frame: RestrictedFrame): Promise<void> {
  try {
    if (!ort || !session) {
      post({ type: 'error', taskId: frame.taskId, message: 'worker phân loại chưa init' })
      return
    }
    const t0 = performance.now()
    const out = await session.run({ [inputName]: toTensor(ort, frame.input) })
    const logits = out[outputName]?.data as ArrayLike<number> | undefined
    if (!logits) throw new Error(`model không có đầu ra ${outputName}`)
    const result: ClassifyResult = {
      taskId: frame.taskId,
      epoch: frame.epoch,
      frameId: frame.frameId,
      ts: frame.ts,
      inferMs: performance.now() - t0,
      probs: softmax(logits),
    }
    post({ type: 'result', result })
  } catch (err) {
    post({ type: 'error', taskId: frame.taskId, message: String(err) })
  } finally {
    frame.input.close()
  }
}

scope.onmessage = (e: MessageEvent<ClassifierWorkerIn>) => {
  const msg = e.data
  if (msg.type === 'init') void init(msg)
  else if (msg.type === 'detect') void detect(msg.frame)
}
