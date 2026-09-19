import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { expect, test, type Page } from '@playwright/test'
import { DEFAULTS } from '../../src/core/config'
import { missingFeatures, shortGpu } from '../../src/debug/envText'
import { resolveHandDelegate } from '../../src/hands/handDelegate'
import {
  installGumCounter,
  note,
  openApp,
  readHands,
  readLoop,
  readStage,
  readStats,
  seedConsent,
  type StageSnap,
  type StatsSnap,
} from '../e2e/helpers'

// QA-02 (mục 7.24): benchmark một trình duyệt (project của playwright.bench.config.ts) trên máy hiện tại, kết quả thô
// ghi reports/bench-<project>.json cho tools/benchmark-report.mjs (ma trận thiết bị trong docs/benchmark.md). Bốn ca,
// chạy tuần tự trên cùng worker: (1) môi trường: trình duyệt, GPU WebGL, adapter WebGPU, các API app dựa vào, worker
// mặt sẵn sàng với delegate nào; (2) cửa sổ chuột trên face.png (cục bộ) hay nền tổng hợp: fps, Hz mặt và phân loại,
// p50/p95, khoảng cách giữa hai kết quả liên tiếp (đo theo rAF trong trang) để chốt tuổi kết quả, số kết quả bị loại
// vì quá tuổi; (3) phân loại ép wasm để so với EP mặc định; (4) tay thật trên hands.jpg (cục bộ) với CPU rồi GPU
// delegate: Hz, p50/p95, khoảng cách kết quả (tuổi điểm), độ rung đầu ngón trên ảnh tĩnh (hysteresis). Không khẳng
// định mục tiêu hiệu năng (đó là việc của bảng trong benchmark.md); chỉ khẳng định đường ống chạy và số đo hợp lệ.
const SECONDS = Number(process.env.BENCH_SECONDS ?? 20)
const FACE_FILE = 'public/spike-assets/face.png'
const FACE_SRC = '/spike-assets/face.png'
/** Như classify.spec: ảnh 958 × 1358 vẽ tỉ lệ 0,5 tại FACE_IMG; mặt khoảng FACE_CAM (px camera). */
const FACE_IMG = { x: 400, y: 20, w: 479, h: 679 }
const FACE_CAM = { x: 560, y: 70, w: 170, h: 210 }
const HANDS_FILE = 'public/spike-assets/hands.jpg'
const HANDS_SRC = '/spike-assets/hands.jpg'
/** Như hands.spec: ảnh 640 × 960 vẽ tỉ lệ 0,75 vào giữa khung 1280 × 720. */
const HANDS_IMG = { x: 400, y: 0, w: 480, h: 720 }

type EnvSnap = {
  ua: string
  browser: { name: string; version: string }
  platform: string
  threads: number
  deviceMemoryGB: number | null
  dpr: number
  secureContext: boolean
  crossOriginIsolated: boolean
  webgl: string | null
  features: Record<string, boolean>
}
type AdapterSnap = { vendor: string; architecture: string; description: string } | null

type Pct = { p50: number; p95: number; max: number; n: number }
type Collected = {
  face: number[]
  hands: number[]
  cls: number[]
  /** Mỗi HandFrame mới: [tay, x cái, y cái, x trỏ, y trỏ] theo px camera của từng tay. */
  tips: (string | number)[][][]
  /** Tuổi (ms, kể từ ts của frame gửi) của từng kết quả mặt và phân loại lúc gate nhận. */
  faceAge: number[]
  clsAge: number[]
  frames: number
}
type Measure = {
  seconds: number
  samples: number
  fpsMedian: number
  fpsMin: number
  faceHzMedian: number
  faceP50Median: number
  faceP95Max: number
  facePendingMax: number
  handHzMedian: number
  handP50Median: number
  /** Trung vị của p95 theo mẫu (trạng thái ổn định) và lớn nhất (kể cả lúc khởi động). */
  handP95Median: number
  handP95Max: number
  clsHzMedian: number
  renderP95Max: number
  tickP95Max: number
  /** Khoảng cách (ms) giữa hai kết quả liên tiếp, đo theo rAF trong trang. */
  faceInterval: Pct
  handInterval: Pct
  clsInterval: Pct
  /** Tuổi kết quả lúc gate nhận (so với faceResultMaxAgeMs, classifier.resultMaxAgeMs). */
  faceAge: Pct
  clsAge: Pct
  /** Độ lệch chuẩn lớn nhất (px camera) của bốn tọa độ đầu ngón cái và trỏ, theo tay, trên ảnh tĩnh. */
  tipJitterPx: number | null
  tipFrames: number
}

