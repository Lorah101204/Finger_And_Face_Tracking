// SPIKE-00 (S1, S2): worker MODULE chạy MediaPipe Face Landmarker hoặc Hand Landmarker.
// Chỉ nhận ImageBitmap (mô phỏng RestrictedFrame). Không nhận video hay frame gốc.
import { FaceLandmarker, FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'

type Mode = 'IMAGE' | 'VIDEO'
let face: FaceLandmarker | null = null
let hand: HandLandmarker | null = null
let mode: Mode = 'IMAGE'

function run(img: ImageBitmap, ts: number): number {
  if (face) {
    const r = mode === 'VIDEO' ? face.detectForVideo(img, ts) : face.detect(img)
    return r.faceLandmarks.length
  }
  if (hand) {
    const r = mode === 'VIDEO' ? hand.detectForVideo(img, ts) : hand.detect(img)
    return r.landmarks.length
  }
  throw new Error('chưa init')
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data as Record<string, unknown>
  try {
    if (msg.type === 'init') {
      mode = msg.mode as Mode
      const delegate = msg.delegate as 'GPU' | 'CPU'
      const t0 = performance.now()
      // Module worker: useModule = true để tasks-vision nạp vision_wasm_module_internal.js (ES module) bằng import().
      const vision = await FilesetResolver.forVisionTasks(String(msg.wasm), true)
      const baseOptions = { modelAssetPath: String(msg.model), delegate }
      if (msg.task === 'face') {
        face = await FaceLandmarker.createFromOptions(vision, { baseOptions, runningMode: mode, numFaces: 2 })
      } else {
        hand = await HandLandmarker.createFromOptions(vision, { baseOptions, runningMode: mode, numHands: 2 })
      }
      const initMs = performance.now() - t0
      const oc = new OffscreenCanvas(256, 256)
      const ctx = oc.getContext('2d')
      if (ctx) {
        ctx.fillStyle = '#808080'
        ctx.fillRect(0, 0, 256, 256)
      }
      const wb = oc.transferToImageBitmap()
      const t1 = performance.now()
      run(wb, performance.now())
      const warmMs = performance.now() - t1
      wb.close()
      self.postMessage({
        type: 'ready',
        initMs: Math.round(initMs),
        warmMs: Math.round(warmMs),
        offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
      })
    } else if (msg.type === 'detect') {
      const bmp = msg.bitmap as ImageBitmap
      const ts = typeof msg.ts === 'number' ? msg.ts : performance.now()
      const t0 = performance.now()
      const count = run(bmp, ts)
      const ms = performance.now() - t0
      bmp.close()
      self.postMessage({ type: 'result', ms, count })
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err) })
  }
}
