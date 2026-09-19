// S2: Hand Landmarker VIDEO mode 720p. Main thread so với worker (kèm createImageBitmap + transfer).
// 300 frame có tay (ảnh tĩnh + dấu chuyển động), 100 frame trống (chi phí palm detection mỗi frame). p50/p95.
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import { loadImage, log, makeCall, report, setStatus, stats } from './lib'

type Delegate = 'GPU' | 'CPU'
const W = 1280
const H = 720
const FRAMES = 300
const BLANK = 100
// ?wasm=nm: phục vụ wasm qua pipeline module của Vite (node_modules) thay vì public/. ?only=main|module|classic.
const PARAMS = new URLSearchParams(location.search)
const WASM = PARAMS.get('wasm') === 'nm' ? '/node_modules/@mediapipe/tasks-vision/wasm' : '/models/wasm'
const ONLY = PARAMS.get('only')
const MODEL = '/models/hand_landmarker.task'

const img = await loadImage('/spike-assets/hands.jpg')
const src = document.createElement('canvas')
src.width = W
src.height = H
document.getElementById('stage')?.appendChild(src)
const sctx = src.getContext('2d')
if (!sctx) throw new Error('không tạo được 2d context')
let frame = 0
function drawFrame(withHands: boolean) {
  sctx.fillStyle = '#404040'
  sctx.fillRect(0, 0, W, H)
  if (withHands) {
    const s = Math.min(W / img.naturalWidth, H / img.naturalHeight)
    const dw = img.naturalWidth * s
    const dh = img.naturalHeight * s
    sctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh)
  }
  sctx.fillStyle = '#ff0000'
  sctx.fillRect((frame * 7) % W, 10, 20, 20)
  frame++
}

const results: Record<string, unknown> = {
  spike: 'S2',
  source: '1280x720 canvas, ảnh tay tĩnh letterbox + dấu đỏ chuyển động; không có webcam thật',
  frames: FRAMES,
  blankFrames: BLANK,
}
report(results, false)

async function runMain(delegate: Delegate) {
  const out: Record<string, unknown> = {}
  try {
    const t0 = performance.now()
    const vision = await FilesetResolver.forVisionTasks(WASM)
    const lm = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'VIDEO',
      numHands: 2,
    })
    out.initMs = Math.round(performance.now() - t0)
    const run = (withHands: boolean, n: number) => {
      const ms: number[] = []
      let hands = 0
      for (let i = 0; i < n; i++) {
        drawFrame(withHands)
        const t = performance.now()
        const r = lm.detectForVideo(src, performance.now())
        ms.push(performance.now() - t)
        hands = r.landmarks.length
      }
      return { detect: stats(ms), hands }
    }
    run(true, 10)
    const withHands = run(true, FRAMES)
    const blank = run(false, BLANK)
    out.withHands = withHands
    out.blank = blank
    lm.close()
    log(
      `main/${delegate}: init ${out.initMs} ms; có tay p50 ${withHands.detect.p50} p95 ${withHands.detect.p95} ms (hands ${withHands.hands}); trống p50 ${blank.detect.p50} p95 ${blank.detect.p95} ms`,
    )
  } catch (err) {
    out.error = String(err)
    log(`main/${delegate}: LỖI ${String(err)}`)
  }
  return out
}

async function runWorker(kind: 'module' | 'classic', delegate: Delegate) {
  const worker =
    kind === 'module'
      ? new Worker(new URL('./mp.worker.ts', import.meta.url), { type: 'module' })
      : new Worker('/tools/spikes/mp.classic.worker.js')
  const call = makeCall(worker)
  const out: Record<string, unknown> = {}
  try {
    const ready = await call({ type: 'init', task: 'hand', mode: 'VIDEO', delegate, wasm: WASM, model: MODEL })
    if (ready.type === 'error') throw new Error(String(ready.message))
    out.initMs = ready.initMs
    const measure = async (withHands: boolean, n: number) => {
      const bitmapMs: number[] = []
      const roundMs: number[] = []
      const detectMs: number[] = []
      let hands = 0
      for (let i = 0; i < n; i++) {
        drawFrame(withHands)
        const t0 = performance.now()
        const bmp = await createImageBitmap(src)
        const t1 = performance.now()
        const r = await call({ type: 'detect', bitmap: bmp, ts: performance.now() }, [bmp], 10000)
        const t2 = performance.now()
        if (r.type === 'error') throw new Error(String(r.message))
        bitmapMs.push(t1 - t0)
        roundMs.push(t2 - t1)
        detectMs.push(r.ms as number)
        hands = r.count as number
      }
      return {
        createImageBitmap: stats(bitmapMs),
        roundTrip: stats(roundMs),
        detectInWorker: stats(detectMs),
        hands,
      }
    }
    await measure(true, 10)
    const withHands = await measure(true, FRAMES)
    const blank = await measure(false, BLANK)
    out.withHands = withHands
    out.blank = blank
    log(
      `${kind}/${delegate}: init ${out.initMs} ms; có tay: bitmap p50 ${withHands.createImageBitmap.p50} ms, round trip p50 ${withHands.roundTrip.p50} p95 ${withHands.roundTrip.p95} ms, detect-in-worker p50 ${withHands.detectInWorker.p50} ms (hands ${withHands.hands}); trống round trip p50 ${blank.roundTrip.p50} ms`,
    )
  } catch (err) {
    out.error = String(err)
    log(`${kind}/${delegate}: LỖI ${String(err)}`)
  }
  worker.terminate()
  return out
}

results.wasmBase = WASM
if (!ONLY || ONLY === 'main') {
  setStatus('main GPU')
  results.mainGPU = await runMain('GPU')
  setStatus('main CPU')
  results.mainCPU = await runMain('CPU')
}
if (!ONLY || ONLY === 'module') {
  setStatus('worker module GPU')
  results.workerModuleGPU = await runWorker('module', 'GPU')
}
if (!ONLY || ONLY === 'classic') {
  setStatus('worker classic GPU')
  results.workerClassicGPU = await runWorker('classic', 'GPU')
  setStatus('worker classic CPU')
  results.workerClassicCPU = await runWorker('classic', 'CPU')
}
setStatus('xong')
report(results)
