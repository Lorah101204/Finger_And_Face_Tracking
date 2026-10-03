// PERF-02 (D-052): measures the frame loop on a running dev server (or preview) with the synthetic source in seven states
// (region closed, mouse window, orbiting fake hands, still fake hands, the same two at camera rate, closed again):
// main-thread and script share from CDP Performance.getMetrics, and per second the loop's paints, frames, mask builds and
// camera frames, plus render and tick p50/p95 from window.__wct (without --ab). Chrome via
// channel (real GPU even when headless; rAF is not tied to the display there, so fps is higher than on a monitor).
// PERF-04 (D-064): `--ab` alternates the loop's paint-always switch (window.__wct.loop.setPaintAlways) within each state
// in ABAB order (3 pairs by default), so the paint saving is measured in the same page and state, not across builds;
// reports medians of paints/s, frames/s, mask builds/s, camera frames/s and main-thread share per arm. Deltas are taken
// per segment from snapshots at its start and end.
// Usage: node tools/measure-loop.mjs [baseUrl=http://localhost:5173] [secondsPerState=12] [label] [--ab] [--pairs 3]
/* global window */
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  if (i < 0) return false
  args.splice(i, 1)
  return true
}
const opt = (name, def) => {
  const i = args.indexOf(name)
  return i >= 0 ? args.splice(i, 2)[1] : def
}
const ab = flag('--ab')
const pairs = Number(opt('--pairs', 3))
const base = args[0] ?? 'http://localhost:5173'
const seconds = Number(args[1] ?? 12)
const label = args[2] ?? ''
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
const page = await context.newPage()
await page.goto(base + '/')
await page.evaluate(() => localStorage.setItem('wct.consent', '2026-09-17'))
await page.goto('about:blank')
await page.goto(base + '/#/app?debug=1&source=synthetic')
await page.waitForFunction(
  () => !!window.__scenario && !!window.__wct?.stats && !!window.__wct?.loop,
)
const cdp = await context.newCDPSession(page)
await cdp.send('Performance.enable')
async function metrics() {
  const { metrics } = await cdp.send('Performance.getMetrics')
  const get = (n) => metrics.find((m) => m.name === n)?.value ?? 0
  return { task: get('TaskDuration'), script: get('ScriptDuration'), ts: get('Timestamp') }
}
const counters = () =>
  page.evaluate(() => {
    const l = window.__wct.loop.snapshot()
    return { paints: l.paints, frames: l.frames, builds: l.maskBuilds, cam: l.output.frameId }
  })

/** Một đoạn đo: chia sẻ main thread và hiệu bộ đếm (theo giây) từ đầu tới cuối đoạn. */
async function segment(secs) {
  const c0 = await counters()
  const m0 = await metrics()
  await page.waitForTimeout(secs * 1000)
  const m1 = await metrics()
  const c1 = await counters()
  const dt = m1.ts - m0.ts
  return {
    cpu: ((m1.task - m0.task) / dt) * 100,
    js: ((m1.script - m0.script) / dt) * 100,
    paints: (c1.paints - c0.paints) / dt,
    frames: (c1.frames - c0.frames) / dt,
    builds: (c1.builds - c0.builds) / dt,
    cam: (c1.cam - c0.cam) / dt,
  }
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}
const f1 = (v) => v.toFixed(1)

