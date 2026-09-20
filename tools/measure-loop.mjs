// PERF-02 (D-052): measures the frame loop on a running dev server (or preview) with the synthetic source in five states
// (region closed, mouse window, orbiting fake hands, still fake hands, closed again): main-thread share and script share
// from CDP Performance.getMetrics, output fps, loop paints/frames, render and tick p50/p95 from window.__wct. Chrome via
// channel (real GPU even when headless; rAF is not tied to the display there, so fps is higher than on a monitor).
// Usage: node tools/measure-loop.mjs [baseUrl=http://localhost:5173] [secondsPerState=12] [label]
/* global window */
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:5173'
const seconds = Number(process.argv[3] ?? 12)
const label = process.argv[4] ?? ''
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
const page = await context.newPage()
await page.goto(base + '/')
await page.evaluate(() => localStorage.setItem('wct.consent', '2026-09-17'))
await page.goto('about:blank')
await page.goto(base + '/#/app?debug=1&source=synthetic')
await page.waitForFunction(() => !!window.__scenario && !!window.__wct?.stats)
const cdp = await context.newCDPSession(page)
await cdp.send('Performance.enable')
async function metrics() {
  const { metrics } = await cdp.send('Performance.getMetrics')
  const get = (n) => metrics.find((m) => m.name === n)?.value ?? 0
  return { task: get('TaskDuration'), script: get('ScriptDuration'), ts: get('Timestamp') }
}

let prev = null
async function sample(name) {
  const m0 = await metrics()
  await page.waitForTimeout(seconds * 1000)
  const m1 = await metrics()
  const cpu = ((m1.task - m0.task) / (m1.ts - m0.ts)) * 100
  const js = ((m1.script - m0.script) / (m1.ts - m0.ts)) * 100
  const r = await page.evaluate(() => {
    const s = window.__wct.stats.snapshot()
    const l = window.__wct.loop.snapshot()
    return {
      paints: l.paints ?? -1,
      fps: s.fpsOutput,
      handHz: s.handHz,
      render: s.render,
      tick: s.tick,
      status: s.status,
      cells: l.output.reveal?.cells.length ?? 0,
      frames: l.frames,
    }
  })
  const dPaints = r.paints >= 0 && prev ? r.paints - prev.paints : -1
  const dFrames = prev ? r.frames - prev.frames : -1
  prev = r
  console.log(
    `${label} ${name}: main thread ${cpu.toFixed(1)} % (script ${js.toFixed(1)} %) · paints/frames ${dPaints}/${dFrames} · fps ${r.fps.toFixed(1)} · cells ${r.cells} · render p50 ${r.render.p50.toFixed(3)} p95 ${r.render.p95.toFixed(3)} · tick p50 ${r.tick.p50.toFixed(3)} p95 ${r.tick.p95.toFixed(3)} · status ${r.status} · handHz ${r.handHz.toFixed(1)}`,
  )
  return r
}

// 0. idle: region closed, camera synthetic running, nothing dynamic
prev = await page.evaluate(() => {
  const l = window.__wct.loop.snapshot()
  return { paints: l.paints ?? -1, frames: l.frames }
})
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

// 3. fake hands still (mask identical every frame)
await page.evaluate(() => {
  const st = window.__wct.stage.snapshot()
  const cam = st.camSize
  window.__scenario.hands({
    left: { x: cam.w * 0.35, y: cam.h * 0.5, spread: 160 },
    right: { x: cam.w * 0.65, y: cam.h * 0.5, spread: 160 },
  })
})
await sample('hands-still')

// 4. back to closed with hands source but no hands (fingers empty)
await page.evaluate(() => window.__scenario.hands(null))
await page.getByLabel('Nguồn cửa sổ').selectOption('mouse')
await page.evaluate(() => window.__scenario.run('coverAll'))
await page.waitForTimeout(500)
prev = await page.evaluate(() => {
  const l = window.__wct.loop.snapshot()
  return { paints: l.paints ?? -1, frames: l.frames }
})
await sample('idle-after')

await browser.close()
