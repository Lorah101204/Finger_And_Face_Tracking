// FACE-01: Face Landmarker IMAGE mode trong module worker; chỉ nhận RestrictedFrame qua message 'detect' (bất biến
// I1). Không import camera/, mask/, loop/, debug/ (lint:boundaries); không giữ lại frame nào; input.close() trong
// finally. D-008: forVisionTasks(base, useModuleLoader) rồi createFromOptions với delegate GPU, lỗi thì tạo lại với
// CPU; warm-up một ảnh xám ngay sau init để lần detect đầu không gánh chi phí biên dịch shader.
import { FaceLandmarker, FilesetResolver, type FaceLandmarkerResult } from '@mediapipe/tasks-vision'
import { installSameOriginGuard } from '../core/networkGuard'
import type { FaceResult, RestrictedFrame } from '../core/types'
import type { FaceDelegate, FaceInitMessage, FaceWorkerIn, FaceWorkerOut } from './faceProtocol'

const scope = self as unknown as DedicatedWorkerGlobalScope
// REL-01 (D-050): chặn mọi fetch khác origin của thư viện trong worker (telemetry MediaPipe) trước khi nạp gì (I9).
installSameOriginGuard(scope)
let landmarker: FaceLandmarker | null = null

function post(msg: FaceWorkerOut): void {
  scope.postMessage(msg)
}

function create(
  fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>,
  msg: FaceInitMessage,
  delegate: FaceDelegate,
): Promise<FaceLandmarker> {
  return FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: msg.modelPath, delegate },
    runningMode: 'IMAGE',
    numFaces: msg.numFaces,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
  })
}

async function init(msg: FaceInitMessage): Promise<void> {
  const t0 = performance.now()
  try {
    const fileset = await FilesetResolver.forVisionTasks(msg.wasmBasePath, msg.useModuleLoader)
    let delegate: FaceDelegate = msg.delegate
    try {
      landmarker = await create(fileset, msg, delegate)
    } catch (err) {
      if (delegate !== 'GPU') throw err
      delegate = 'CPU'
      landmarker = await create(fileset, msg, delegate)
    }
    const initMs = performance.now() - t0
    // Warm-up: ảnh xám cùng cỡ ảnh letterbox; không có drawImage, không có pixel camera.
    const warm = new OffscreenCanvas(msg.warmupSize, msg.warmupSize)
    const ctx = warm.getContext('2d')
    if (ctx) {
      ctx.fillStyle = '#808080'
      ctx.fillRect(0, 0, msg.warmupSize, msg.warmupSize)
    }
    const bmp = warm.transferToImageBitmap()
    const t1 = performance.now()
    try {
      landmarker.detect(bmp)
    } finally {
      bmp.close()
    }
    post({ type: 'ready', delegate, initMs, warmupMs: performance.now() - t1 })
  } catch (err) {
    post({ type: 'error', taskId: null, message: String(err) })
  }
}

function toResult(frame: RestrictedFrame, res: FaceLandmarkerResult, inferMs: number): FaceResult {
  return {
    taskId: frame.taskId,
    epoch: frame.epoch,
    frameId: frame.frameId,
    ts: frame.ts,
    inferMs,
    faces: res.faceLandmarks.map((lm) => ({
      landmarksNorm: lm.map((p) => [p.x, p.y, p.z] as [number, number, number]),
    })),
  }
}

/** Handler duy nhất nhận ảnh. Bitmap được đóng dù thành công hay lỗi. */
function detect(frame: RestrictedFrame): void {
  try {
    if (!landmarker) {
      post({ type: 'error', taskId: frame.taskId, message: 'worker mặt chưa init' })
      return
    }
    const t0 = performance.now()
    const res = landmarker.detect(frame.input)
    post({ type: 'result', result: toResult(frame, res, performance.now() - t0) })
  } catch (err) {
    post({ type: 'error', taskId: frame.taskId, message: String(err) })
  } finally {
    frame.input.close()
  }
}

scope.onmessage = (e: MessageEvent<FaceWorkerIn>) => {
  const msg = e.data
  if (msg.type === 'init') void init(msg)
  else if (msg.type === 'detect') detect(msg.frame)
}