async function sample(name) {
  if (!ab) {
    const r = await segment(seconds)
    const s = await page.evaluate(() => window.__wct.stats.snapshot())
    const cells = await page.evaluate(
      () => window.__wct.loop.snapshot().output.reveal?.cells.length ?? 0,
    )
    console.log(
      `${label} ${name}: main thread ${f1(r.cpu)} % (script ${f1(r.js)} %) · paints/s ${f1(r.paints)} · frames/s ${f1(r.frames)} · mask builds/s ${f1(r.builds)} · camera frames/s ${f1(r.cam)} · cells ${cells} · render p50 ${s.render.p50.toFixed(3)} p95 ${s.render.p95.toFixed(3)} · tick p50 ${s.tick.p50.toFixed(3)} p95 ${s.tick.p95.toFixed(3)} · status ${s.status}`,
    )
    return
  }
  // ABAB: B = paint always (PERF-02), A = paint gate (PERF-04). Một giây ổn định sau mỗi lần đổi.
  const seg = Math.max(2, seconds / (2 * pairs))
  const arms = { gate: [], always: [] }
  for (let i = 0; i < pairs; i++) {
    for (const arm of ['gate', 'always']) {
      await page.evaluate((on) => window.__wct.loop.setPaintAlways(on), arm === 'always')
      await page.waitForTimeout(1000)
      arms[arm].push(await segment(seg))
    }
  }
  await page.evaluate(() => window.__wct.loop.setPaintAlways(false))
  const line = (arm) => {
    const a = arms[arm]
    const m = (k) => median(a.map((r) => r[k]))
    const cpu = a.map((r) => r.cpu)
    return `main thread ${f1(m('cpu'))} % [${f1(Math.min(...cpu))}–${f1(Math.max(...cpu))}] · paints/s ${f1(m('paints'))} · frames/s ${f1(m('frames'))} · mask builds/s ${f1(m('builds'))} · camera frames/s ${f1(m('cam'))}`
  }
  console.log(`${label} ${name}: gate ${line('gate')} | always ${line('always')}`)
}

// 0. idle: region closed, camera synthetic running, nothing dynamic
await sample('idle-closed')

// 1. mouse window 12 cells at (20, 10)
await page.evaluate(() => window.__scenario.run('windowAt', 20, 10, 12))
await sample('mouse')

// 2. fake hands orbiting (polygon, rasterized each hand frame)
await page.getByLabel('Nguồn cửa sổ').selectOption('hands')
await page.evaluate(() => {
  const st = window.__wct.stage.snapshot()
  const L = st.layout
  const cam = st.camSize
  window.__scenario.hands({
    left: { x: cam.w * 0.35, y: cam.h * 0.5, spread: 160 },
    right: { x: cam.w * 0.65, y: cam.h * 0.5, spread: 160 },
    orbit: { radius: (3 * L.c) / L.scale, periodMs: 4000 },
  })
})
await sample('hands-orbit')

// 3. fake hands still (a new HandFrame with the same values every frame)
await page.evaluate(() => {
  const st = window.__wct.stage.snapshot()
  const cam = st.camSize
  window.__scenario.hands({
    left: { x: cam.w * 0.35, y: cam.h * 0.5, spread: 160 },
    right: { x: cam.w * 0.65, y: cam.h * 0.5, spread: 160 },
  })
})
await sample('hands-still')

// 3b. PERF-04: the same fake hands at camera rate (a new HandFrame only per camera frame, like the real ~30 Hz worker)
for (const [name, orbit] of [
  ['hands-orbit-cam', true],
  ['hands-still-cam', false],
]) {
  await page.evaluate((orbit) => {
    const st = window.__wct.stage.snapshot()
    const L = st.layout
    const cam = st.camSize
    window.__scenario.hands({
      left: { x: cam.w * 0.35, y: cam.h * 0.5, spread: 160 },
      right: { x: cam.w * 0.65, y: cam.h * 0.5, spread: 160 },
      ...(orbit ? { orbit: { radius: (3 * L.c) / L.scale, periodMs: 4000 } } : {}),
      cameraRate: true,
    })
  }, orbit)
  await sample(name)
}

// 4. back to closed with hands source but no hands (fingers empty)
await page.evaluate(() => window.__scenario.hands(null))
await page.getByLabel('Nguồn cửa sổ').selectOption('mouse')
await page.evaluate(() => window.__scenario.run('coverAll'))
await page.waitForTimeout(500)
await sample('idle-after')

await browser.close()
