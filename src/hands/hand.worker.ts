// HAND-01 bước 1: Hand Landmarker VIDEO mode trong module worker (D-009). Worker này ĐƯỢC nhận frame gốc (mục 5.4):
// handler 'detect' nhận HandRawFrame (bitmap toàn khung, transfer) và gọi detectForVideo(input, ts). Tên file khác
// hẳn face.worker.ts để lint và check:invariants phân biệt. Không import face/ hay classify/; không giữ lại frame
// nào; input.close() trong finally. Delegate theo init (mặc định CPU, D-009), lỗi thì tạo lại với delegate còn lại.
import { FilesetResolver, HandLandmarker, type HandLandmarkerResult } from '@mediapipe/tasks-vision'
import { installSameOriginGuard } from '../core/networkGuard'
import type { HandResult } from '../core/types'
import type {
  HandDelegate,
  HandInitMessage,
  HandRawFrame,
  HandWorkerIn,
  HandWorkerOut,
} from './handProtocol'

const scope = self as unknown as DedicatedWorkerGlobalScope
// REL-01 (D-050): chặn mọi fetch khác origin của thư viện trong worker (telemetry MediaPipe) trước khi nạp gì (I9).
installSameOriginGuard(scope)
let landmarker: HandLandmarker | null = null
/** VIDEO mode đòi timestamp tăng dần; giữ mốc cuối để không bao giờ gửi ts lùi. */
let lastTs = 0

function post(msg: HandWorkerOut): void {
  scope.postMessage(msg)
}

function create(
  fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>,
  msg: HandInitMessage,
  delegate: HandDelegate,
): Promise<HandLandmarker> {
  return HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: msg.modelPath, delegate },
    runningMode: 'VIDEO',
    numHands: msg.numHands,
  })
}

function nextTs(ts: number): number {
  lastTs = ts > lastTs ? ts : lastTs + 1
  return lastTs
}

async function init(msg: HandInitMessage): Promise<void> {
  const t0 = performance.now()
  try {
    const fileset = await FilesetResolver.forVisionTasks(msg.wasmBasePath, msg.useModuleLoader)
    let delegate: HandDelegate = msg.delegate
    try {
      landmarker = await create(fileset, msg, delegate)
    } catch {
      // Delegate được cấu hình không tạo được (ví dụ thiếu WebGL): thử delegate còn lại; lỗi lần hai mới báo.
      delegate = delegate === 'GPU' ? 'CPU' : 'GPU'
      landmarker = await create(fileset, msg, delegate)
    }
    const initMs = performance.now() - t0
    // Warm-up: ảnh xám, không có drawImage, không có pixel camera.
    const warm = new OffscreenCanvas(msg.warmupSize, msg.warmupSize)
    const ctx = warm.getContext('2d')
    if (ctx) {
      ctx.fillStyle = '#808080'
      ctx.fillRect(0, 0, msg.warmupSize, msg.warmupSize)
    }
    const bmp = warm.transferToImageBitmap()
    const t1 = performance.now()
    try {
      landmarker.detectForVideo(bmp, nextTs(1))
    } finally {
      bmp.close()
    }
    post({ type: 'ready', delegate, initMs, warmupMs: performance.now() - t1 })
  } catch (err) {
    post({ type: 'error', frameId: null, message: String(err) })
  }
}

function toResult(frame: HandRawFrame, res: HandLandmarkerResult, inferMs: number): HandResult {
  return {
    frameId: frame.frameId,
    ts: frame.ts,
    epoch: frame.epoch,
    inferMs,
    width: frame.input.width,
    height: frame.input.height,
    hands: res.landmarks.map((lm, i) => ({
      label: res.handedness[i]?.[0]?.categoryName ?? '',
      score: res.handedness[i]?.[0]?.score ?? 0,
      landmarksNorm: lm.map((p) => [p.x, p.y, p.z] as [number, number, number]),
    })),
  }
}

/** Handler duy nhất nhận ảnh. Bitmap được đóng dù thành công hay lỗi. */
function detect(frame: HandRawFrame): void {
  try {
    if (!landmarker) {
      post({ type: 'error', frameId: frame.frameId, message: 'worker tay chưa init' })
      return
    }
    const t0 = performance.now()
    const res = landmarker.detectForVideo(frame.input, nextTs(frame.ts))
    post({ type: 'result', result: toResult(frame, res, performance.now() - t0) })
  } catch (err) {
    post({ type: 'error', frameId: frame.frameId, message: String(err) })
  } finally {
    frame.input.close()
  }
}

scope.onmessage = (e: MessageEvent<HandWorkerIn>) => {
  const msg = e.data
  if (msg.type === 'init') void init(msg)
  else if (msg.type === 'detect') detect(msg.frame)
}
