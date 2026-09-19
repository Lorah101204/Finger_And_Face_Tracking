import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { expect, test, type CDPSession, type Page } from '@playwright/test'
import {
  expectGateClean,
  handsAtCell,
  installGateAudit,
  installGumCounter,
  note,
  openApp,
  readLoop,
  readStage,
  seedConsent,
  setFakeHands,
  type StatsSnap,
} from '../e2e/helpers'

// PERF-01 bước 5 (mục 7.19): soak SOAK_MINUTES phút (mặc định 15) với nguồn tổng hợp và vùng mở theo tay: có
// public/spike-assets/hands.jpg (cục bộ) thì worker tay thật chạy trên ảnh tĩnh (tuổi điểm 1000 ms như hands.spec),
// không thì tay giả lập chạy quỹ đạo tròn (mask, hysteresis, buffer đổi liên tục). Worker mặt nhận buffer suốt. Mỗi
// SOAK_SAMPLE_S giây (mặc định 30) lấy một mẫu: stats (fps, Hz, p50/p95), heap sau khi ép GC và số node, listener
// qua CDP Performance.getMetrics, tác vụ chờ, trạng thái vùng, gate audit, lỗi trang. Khẳng định: không lỗi trang,
// chờ ≤ 1 ở mọi mẫu, heap phần ba cuối không vượt phần ba đầu quá 15 % hay 8 MB, node và listener không tăng dần,
// fps phần ba cuối ≥ 60 % phần ba đầu, mặt vẫn có kết quả, vùng mở hơn 90 % thời gian, gate cứng sạch. Mẫu thô ghi
// reports/soak-samples.json cho tools/benchmark-report.mjs.
const MINUTES = Number(process.env.SOAK_MINUTES ?? 15)
const SAMPLE_S = Number(process.env.SOAK_SAMPLE_S ?? 30)
const HANDS_FILE = 'public/spike-assets/hands.jpg'
const HANDS_SRC = '/spike-assets/hands.jpg'
/** Như hands.spec: ảnh 640 × 960 vẽ tỉ lệ 0,75 vào giữa khung 1280 × 720. */
const IMG = { x: 400, y: 0, w: 480, h: 720 }
const OUT = 'reports/soak-samples.json'

type Sample = {
  t: number
  fps: number
  handHz: number
  faceHz: number
  classifierHz: number
  face: StatsSnap['face']
  hand: StatsSnap['hand']
  render: StatsSnap['render']
  tick: StatsSnap['tick']
  epoch: number
  status: string
  open: boolean
  heapUsedMB: number
  heapTotalMB: number
  nodes: number
  listeners: number
  documents: number
  frames: number
  faceAccepted: number
  faceStale: number
  gateFrames: number
  gateDirty: number
  pageErrors: number
  consoleErrors: number
}

async function metrics(cdp: CDPSession): Promise<Record<string, number>> {
  await cdp.send('HeapProfiler.collectGarbage')
  const { metrics } = await cdp.send('Performance.getMetrics')
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]))
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor((s.length - 1) / 2)]
}
/** Phần ba đầu hoặc cuối (ít nhất một mẫu). */
const third = (xs: number[], which: 'first' | 'last') => {
  const n = Math.max(1, Math.floor(xs.length / 3))
  return which === 'first' ? xs.slice(0, n) : xs.slice(xs.length - n)
}

function chromiumVersion(): { title: string; version: string; revision: string } {
  const b = JSON.parse(readFileSync('node_modules/playwright-core/browsers.json', 'utf8')) as {
    browsers: { name: string; title: string; browserVersion: string; revision: string }[]
  }
  const c = b.browsers.find((x) => x.name === 'chromium-headless-shell') ?? b.browsers[0]
  return { title: c.title, version: c.browserVersion, revision: c.revision }
}

async function selectHands(page: Page) {
  await page.getByLabel('Nguồn cửa sổ').selectOption('hands')
  await expect(page.getByLabel('N min')).toBeVisible()
  let st = await readStage(page)
  for (;;) {
    await page.waitForTimeout(150)
    const next = await readStage(page)
    if (next.stageSize.w === st.stageSize.w && next.stageSize.h === st.stageSize.h) return next
    st = next
  }
}