type HandRun = Measure & {
  requested: 'CPU' | 'GPU'
  delegate: string | null
  initMs: number
  warmupMs: number
  results: number
  openFraction: number
  /** Rung đầu ngón quy ra ô lưới (σ px camera × scale / c). */
  tipJitterCells: number | null
}

type BenchRun = {
  startedAt: string
  seconds: number
  project: string
  browser: {
    name: string
    version: string
    channel: string | null
    headless: boolean
    playwrightVersion: string
    ua: string
  }
  machine: { os: string; cpu: string; threads: number; memGB: number; node: string; gpu: string }
  env: EnvSnap | null
  adapter: AdapterSnap
  faceWorker: { delegate: string | null; initMs: number; warmupMs: number } | null
  mouse:
    | (Measure & {
        scene: string
        faceAccepted: number
        faceStale: number
        facesSeen: number
        cls: {
          ep: string | null
          initMs: number
          warmupMs: number
          p50: number
          p95: number
          results: number
          accepted: number
          stale: number
        }
      })
    | null
  clsWasm: {
    ep: string | null
    initMs: number
    warmupMs: number
    p50: number
    p95: number
    hz: number
  } | null
  hands: Record<string, HandRun>
  config: {
    pointMaxAgeMs: number
    pointMaxAgeMsCpu: number
    faceResultMaxAgeMs: number
    classifierResultMaxAgeMs: number
    labelMaxAgeMs: number
    hysteresisCells: number
    handsDelegate: string
    /** Delegate app sẽ chọn trên máy này (auto theo renderer WebGL, D-045). */
    handsDelegateResolved: 'GPU' | 'CPU' | null
    faceDelegate: string
    faceTargetHz: number
    classifierTargetHz: number
  }
}

let R: BenchRun

const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(p * (s.length - 1))]
}
const median = (xs: number[]) => pct(xs, 0.5)
const diffs = (ts: number[]) => ts.slice(1).map((t, i) => t - ts[i])
const pctRaw = (d: number[]): Pct => ({
  p50: pct(d, 0.5),
  p95: pct(d, 0.95),
  max: d.length ? Math.max(...d) : 0,
  n: d.length,
})
const pctOf = (ts: number[]): Pct => pctRaw(diffs(ts))
const std = (xs: number[]) => {
  if (xs.length < 2) return 0
  const m = xs.reduce((a, b) => a + b, 0) / xs.length
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1))
}
const vi = (n: number, d = 1) => n.toFixed(d)

async function openSynthetic(page: Page, query = ''): Promise<StageSnap> {
  await installGumCounter(page)
  await seedConsent(page)
  await openApp(page, `?debug=1&source=synthetic${query}`)
  await expect(page.locator('canvas#stage')).toBeVisible()
  return readStage(page)
}

function waitFaceReady(page: Page) {
  return page.waitForFunction(() => window.__wct?.face?.snapshot().ready === true, undefined, {
    timeout: 120_000,
  })
}
function waitClassifierReady(page: Page) {
  return page.waitForFunction(
    () => {
      const s = window.__wct?.classifier?.snapshot()
      return s?.ready === true || s?.failed === true
    },
    undefined,
    { timeout: 120_000 },
  )
}
function readFace(page: Page) {
  return page.evaluate(() => window.__wct!.face!.snapshot())
}
function readCls(page: Page) {
  return page.evaluate(() => window.__wct!.classifier!.snapshot())
}

