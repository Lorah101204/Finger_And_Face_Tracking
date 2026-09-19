// S1: Face Landmarker trong Worker (module và classic) với GPU và CPU delegate.
// Đo init ms và infer ms cho ảnh 64, 128, 256 px (crop quanh mặt rồi letterbox, giống restrictedFrame).
// Kết quả cũng cho biết Face Landmarker còn tìm được mặt ở kích thước nào (liên quan ngưỡng minRoiPx).
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import { letterbox, loadImage, log, makeCall, report, setStatus, stats, webglInfo } from './lib'

type Delegate = 'GPU' | 'CPU'
const SIZES = [64, 128, 256]
const N = 40
// ?wasm=nm: phục vụ wasm qua pipeline module của Vite (node_modules) thay vì public/ (Vite dev không cho import() file trong public).
// ?only=module|classic|main: chỉ chạy một nhóm.
const PARAMS = new URLSearchParams(location.search)
const WASM = PARAMS.get('wasm') === 'nm' ? '/node_modules/@mediapipe/tasks-vision/wasm' : '/models/wasm'
const ONLY = PARAMS.get('only')
const MODEL = '/models/face_landmarker.task'

const img = await loadImage('/spike-assets/face.png')
const results: Record<string, unknown> = {
  spike: 'S1',
  ua: navigator.userAgent,
  webgl: webglInfo(),
  image: { w: img.naturalWidth, h: img.naturalHeight },
  sizes: SIZES,
  iterations: N,
}
report(results, false)

// Crop vuông quanh mặt (tìm bằng main thread) để ảnh 64/128/256 px là "cửa sổ có mặt", không phải toàn ảnh.
let crop: HTMLCanvasElement
{
  const vision = await FilesetResolver.forVisionTasks(WASM)
  const lm = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' },
    runningMode: 'IMAGE',
    numFaces: 1,
  })
  const r = lm.detect(img)
  lm.close()
  const w = img.naturalWidth
  const h = img.naturalHeight
  let sx = 0
  let sy = 0
  let side = Math.min(w, h)
  if (r.faceLandmarks.length > 0) {
    const xs = r.faceLandmarks[0].map((p) => p.x * w)
    const ys = r.faceLandmarks[0].map((p) => p.y * h)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    side = Math.round(Math.max(maxX - minX, maxY - minY) * 1.4)
    sx = Math.round((minX + maxX) / 2 - side / 2)
    sy = Math.round((minY + maxY) / 2 - side / 2)
    sx = Math.max(0, Math.min(w - side, sx))
    sy = Math.max(0, Math.min(h - side, sy))
  }
  crop = document.createElement('canvas')
  crop.width = side
  crop.height = side
  crop.getContext('2d')?.drawImage(img, sx, sy, side, side, 0, 0, side, side)
  results.faceCrop = { found: r.faceLandmarks.length > 0, sx, sy, side }
  document.getElementById('stage')?.appendChild(crop)
}

function bitmapFor(size: number): Promise<ImageBitmap> {
  return createImageBitmap(letterbox(crop, crop.width, crop.height, size))
}

async function runWorker(kind: 'module' | 'classic', delegate: Delegate) {
  const worker =
    kind === 'module'
      ? new Worker(new URL('./mp.worker.ts', import.meta.url), { type: 'module' })
      : new Worker('/tools/spikes/mp.classic.worker.js')
  const call = makeCall(worker)
  const out: Record<string, unknown> = {}
  try {
    const ready = await call({ type: 'init', task: 'face', mode: 'IMAGE', delegate, wasm: WASM, model: MODEL })
    if (ready.type === 'error') throw new Error(String(ready.message))
    out.initMs = ready.initMs
    out.warmMs = ready.warmMs
    for (const size of SIZES) {
      const detectMs: number[] = []
      const roundMs: number[] = []
      let faces = 0
      for (let i = 0; i < N; i++) {
        const bmp = await bitmapFor(size)
        const t0 = performance.now()
        const r = await call({ type: 'detect', bitmap: bmp }, [bmp], 10000)
        roundMs.push(performance.now() - t0)
        if (r.type === 'error') throw new Error(String(r.message))
        detectMs.push(r.ms as number)
        faces = r.count as number
      }
      const d = stats(detectMs)
      out[`px${size}`] = { detect: d, roundTrip: stats(roundMs), faces }
      log(`${kind}/${delegate} ${size}px: detect p50 ${d.p50} ms, p95 ${d.p95} ms, faces ${faces}`)
    }
  } catch (err) {
    out.error = String(err)
    log(`${kind}/${delegate}: LỖI ${String(err)}`)
  }
  worker.terminate()
  return out
}

async function runMain(delegate: Delegate) {
  const out: Record<string, unknown> = {}
  try {
    const t0 = performance.now()
    const vision = await FilesetResolver.forVisionTasks(WASM)
    const lm = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'IMAGE',
      numFaces: 2,
    })
    out.initMs = Math.round(performance.now() - t0)
    for (const size of SIZES) {
      const c = letterbox(crop, crop.width, crop.height, size)
      const ms: number[] = []
      let faces = 0
      for (let i = 0; i < N; i++) {
        const t = performance.now()
        const r = lm.detect(c)
        ms.push(performance.now() - t)
        faces = r.faceLandmarks.length
      }
      const d = stats(ms)
      out[`px${size}`] = { detect: d, faces }
      log(`main/${delegate} ${size}px: detect p50 ${d.p50} ms, p95 ${d.p95} ms, faces ${faces}`)
    }
    lm.close()
  } catch (err) {
    out.error = String(err)
    log(`main/${delegate}: LỖI ${String(err)}`)
  }
  return out
}

results.wasmBase = WASM
if (!ONLY || ONLY === 'module') {
  setStatus('worker module GPU')
  results.workerModuleGPU = await runWorker('module', 'GPU')
  setStatus('worker module CPU')
  results.workerModuleCPU = await runWorker('module', 'CPU')
}
if (!ONLY || ONLY === 'classic') {
  setStatus('worker classic GPU')
  results.workerClassicGPU = await runWorker('classic', 'GPU')
  setStatus('worker classic CPU')
  results.workerClassicCPU = await runWorker('classic', 'CPU')
}
if (!ONLY || ONLY === 'main') {
  setStatus('main GPU')
  results.mainGPU = await runMain('GPU')
  setStatus('main CPU')
  results.mainCPU = await runMain('CPU')
}
setStatus('xong')
report(results)
