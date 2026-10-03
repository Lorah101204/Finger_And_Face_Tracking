// PERF-05 (D-065): go/no-go probe for shrinking the frame sent to the hand landmarker on the CPU delegate. Runs MediaPipe
// Hand Landmarker (VIDEO mode, numHands 2, CPU delegate) inside a page of the dev server on a 1280 × 720 canvas holding a
// still image, and for each input width times the main-thread createImageBitmap (with resize options, as HandClient
// would) and detectForVideo, in blocks of frames per width repeated in rotated order so drift and warm-up spread evenly.
// Accuracy is the displacement of each fingertip's median position (camera px of the 1280 × 720 frame) against the
// full-resolution block of the same scene. Isolated from the app loop, workers and the other models on purpose: it
// measures only the size-dependent cost (upload, readback, resampling) that a smaller input can remove.
// `--worker` runs the landmarker in a module worker and transfers each bitmap to it, as the app does (hand.worker.ts);
// the detect time is still `detectForVideo` alone, timed inside the worker (the transfer is not included). Every cross-origin request
// (the usage telemetry tasks-vision posts, which the app blocks with core/networkGuard.ts) is aborted (I9).
// Usage: node tools/probe-hand-input.mjs [baseUrl=http://localhost:5173] [--browser chrome|chromium] [--frames 40]
//   [--rounds 2] [--widths 0,960,640,480,320] [--worker] [--json out.json]
//   scenes: spike-assets/hands.jpg (two hands: palm detection settles into tracking), pointing_up.jpg (one hand: with
//   numHands 2 the palm detector keeps running every frame), hands.jpg at half size (a distant user).
/* global Image, document, location, Worker, createImageBitmap */
import { writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args.splice(i, 2)[1] : def
}
const browserName = opt('browser', 'chrome')
const frames = Number(opt('frames', 40))
const rounds = Number(opt('rounds', 2))
const widths = opt('widths', '0,960,640,480,320').split(',').map(Number)
const jsonPath = opt('json', null)
const wi = args.indexOf('--worker')
const useWorker = wi >= 0
if (useWorker) args.splice(wi, 1)
const base = args.find((a) => a.startsWith('http')) ?? 'http://localhost:5173'

const browser = await chromium.launch(
  browserName === 'chrome' ? { channel: 'chrome', headless: true } : { headless: true },
)
const page = await browser.newPage()
// I9: chỉ cùng origin (context route cũng áp cho request của worker).
await page
  .context()
  .route('**/*', (r) =>
    new URL(r.request().url()).origin === new URL(base).origin ? r.continue() : r.abort(),
  )