test('soak: vùng mở theo tay và worker mặt chạy liên tục; bộ nhớ không tăng dần, fps ổn định, tác vụ chờ ≤ 1, không lỗi trang', async ({
  page,
}) => {
  test.setTimeout((MINUTES + 6) * 60_000)
  const pageErrors: string[] = []
  let consoleErrors = 0
  page.on('pageerror', (e) => pageErrors.push(String(e)))
  page.on('crash', () => pageErrors.push('crash'))
  // MediaPipe ghi dòng "INFO: Created TensorFlow Lite XNNPACK delegate" qua console.error: không tính.
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().startsWith('INFO:')) consoleErrors++
  })
  await installGumCounter(page)
  await seedConsent(page)
  await openApp(page, '?debug=1&source=synthetic')
  await expect(page.locator('canvas#stage')).toBeVisible()
  await readStage(page)
  await installGateAudit(page)
  // Probe 500 ms để audit không thành tải chính của soak.
  await page.evaluate(() => {
    window.__wct!.probes!.minIntervalMs.restricted = 500
  })
  const mode = existsSync(HANDS_FILE) ? 'real-hands' : 'fake-hands'
  if (mode === 'real-hands') {
    await page.evaluate(
      ([src, img]) => window.__scenario!.scene({ person: null, face: { src, ...img } }),
      [HANDS_SRC, IMG] as const,
    )
  }
  const st = await selectHands(page)
  if (mode === 'real-hands') {
    await page.waitForFunction(
      () => window.__wct?.hands?.snapshot().client.ready === true,
      undefined,
      { timeout: 120_000 },
    )
    await page.getByLabel('Tuổi điểm').fill('1000')
  } else {
    const L = st.layout
    await setFakeHands(
      page,
      handsAtCell(L, 32, 18, 8.2, {
        orbit: { radius: (3 * L.c) / L.scale, periodMs: 8000 },
        jitter: 2,
      }),
    )
  }
  await page.waitForFunction(() => window.__wct?.face?.snapshot().ready === true, undefined, {
    timeout: 120_000,
  })
  await expect
    .poll(async () => (await readLoop(page)).reveal.kind, { timeout: 60_000 })
    .toBe('open')

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  await cdp.send('HeapProfiler.enable')
  const samples: Sample[] = []
  const t0 = Date.now()
  const total = MINUTES * 60_000
  await page.waitForTimeout(Math.min(10_000, total))
  for (;;) {
    const m = await metrics(cdp)
    const p = await page.evaluate(() => {
      const s = window.__wct!.stats!.snapshot()
      const l = window.__wct!.loop!.snapshot()
      const a = window.__gateAudit!
      return {
        s,
        frames: l.frames,
        open: l.reveal.kind === 'open',
        accepted: l.faceGate.accepted,
        stale: l.faceGate.rejected.stale,
        gateFrames: a.frames,
        gateDirty: a.dirty.length,
      }
    })
    const sample: Sample = {
      t: Math.round((Date.now() - t0) / 100) / 10,
      fps: p.s.fpsOutput,
      handHz: p.s.handHz,
      faceHz: p.s.faceHz,
      classifierHz: p.s.classifierHz,
      face: p.s.face,
      hand: p.s.hand,
      render: p.s.render,
      tick: p.s.tick,
      epoch: p.s.epoch,
      status: p.s.status,
      open: p.open,
      heapUsedMB: m.JSHeapUsedSize / 2 ** 20,
      heapTotalMB: m.JSHeapTotalSize / 2 ** 20,
      nodes: m.Nodes,
      listeners: m.JSEventListeners,
      documents: m.Documents,
      frames: p.frames,
      faceAccepted: p.accepted,
      faceStale: p.stale,
      gateFrames: p.gateFrames,
      gateDirty: p.gateDirty,
      pageErrors: pageErrors.length,
      consoleErrors,
    }
    samples.push(sample)
    // Khẳng định từng mẫu: không lỗi trang, một tác vụ mặt tại một thời điểm, vòng lặp vẫn chạy.
    expect(pageErrors).toEqual([])
    expect(sample.face.pending).toBeLessThanOrEqual(1)
    expect(sample.fps).toBeGreaterThan(0)
    const elapsed = Date.now() - t0
    if (elapsed >= total) break
    await page.waitForTimeout(Math.min(SAMPLE_S * 1000, total - elapsed))
  }

  const heap = samples.map((s) => s.heapUsedMB)
  const fps = samples.map((s) => s.fps)
  const heapFirst = mean(third(heap, 'first'))
  const heapLast = mean(third(heap, 'last'))
  const summary = {
    samples: samples.length,
    durationS: samples[samples.length - 1].t,
    fpsMedian: median(fps),
    fpsMin: Math.min(...fps),
    fpsFirst: mean(third(fps, 'first')),
    fpsLast: mean(third(fps, 'last')),
    handHzMedian: median(samples.map((s) => s.handHz)),
    faceHzMedian: median(samples.map((s) => s.faceHz)),
    classifierHzMedian: median(samples.map((s) => s.classifierHz)),
    faceP50Median: median(samples.map((s) => s.face.p50)),
    faceP95Max: Math.max(...samples.map((s) => s.face.p95)),
    handP50Median: median(samples.map((s) => s.hand.p50)),
    handP95Max: Math.max(...samples.map((s) => s.hand.p95)),
    renderP95Max: Math.max(...samples.map((s) => s.render.p95)),
    tickP95Max: Math.max(...samples.map((s) => s.tick.p95)),
    heapFirstMB: heapFirst,
    heapLastMB: heapLast,
    heapGrowthPct: heapFirst > 0 ? ((heapLast - heapFirst) / heapFirst) * 100 : 0,
    heapMaxMB: Math.max(...heap),
    nodesDelta: samples[samples.length - 1].nodes - samples[0].nodes,
    listenersDelta: samples[samples.length - 1].listeners - samples[0].listeners,
    pendingMax: Math.max(...samples.map((s) => s.face.pending)),
    faceDroppedTotal: samples[samples.length - 1].face.dropped,
    handSkippedTotal: samples[samples.length - 1].hand.skipped,
    openFraction: samples.filter((s) => s.open).length / samples.length,
    faceAccepted: samples[samples.length - 1].faceAccepted,
    gateFrames: samples[samples.length - 1].gateFrames,
    gateDirty: samples[samples.length - 1].gateDirty,
    pageErrors: pageErrors.length,
    consoleErrors,
  }
  const cpu = os.cpus()
  const env = {
    os: `${os.type()} ${os.release()} (${os.arch()})`,
    cpu: cpu[0]?.model.trim() ?? '?',
    threads: cpu.length,
    memGB: Math.round(os.totalmem() / 2 ** 30),
    node: process.version,
    chromium: chromiumVersion(),
    headless: true,
  }
  mkdirSync('reports', { recursive: true })
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        startedAt: new Date(t0).toISOString(),
        minutes: MINUTES,
        sampleS: SAMPLE_S,
        mode,
        env,
        samples,
        summary,
      },
      null,
      2,
    ),
  )
  await test.info().attach('soak-samples', { path: OUT, contentType: 'application/json' })

  expect(summary.pendingMax).toBeLessThanOrEqual(1)
  expect(summary.pageErrors).toBe(0)
  expect(summary.heapGrowthPct <= 15 || summary.heapLastMB - summary.heapFirstMB <= 8).toBe(true)
  expect(summary.nodesDelta).toBeLessThanOrEqual(200)
  expect(summary.listenersDelta).toBeLessThanOrEqual(100)
  expect(summary.fpsLast).toBeGreaterThanOrEqual(0.6 * summary.fpsFirst)
  expect(summary.faceHzMedian).toBeGreaterThan(0)
  expect(summary.openFraction).toBeGreaterThan(0.9)
  expect(summary.gateDirty).toBe(0)
  note(
    `${mode}, ${summary.durationS} s, ${summary.samples} mẫu: output ${summary.fpsMedian.toFixed(1)} fps (đầu ${summary.fpsFirst.toFixed(1)},` +
      ` cuối ${summary.fpsLast.toFixed(1)}), tay ${summary.handHzMedian.toFixed(1)} Hz, mặt ${summary.faceHzMedian.toFixed(1)} Hz` +
      ` (p50 ${summary.faceP50Median.toFixed(0)} ms, p95 tối đa ${summary.faceP95Max.toFixed(0)} ms), vẽ p95 tối đa` +
      ` ${summary.renderP95Max.toFixed(2)} ms; heap ${summary.heapFirstMB.toFixed(1)} → ${summary.heapLastMB.toFixed(1)} MB` +
      ` (${summary.heapGrowthPct.toFixed(1)} %), node ${summary.nodesDelta >= 0 ? '+' : ''}${summary.nodesDelta}, listener` +
      ` ${summary.listenersDelta >= 0 ? '+' : ''}${summary.listenersDelta}; chờ tối đa ${summary.pendingMax}; mở ${(summary.openFraction * 100).toFixed(0)} %`,
  )
  await expectGateClean(page)
  if (mode === 'fake-hands') await setFakeHands(page, null)
})