/** Như stats.spec: chọn nguồn tay rồi đọc layout sau khi các thanh đã hiện (canvas nhỏ lại). */
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

/** Mở cửa sổ 16 ô quanh mặt của face.png (như classify.spec) hoặc 10 ô trên nửa xanh lá. */
async function openWindow(page: Page, st: StageSnap, withFace: boolean) {
  const L = st.layout
  if (withFace) {
    const center = { x: FACE_CAM.x + FACE_CAM.w / 2, y: FACE_CAM.y + FACE_CAM.h / 2 }
    const sx = (st.settings.mirror ? L.cam.w - center.x : center.x) * L.scale + L.board.x
    const sy = center.y * L.scale + L.board.y
    const N = 16
    const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi, v))
    const col = clamp(Math.round((sx - L.board.x) / L.c - N / 2), L.cols - N)
    const row = clamp(Math.round((sy - L.board.y) / L.c - N / 2), L.rows - N)
    await page.evaluate(
      ([c, r, n]) => window.__scenario!.run(`windowAt(${c},${r},${n})`),
      [col, row, N],
    )
  } else {
    await page.evaluate((c) => window.__scenario!.run(`windowAt(${c - 14},8,10)`), L.cols)
  }
  await expect.poll(async () => (await readLoop(page)).reveal.kind).toBe('open')
}

/** Ghi mốc thời gian của từng kết quả mặt, tay, phân loại và đầu ngón của từng HandFrame theo rAF trong trang. */
function collect(page: Page, ms: number): Promise<Collected> {
  return page.evaluate(
    (ms) =>
      new Promise<Collected>((resolve) => {
        const w = window.__wct!
        const out: Collected = {
          face: [],
          hands: [],
          cls: [],
          tips: [],
          faceAge: [],
          clsAge: [],
          frames: 0,
        }
        let faceTask = w.loop!.snapshot().faceGate.lastAccepted?.taskId ?? -1
        let clsTask = w.loop!.snapshot().classifyGate.last?.taskId ?? -1
        let f = w.face!.snapshot().stats.results
        let h = w.hands?.snapshot().client.stats.results ?? 0
        let c = w.classifier?.snapshot().stats.results ?? 0
        let lastFid = -1
        const t0 = performance.now()
        const poll = () => {
          const now = performance.now()
          const fs = w.face!.snapshot().stats.results
          if (fs !== f) {
            out.face.push(now)
            f = fs
          }
          const hs = w.hands?.snapshot()
          if (hs) {
            if (hs.client.stats.results !== h) {
              out.hands.push(now)
              h = hs.client.stats.results
            }
            const lt = hs.latest
            if (lt && lt.frameId !== lastFid) {
              lastFid = lt.frameId
              out.tips.push(
                lt.hands.map((hd) => [
                  hd.handedness,
                  hd.landmarksCam[4].x,
                  hd.landmarksCam[4].y,
                  hd.landmarksCam[8].x,
                  hd.landmarksCam[8].y,
                ]),
              )
            }
          }
          const cs = w.classifier?.snapshot().stats.results ?? 0
          if (cs !== c) {
            out.cls.push(now)
            c = cs
          }
          // Tuổi lúc gate nhận: đọc snapshot vòng lặp mỗi rAF (bench chấp nhận thêm tải nhỏ này).
          const l = w.loop!.snapshot()
          const fa = l.faceGate.lastAccepted
          if (fa && fa.taskId !== faceTask) {
            faceTask = fa.taskId
            out.faceAge.push(fa.ageMs)
          }
          const ca = l.classifyGate.last
          if (ca && ca.taskId !== clsTask) {
            clsTask = ca.taskId
            out.clsAge.push(ca.ageMs)
          }
          out.frames++
          if (now - t0 < ms) requestAnimationFrame(poll)
          else resolve(out)
        }
        poll()
      }),
    ms,
  )
}

