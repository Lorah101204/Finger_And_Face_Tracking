// ROI-04 (D-055): per-finger extension metrics from MediaPipe Hand Landmarker on still images, to choose and re-check the
// "raised finger" thresholds. Runs the landmarker inside a page of the dev server (models and wasm from the same
// origin, IMAGE mode, CPU delegate) on the spike images and prints, for every detected hand and finger: the landmark
// `visibility` reported by the model, the wrist→tip / wrist→PIP distance ratio in 2D (image px) and in 3D (world
// landmarks, meters), the angles at the PIP and DIP joints (3D), the thumb abduction ratio |tip→pinky MCP| / |IP→pinky
// MCP| (3D) and whether the tip lies inside the 2D palm polygon (landmarks 0, 1, 5, 9, 13, 17).
// Usage: node tools/probe-fingers.mjs [baseUrl=http://localhost:5173] [--json out.json] [image ...]
//   default images: spike-assets/hands.jpg, pointing_up.jpg, thumbs_up.jpg (npm run spikes:fetch)
//   --json writes the raw 2D and world landmarks per hand (unit-test fixtures for hands/fingerPose.ts).
/* global Image */
import { writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const jsonAt = args.indexOf('--json')
const jsonPath = jsonAt >= 0 ? args.splice(jsonAt, 2)[1] : null
const base = args.find((a) => a.startsWith('http')) ?? 'http://localhost:5173'
const images = args.filter((a) => !a.startsWith('http'))
const files = images.length ? images : ['hands.jpg', 'pointing_up.jpg', 'thumbs_up.jpg']

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage()
await page.goto(base + '/')
const result = await page.evaluate(async (names) => {
  const mp = await import('/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs')
  const fs = await mp.FilesetResolver.forVisionTasks('/node_modules/@mediapipe/tasks-vision/wasm')
  const lm = await mp.HandLandmarker.createFromOptions(fs, {
    baseOptions: { modelAssetPath: '/models/hand_landmarker.task', delegate: 'CPU' },
    runningMode: 'IMAGE',
    numHands: 2,
  })
  const load = (src) =>
    new Promise((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = rej
      i.src = src
    })
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0))
  const angle = (a, b, c) => {
    const v1 = [a.x - b.x, a.y - b.y, a.z - b.z]
    const v2 = [c.x - b.x, c.y - b.y, c.z - b.z]
    const dot = v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]
    const n = Math.hypot(...v1) * Math.hypot(...v2)
    return (Math.acos(Math.max(-1, Math.min(1, dot / n))) * 180) / Math.PI
  }
  const inPalm = (n2d, q) => {
    const poly = [0, 1, 5, 9, 13, 17].map((i) => n2d[i])
    let inside = false
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i]
      const b = poly[j]
      if (a.y > q.y !== b.y > q.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x)
        inside = !inside
    }
    return inside
  }
  const FINGERS = [
    ['thumb', 1, 2, 3, 4],
    ['index', 5, 6, 7, 8],
    ['middle', 9, 10, 11, 12],
    ['ring', 13, 14, 15, 16],
    ['pinky', 17, 18, 19, 20],
  ]
  const rows = []
  const raw = []
  for (const name of names) {
    const img = await load('/spike-assets/' + name)
    const r = lm.detect(img)
    r.landmarks.forEach((n2d, hi) => {
      const w = r.worldLandmarks[hi]
      const label = r.handedness[hi][0].categoryName
      raw.push({
        image: name,
        width: img.width,
        height: img.height,
        label,
        score: r.handedness[hi][0].score,
        landmarksNorm: n2d.map((p) => [p.x, p.y, p.z]),
        worldLandmarks: w.map((p) => [p.x, p.y, p.z]),
      })
      for (const [finger, mcp, pip, dip, tip] of FINGERS) {
        const px = (i) => ({ x: n2d[i].x * img.width, y: n2d[i].y * img.height })
        rows.push({
          image: name,
          hand: label,
          finger,
          visibility: n2d[tip].visibility ?? -1,
          r2d: dist(px(tip), px(0)) / dist(px(pip), px(0)),
          r3d: dist(w[0], w[tip]) / dist(w[0], w[pip]),
          aPip: angle(w[mcp], w[pip], w[dip]),
          aDip: angle(w[pip], w[dip], w[tip]),
          abduction: dist(w[tip], w[17]) / dist(w[dip], w[17]),
          inPalm: inPalm(n2d, n2d[tip]),
        })
      }
    })
  }
  return { rows, raw }
}, files)
await browser.close()

const f = (v, d = 2) => String(Number(v).toFixed(d)).padStart(5)
console.log('image           hand  finger |  vis |  r2d   r3d | aPip aDip | abduct | inPalm')
for (const r of result.rows)
  console.log(
    `${r.image.padEnd(15)} ${r.hand.padEnd(5)} ${r.finger.padEnd(6)} | ${f(r.visibility, 1).padStart(4)} | ${f(r.r2d)} ${f(r.r3d)} | ${f(r.aPip, 0).padStart(4)} ${f(r.aDip, 0).padStart(4)} | ${f(r.abduction).padStart(6)} | ${r.inPalm}`,
  )
if (jsonPath) {
  writeFileSync(jsonPath, JSON.stringify(result.raw, null, 2))
  console.log(`landmarks of ${result.raw.length} hands written to ${jsonPath}`)
}