page.on('console', (m) => {
  if (m.type() === 'error') console.error('[page]', m.text().slice(0, 300))
})
page.on('pageerror', (e) => console.error('[pageerror]', String(e).slice(0, 300)))
await page.goto(base + '/')
const out = await page.evaluate(
  async ({ frames, rounds, widths, useWorker }) => {
    const origin = location.origin
    const setup = async (mp) => {
      const fs = await mp.FilesetResolver.forVisionTasks(
        `${origin}/node_modules/@mediapipe/tasks-vision/wasm`,
      )
      return mp.HandLandmarker.createFromOptions(fs, {
        baseOptions: { modelAssetPath: `${origin}/models/hand_landmarker.task`, delegate: 'CPU' },
        runningMode: 'VIDEO',
        numHands: 2,
      })
    }
    // detect(bitmap, ts) → { ms, landmarks, handedness }; closes or transfers the bitmap.
    let detect
    let close
    if (useWorker) {
      const code = `
        let lm = null
        self.onmessage = async (e) => {
          if (e.data.type === 'init') {
            const mp = await import('${origin}/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs')
            const fs = await mp.FilesetResolver.forVisionTasks('${origin}/node_modules/@mediapipe/tasks-vision/wasm', true)
            lm = await mp.HandLandmarker.createFromOptions(fs, {
              baseOptions: { modelAssetPath: '${origin}/models/hand_landmarker.task', delegate: 'CPU' },
              runningMode: 'VIDEO', numHands: 2 })
            self.postMessage({ type: 'ready' })
            return
          }
          const t0 = performance.now()
          const r = lm.detectForVideo(e.data.bitmap, e.data.ts)
          const ms = performance.now() - t0
          e.data.bitmap.close()
          self.postMessage({ type: 'result', ms, landmarks: r.landmarks, handedness: r.handedness })
        }`
      const w = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })), {
        type: 'module',
      })
      let pending = null
      w.onmessage = (e) => pending?.(e.data)
      await new Promise((res) => {
        pending = res
        w.postMessage({ type: 'init' })
      })
      detect = (bitmap, ts) =>
        new Promise((res) => {
          pending = res
          w.postMessage({ type: 'frame', bitmap, ts }, [bitmap])
        })
      close = () => w.terminate()
    } else {
      const lm = await setup(
        await import('/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs'),
      )
      detect = async (bitmap, ts) => {
        const t0 = performance.now()
        const r = lm.detectForVideo(bitmap, ts)
        const ms = performance.now() - t0
        bitmap.close()
        return { ms, landmarks: r.landmarks, handedness: r.handedness }
      }
      close = () => lm.close()
    }
    const load = (src) =>
      new Promise((res, rej) => {
        const i = new Image()
        i.onload = () => res(i)
        i.onerror = rej
        i.src = src
      })
    const W = 1280
    const H = 720
    const scene = async (file, scale) => {
      const img = await load(`/spike-assets/${file}`)
      const c = document.createElement('canvas')
      c.width = W
      c.height = H
      const g = c.getContext('2d')
      g.fillStyle = '#808080'
      g.fillRect(0, 0, W, H)
      const s = Math.min(W / img.width, H / img.height) * scale
      const w = img.width * s
      const h = img.height * s
      g.drawImage(img, (W - w) / 2, (H - h) / 2, w, h)
      return c
    }
    const scenes = {
      two: await scene('hands.jpg', 1),
      one: await scene('pointing_up.jpg', 1),
      small: await scene('hands.jpg', 0.5),
    }
    const q = (arr, p) => {
      const s = [...arr].sort((a, b) => a - b)
      return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN
    }
    let ts = 0
    const res = {}
    for (const [name, canvas] of Object.entries(scenes)) {
      const acc = Object.fromEntries(
        widths.map((w) => [w, { bmp: [], det: [], tips: {}, seen: [] }]),
      )
      for (let r = 0; r < rounds; r++) {
        // Rotate the order each round so no width always runs first (cold) or last.
        const order = widths.map((_, i) => widths[(i + r) % widths.length])
        for (const w of order) {
          const a = acc[w]
          for (let f = 0; f < frames + 5; f++) {
            const t0 = performance.now()
            const bmp = w
              ? await createImageBitmap(canvas, {
                  resizeWidth: w,
                  resizeHeight: Math.round((H * w) / W),
                  resizeQuality: 'medium',
                })
              : await createImageBitmap(canvas)
            const t1 = performance.now()
            ts += 33
            const result = await detect(bmp, ts)
            if (f < 5) continue // the first frames of a block re-settle tracking after a size change
            a.bmp.push(t1 - t0)
            a.det.push(result.ms)
            a.seen.push(result.landmarks.length)
            result.landmarks.forEach((hand, h) => {
              const label = result.handedness[h]?.[0]?.categoryName ?? `h${h}`
              for (const tip of [4, 8, 12, 16, 20]) {
                const k = `${label}:${tip}`
                ;(a.tips[k] ??= { x: [], y: [] }).x.push(hand[tip].x * W)
                a.tips[k].y.push(hand[tip].y * H)
              }
            })
          }
        }
      }
      const ref = acc[widths[0]]
      const med = (t) => ({ x: q(t.x, 0.5), y: q(t.y, 0.5) })
      res[name] = widths.map((w) => {
        const a = acc[w]
        const errs = []
        for (const [k, t] of Object.entries(a.tips)) {
          const rt = ref.tips[k]
          if (!rt) continue
          const m = med(t)
          const mr = med(rt)
          errs.push(Math.hypot(m.x - mr.x, m.y - mr.y))
        }
        const seen = a.seen.reduce((s, v) => s + v, 0) / Math.max(1, a.seen.length)
        return {
          width: w || W,
          bmpP50: q(a.bmp, 0.5),
          detP50: q(a.det, 0.5),
          detP95: q(a.det, 0.95),
          totalP50: q(
            a.bmp.map((b, i) => b + a.det[i]),
            0.5,
          ),
          handsSeen: seen,
          tipErrMeanPx: errs.length ? errs.reduce((s, v) => s + v, 0) / errs.length : null,
          tipErrMaxPx: errs.length ? Math.max(...errs) : null,
          tips: errs.length,
        }
      })
    }
    close()
    return res
  },
  { frames, rounds, widths, useWorker },
)
await browser.close()

const f = (v, d = 1) => (v === null || Number.isNaN(v) ? '—' : v.toFixed(d))
console.log(
  `probe-hand-input: ${browserName}, CPU delegate${useWorker ? ', module worker with transferred bitmaps' : ', page thread'}, ${frames} frames × ${rounds} rounds per width`,
)
for (const [scene, rows] of Object.entries(out)) {
  const full = rows[0]
  for (const r of rows)
    console.log(
      `${scene.padEnd(5)} ${String(r.width).padStart(4)} px: bitmap p50 ${f(r.bmpP50, 2)} ms, detect p50 ${f(r.detP50)} / p95 ${f(r.detP95)} ms,` +
        ` bitmap+detect p50 ${f(r.totalP50)} ms (${f((100 * (r.totalP50 - full.totalP50)) / full.totalP50, 0)} %),` +
        ` hands ${f(r.handsSeen, 2)}, tip error mean ${f(r.tipErrMeanPx)} / max ${f(r.tipErrMaxPx)} px (${r.tips} tips)`,
    )
}
if (jsonPath)
  writeFileSync(
    jsonPath,
    JSON.stringify({ browser: browserName, useWorker, frames, rounds, out }, null, 2),
  )