/** Đo `seconds` giây: stats mỗi giây và bộ thu theo rAF chạy song song. */
async function measure(page: Page, seconds: number): Promise<Measure> {
  const collected = collect(page, seconds * 1000)
  const samples: StatsSnap[] = []
  for (let i = 0; i < seconds; i++) {
    await page.waitForTimeout(1000)
    samples.push(await readStats(page))
  }
  const col = await collected
  // Rung đầu ngón: σ của từng tọa độ theo tay (chỉ khi cùng số tay ở mọi frame), lấy lớn nhất.
  let jitter: number | null = null
  if (col.tips.length >= 10) {
    const byHand = new Map<string, number[][]>()
    for (const frame of col.tips)
      for (const t of frame) {
        const key = String(t[0])
        const arr = byHand.get(key) ?? [[], [], [], []]
        for (let k = 0; k < 4; k++) arr[k].push(Number(t[k + 1]))
        byHand.set(key, arr)
      }
    const sigmas = [...byHand.values()].flatMap((cs) => cs.map(std))
    jitter = sigmas.length ? Math.max(...sigmas) : null
  }
  return {
    seconds,
    samples: samples.length,
    fpsMedian: median(samples.map((s) => s.fpsOutput)),
    fpsMin: Math.min(...samples.map((s) => s.fpsOutput)),
    faceHzMedian: median(samples.map((s) => s.faceHz)),
    faceP50Median: median(samples.map((s) => s.face.p50)),
    faceP95Max: Math.max(...samples.map((s) => s.face.p95)),
    facePendingMax: Math.max(...samples.map((s) => s.face.pending)),
    handHzMedian: median(samples.map((s) => s.handHz)),
    handP50Median: median(samples.map((s) => s.hand.p50)),
    handP95Median: median(samples.map((s) => s.hand.p95)),
    handP95Max: Math.max(...samples.map((s) => s.hand.p95)),
    clsHzMedian: median(samples.map((s) => s.classifierHz)),
    renderP95Max: Math.max(...samples.map((s) => s.render.p95)),
    tickP95Max: Math.max(...samples.map((s) => s.tick.p95)),
    faceInterval: pctOf(col.face),
    handInterval: pctOf(col.hands),
    clsInterval: pctOf(col.cls),
    faceAge: pctRaw(col.faceAge),
    clsAge: pctRaw(col.clsAge),
    tipJitterPx: jitter,
    tipFrames: col.tips.length,
  }
}

const OUT_DIR = 'reports'

test.beforeAll(async ({ browser }, info) => {
  const use = info.project.use as { channel?: string; headless?: boolean }
  const cpu = os.cpus()
  R = {
    startedAt: new Date().toISOString(),
    seconds: SECONDS,
    project: info.project.name,
    browser: {
      name: browser.browserType().name(),
      version: browser.version(),
      channel: use.channel ?? null,
      headless: use.headless !== false,
      playwrightVersion: info.config.version,
      ua: '',
    },
    machine: {
      os: `${os.type()} ${os.release()} (${os.arch()})`,
      cpu: cpu[0]?.model.trim() ?? '?',
      threads: cpu.length,
      memGB: Math.round(os.totalmem() / 2 ** 30),
      node: process.version,
      gpu: '',
    },
    env: null,
    adapter: null,
    faceWorker: null,
    mouse: null,
    clsWasm: null,
    hands: {},
    config: {
      pointMaxAgeMs: DEFAULTS.freshness.pointMaxAgeMs,
      pointMaxAgeMsCpu: DEFAULTS.freshness.pointMaxAgeMsCpu,
      faceResultMaxAgeMs: DEFAULTS.freshness.faceResultMaxAgeMs,
      classifierResultMaxAgeMs: DEFAULTS.classifier.resultMaxAgeMs,
      labelMaxAgeMs: DEFAULTS.classifier.labelMaxAgeMs,
      hysteresisCells: DEFAULTS.reveal.hysteresisCells,
      handsDelegate: DEFAULTS.hands.delegate,
      handsDelegateResolved: null,
      faceDelegate: DEFAULTS.face.delegate,
      faceTargetHz: DEFAULTS.face.targetHz,
      classifierTargetHz: DEFAULTS.classifier.targetHz,
    },
  }
})

