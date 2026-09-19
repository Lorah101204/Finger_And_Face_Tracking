// SPIKE-00 (S1, S2): worker CLASSIC (không có import tĩnh) để importScripts của MediaPipe chạy được.
// Nạp @mediapipe/tasks-vision bằng import() động; chỉ nhận ImageBitmap (mô phỏng RestrictedFrame).
/* global self, OffscreenCanvas */
let mp = null
let face = null
let hand = null
let mode = 'IMAGE'

async function loadMp() {
  if (!mp) mp = await import('/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs')
  return mp
}

function run(img, ts) {
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

self.onmessage = async (e) => {
  const msg = e.data
  try {
    if (msg.type === 'init') {
      mode = msg.mode
      const t0 = performance.now()
      const { FilesetResolver, FaceLandmarker, HandLandmarker } = await loadMp()
      const vision = await FilesetResolver.forVisionTasks(msg.wasm)
      const baseOptions = { modelAssetPath: msg.model, delegate: msg.delegate }
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
      const bmp = msg.bitmap
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