test.afterAll(async () => {
  mkdirSync(OUT_DIR, { recursive: true })
  const out = `${OUT_DIR}/bench-${test.info().project.name}.json`
  writeFileSync(out, JSON.stringify(R, null, 2))
})

test('môi trường: trình duyệt, GPU, API app dựa vào, worker mặt sẵn sàng', async ({ page }) => {
  await openSynthetic(page)
  const env = await page.evaluate(() => window.__wct!.env!.snapshot())
  const adapter = await page.evaluate(() => window.__wct!.env!.gpuAdapter())
  R.env = env
  R.adapter = adapter
  R.browser.ua = env.ua
  R.machine.gpu = shortGpu(env.webgl)
  R.config.handsDelegateResolved = resolveHandDelegate(DEFAULTS.hands.delegate, env.webgl)
  await expect(page.getByTestId('env-stat')).toHaveText(/^môi trường: .+ luồng · WebGL /)
  // Bắt buộc với app (không có fallback): module worker, OffscreenCanvas, ImageBitmap, wasm SIMD.
  expect(env.features.moduleWorker).toBe(true)
  expect(env.features.offscreenCanvas).toBe(true)
  expect(env.features.imageBitmap).toBe(true)
  expect(env.features.wasmSimd).toBe(true)
  expect(env.secureContext).toBe(true)
  await waitFaceReady(page)
  const f = await readFace(page)
  R.faceWorker = { delegate: f.delegate, initMs: f.stats.initMs, warmupMs: f.stats.warmupMs }
  expect(f.failed).toBe(false)
  const missing = missingFeatures(env.features as Parameters<typeof missingFeatures>[0])
  note(
    `${env.browser.name} ${env.browser.version} (${R.browser.headless ? 'headless' : 'có cửa sổ'}), ${env.threads} luồng, WebGL ${shortGpu(env.webgl)},` +
      ` WebGPU adapter ${adapter ? adapter.description || adapter.vendor || 'có' : 'không'}, thiếu API: ${missing.length ? missing.join(', ') : 'không'};` +
      ` delegate tay auto → ${R.config.handsDelegateResolved};` +
      ` worker mặt ${f.delegate} init ${Math.round(f.stats.initMs)} ms, warm-up ${Math.round(f.stats.warmupMs)} ms`,
  )
})

test('cửa sổ chuột: fps, Hz mặt và phân loại, khoảng cách kết quả, kết quả quá tuổi', async ({
  page,
}) => {
  const st = await openSynthetic(page)
  const withFace = existsSync(FACE_FILE)
  if (withFace) {
    await page.evaluate(
      ([src, img]) => window.__scenario!.scene({ person: null, face: { src, ...img } }),
      [FACE_SRC, FACE_IMG] as const,
    )
  }
  await waitFaceReady(page)
  await openWindow(page, st, withFace)
  await waitClassifierReady(page)
  const c0 = await readCls(page)
  expect(c0.failed, c0.lastError ?? '').toBe(false)
  await expect
    .poll(async () => (await readLoop(page)).classifyGate.accepted, { timeout: 30_000 })
    .toBeGreaterThan(0)
  const l0 = await readLoop(page)
  const m = await measure(page, SECONDS)
  const l1 = await readLoop(page)
  const c1 = await readCls(page)
  const facesSeen = withFace
    ? await page.evaluate(() => window.__wct!.loop!.snapshot().output.faces.length)
    : 0
  R.mouse = {
    scene: withFace ? 'face.png' : 'nền tổng hợp',
    ...m,
    faceAccepted: l1.faceGate.accepted - l0.faceGate.accepted,
    faceStale: (l1.faceGate.rejected.stale ?? 0) - (l0.faceGate.rejected.stale ?? 0),
    facesSeen,
    cls: {
      ep: c1.ep,
      initMs: c1.stats.initMs,
      warmupMs: c1.stats.warmupMs,
      p50: c1.stats.p50InferMs,
      p95: c1.stats.p95InferMs,
      results: c1.stats.results - c0.stats.results,
      accepted: l1.classifyGate.accepted - l0.classifyGate.accepted,
      stale: (l1.classifyGate.rejected.stale ?? 0) - (l0.classifyGate.rejected.stale ?? 0),
    },
  }
  expect(m.fpsMedian).toBeGreaterThan(5)
  expect(m.faceInterval.n).toBeGreaterThan(0)
  expect(m.clsInterval.n).toBeGreaterThan(0)
  expect(m.facePendingMax).toBeLessThanOrEqual(1)
  note(
    `${R.mouse.scene}, ${SECONDS} s: output ${vi(m.fpsMedian)} fps; mặt ${vi(m.faceHzMedian)} Hz (p50 ${vi(m.faceP50Median, 0)} / p95 ${vi(m.faceP95Max, 0)} ms,` +
      ` khoảng cách p50 ${vi(m.faceInterval.p50, 0)} / p95 ${vi(m.faceInterval.p95, 0)} / max ${vi(m.faceInterval.max, 0)} ms, tuổi lúc nhận p95 ${vi(m.faceAge.p95, 0)} / max ${vi(m.faceAge.max, 0)} ms, nhận ${R.mouse.faceAccepted}, quá tuổi ${R.mouse.faceStale}` +
      `${withFace ? `, ${facesSeen} mặt` : ''}); phân loại ${c1.ep} (init ${Math.round(c1.stats.initMs)} ms) ${vi(m.clsHzMedian)} Hz` +
      ` (p50 ${vi(c1.stats.p50InferMs)} / p95 ${vi(c1.stats.p95InferMs)} ms, khoảng cách p95 ${vi(m.clsInterval.p95, 0)} ms, tuổi lúc nhận p95 ${vi(m.clsAge.p95, 0)} ms, quá tuổi ${R.mouse.cls.stale});` +
      ` vẽ p95 ${vi(m.renderP95Max, 2)} ms, tick p95 ${vi(m.tickP95Max, 2)} ms`,
  )
})

test('phân loại ép wasm (ep=wasm) để so với EP mặc định', async ({ page }) => {
  const st = await openSynthetic(page, '&ep=wasm')
  await waitFaceReady(page)
  await openWindow(page, st, false)
  await waitClassifierReady(page)
  const c0 = await readCls(page)
  expect(c0.failed, c0.lastError ?? '').toBe(false)
  expect(c0.ep).toBe('wasm')
  await expect
    .poll(async () => (await readCls(page)).stats.results, { timeout: 30_000 })
    .toBeGreaterThan(0)
  const secs = Math.min(SECONDS, 10)
  const m = await measure(page, secs)
  const c1 = await readCls(page)
  R.clsWasm = {
    ep: c1.ep,
    initMs: c1.stats.initMs,
    warmupMs: c1.stats.warmupMs,
    p50: c1.stats.p50InferMs,
    p95: c1.stats.p95InferMs,
    hz: m.clsHzMedian,
  }
  note(
    `wasm: init ${Math.round(c1.stats.initMs)} ms, warm-up ${Math.round(c1.stats.warmupMs)} ms, infer p50 ${vi(c1.stats.p50InferMs)} / p95 ${vi(c1.stats.p95InferMs)} ms, ${vi(m.clsHzMedian)} Hz` +
      (R.mouse
        ? `; EP mặc định ${R.mouse.cls.ep}: init ${Math.round(R.mouse.cls.initMs)} ms, p50 ${vi(R.mouse.cls.p50)} ms`
        : ''),
  )
})

test('tay thật trên hands.jpg (cục bộ): CPU rồi GPU delegate, khoảng cách kết quả và rung đầu ngón', async ({
  page,
}) => {
  test.skip(!existsSync(HANDS_FILE), `thiếu ${HANDS_FILE} (asset spike cục bộ, không commit)`)
  test.setTimeout(2 * (240_000 + SECONDS * 1000))
  for (const d of ['CPU', 'GPU'] as const) {
    await openSynthetic(page, `&hands=${d}`)
    await page.evaluate(
      ([src, img]) => window.__scenario!.scene({ person: null, face: { src, ...img } }),
      [HANDS_SRC, HANDS_IMG] as const,
    )
    const st = await selectHands(page)
    await page.waitForFunction(
      () => {
        const c = window.__wct?.hands?.snapshot().client
        return c?.ready === true || c?.failed === true
      },
      undefined,
      { timeout: 120_000 },
    )
    const h0 = await readHands(page)
    expect(h0.client.failed, h0.client.lastError ?? '').toBe(false)
    await page.getByLabel('Tuổi điểm').fill('1000')
    await waitFaceReady(page)
    // Cửa sổ theo tay mở khi đủ bốn đầu ngón; không bắt buộc (ảnh tĩnh có thể thiếu slot), ghi tỉ lệ mở.
    await expect
      .poll(async () => (await readHands(page)).client.stats.results, { timeout: 30_000 })
      .toBeGreaterThan(2)
    const l0 = await readLoop(page)
    const openSamples: boolean[] = []
    const probe = (async () => {
      for (let i = 0; i < SECONDS; i++) {
        await page.waitForTimeout(1000)
        openSamples.push((await readLoop(page)).reveal.kind === 'open')
      }
    })()
    const m = await measure(page, SECONDS)
    await probe
    const h1 = await readHands(page)
    const L = st.layout
    const run: HandRun = {
      ...m,
      requested: d,
      delegate: h1.client.delegate,
      initMs: h1.client.stats.initMs,
      warmupMs: h1.client.stats.warmupMs,
      results: h1.client.stats.results - h0.client.stats.results,
      openFraction: openSamples.length
        ? openSamples.filter(Boolean).length / openSamples.length
        : 0,
      tipJitterCells: m.tipJitterPx === null ? null : (m.tipJitterPx * L.scale) / L.c,
    }
    R.hands[d] = run
    expect(run.results).toBeGreaterThan(0)
    expect(m.handInterval.n).toBeGreaterThan(0)
    expect(l0.epoch).toBeGreaterThanOrEqual(0)
    note(
      `${d} (thực tế ${run.delegate}, init ${Math.round(run.initMs)} ms): tay ${vi(m.handHzMedian)} Hz (p50 ${vi(m.handP50Median, 0)} / p95 ${vi(m.handP95Median, 0)} ổn định, ${vi(m.handP95Max, 0)} tối đa ms,` +
        ` khoảng cách p50 ${vi(m.handInterval.p50, 0)} / p95 ${vi(m.handInterval.p95, 0)} / max ${vi(m.handInterval.max, 0)} ms), output ${vi(m.fpsMedian)} fps,` +
        ` mặt ${vi(m.faceHzMedian)} Hz, vùng mở ${vi(run.openFraction * 100, 0)} %, rung đầu ngón σ ${m.tipJitterPx === null ? '?' : vi(m.tipJitterPx, 2)} px` +
        ` (${run.tipJitterCells === null ? '?' : vi(run.tipJitterCells, 3)} ô, ${m.tipFrames} frame)`,
    )
  }
})
