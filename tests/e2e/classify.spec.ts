import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import {
  expectGateClean,
  installGateAudit,
  installGumCounter,
  note,
  openApp,
  readLoop,
  readStage,
  seedConsent,
  type ClassifierSnap,
} from './helpers'

// CLS-02 (mục 7.23, I1, mục 5.11): worker phân loại (ONNX Runtime Web, model stub D-044) trên nguồn tổng hợp: chỉ nhận
// buffer giới hạn khi vùng mở và cạnh ROI ≥ 96 px, nhịp 3 đến 5 Hz; xanh lá → person, magenta → mannequin, đóng vùng
// thì nhãn xóa và không gửi thêm; nhãn không đổi khi cảnh chuyển động (không dùng chuyển động). Phần gắn nhãn vào
// mặt chạy cục bộ với public/spike-assets/face.png.
const FACE_FILE = 'public/spike-assets/face.png'
const FACE_SRC = '/spike-assets/face.png'

async function openSynthetic(page: Page) {
  await installGumCounter(page)
  await seedConsent(page)
  await openApp(page, '?debug=1&source=synthetic')
  await expect(page.locator('canvas#stage')).toBeVisible()
  const st = await readStage(page)
  await installGateAudit(page)
  return st
}

const readCls = (page: Page): Promise<ClassifierSnap> =>
  page.evaluate(() => window.__wct!.classifier!.snapshot())
const readCounters = (page: Page) => page.evaluate(() => ({ ...window.__wct!.probes!.counters }))

function waitFaceReady(page: Page): Promise<unknown> {
  return page.waitForFunction(() => window.__wct?.face?.snapshot().ready === true, undefined, {
    timeout: 120_000,
  })
}

/** Worker phân loại khởi tạo lười khi vùng mở lần đầu: chờ sau khi mở cửa sổ. */
function waitClassifierReady(page: Page): Promise<unknown> {
  return page.waitForFunction(
    () => window.__wct?.classifier?.snapshot().ready === true,
    undefined,
    { timeout: 120_000 },
  )
}

/** Đọc client và bộ đếm probe trong cùng một lượt để so sánh không lệch một tác vụ. */
const readClsAndCounters = (page: Page) =>
  page.evaluate(() => ({
    cls: window.__wct!.classifier!.snapshot(),
    counters: { ...window.__wct!.probes!.counters },
  }))

test('worker phân loại: sẵn sàng (webgpu hoặc wasm), đóng thì không gửi; mở trên nửa xanh lá → person, dời sang magenta → mannequin, nhịp ≤ 5 Hz; cửa sổ nhỏ hơn 96 px không gửi; đóng xóa nhãn', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const st = await openSynthetic(page)
  await waitFaceReady(page)
  // Chưa mở vùng: worker phân loại chưa khởi tạo (lười), không gửi gì.
  const c0 = await readCls(page)
  expect(c0.started).toBe(false)
  expect(c0.modelPath).toBe('/models/classifier-stub.onnx')
  expect(c0.accepting).toBe(false)
  await expect(page.getByTestId('classifier-stat')).toHaveText(/phân loại: chưa chạy/)
  await page.waitForTimeout(800)
  expect((await readCls(page)).stats.submitted).toBe(0)
  expect((await readCounters(page)).classifierSubmitted).toBe(0)

  // Mở cửa sổ 10 ô ở nửa phải bảng (mirror: nửa trái camera, xanh lá): cạnh ROI ≥ 96 px.
  const { cols } = st.layout
  await page.evaluate((c) => window.__scenario!.run(`windowAt(${c - 14},8,10)`), cols)
  await expect.poll(async () => (await readLoop(page)).reveal.kind).toBe('open')
  await waitClassifierReady(page)
  const cReady = await readCls(page)
  expect(['wasm', 'webgpu']).toContain(cReady.ep)
  await expect(page.getByTestId('classifier-stat')).toHaveText(
    /phân loại: sẵn sàng \((wasm|webgpu)/,
  )
  const roi = (await readLoop(page)).mask!.cameraRect
  expect(Math.min(roi.w, roi.h)).toBeGreaterThanOrEqual(96)
  await expect
    .poll(async () => (await readLoop(page)).classifyGate.accepted, { timeout: 20_000 })
    .toBeGreaterThanOrEqual(3)
  const l1 = await readLoop(page)
  expect(l1.subject).not.toBeNull()
  expect(l1.subject!.probs[0]).toBeGreaterThan(0.99)
  expect(l1.subject!.epoch).toBe(l1.epoch)
  expect(l1.subject!.roiShortPx).toBe(Math.min(roi.w, roi.h))
  expect(l1.classifyGate.rejected.epoch).toBe(0)
  expect(l1.classifyGate.rejected['no-mask']).toBe(0)
  const { cls: c1, counters: p1 } = await readClsAndCounters(page)
  expect(c1.accepting).toBe(true)
  expect(c1.stats.submitted).toBeGreaterThanOrEqual(3)
  expect(c1.stats.errors).toBe(0)
  expect(c1.stats.p50InferMs).toBeGreaterThan(0)
  expect(c1.minIntervalMs).toBeGreaterThanOrEqual(250)
  // I1 qua probe: mọi buffer gửi cho classifier đều là buffer giới hạn do builder tạo (đếm ở cùng chỗ với mặt).
  expect(p1.classifierSubmitted).toBe(c1.stats.submitted)
  await expect(page.getByTestId('classifier-stat')).toHaveText(/probs (1\.00|0\.99)\/(0\.0[01])/)

  // Nhịp: sau 2 s kết quả không quá 5 Hz (+1 dung sai).
  const r0 = (await readCls(page)).stats.results
  await page.waitForTimeout(2000)
  const r1 = (await readCls(page)).stats.results
  expect(r1 - r0).toBeLessThanOrEqual(11)
  expect(r1 - r0).toBeGreaterThanOrEqual(2)

  // Chuyển động trong cửa sổ: nền xanh lá, một khối magenta 30 px chạy 30 px/s ngang qua vùng mở: nhãn vẫn person vì
  // model chỉ nhìn một ảnh (màu trung bình) và không có đầu vào chuyển động (mục 5.11).
  await page.evaluate(() =>
    window.__scenario!.scene({
      background: '#00ff00',
      person: { x: 100, y: 250, w: 30, h: 30, color: '#ff00ff', vx: 30, vy: 0 },
    }),
  )
  const a0 = (await readLoop(page)).classifyGate.accepted
  await expect
    .poll(async () => (await readLoop(page)).classifyGate.accepted, { timeout: 10_000 })
    .toBeGreaterThanOrEqual(a0 + 4)
  expect((await readLoop(page)).subject!.probs[0]).toBeGreaterThan(0.9)
  await page.evaluate(() =>
    window.__scenario!.scene({
      background: '#ff00ff',
      person: { x: 0, y: 0, w: 640, h: 720, color: '#00ff00', vx: 0, vy: 0 },
    }),
  )

  // Dời sang nửa trái bảng (magenta): epoch giữ nguyên (dời chuột), nhãn chuyển sang mannequin.
  await page.evaluate(() => window.__scenario!.run('moveWindow(2,8)'))
  await expect
    .poll(async () => (await readLoop(page)).subject?.probs[1] ?? 0, { timeout: 10_000 })
    .toBeGreaterThan(0.99)
  const l2 = await readLoop(page)
  expect(l2.epoch).toBe(l1.epoch)

  // Cửa sổ 3 ô: cạnh ROI dưới 96 px → không gửi thêm cho classifier (mặt vẫn nhận nếu ≥ 64 px).
  await page.evaluate(() => window.__scenario!.run('resizeWindow(3)'))
  await expect.poll(async () => (await readLoop(page)).mask?.shape.window.n).toBe(3)
  const small = (await readLoop(page)).mask!.cameraRect
  expect(Math.min(small.w, small.h)).toBeLessThan(96)
  await expect.poll(async () => (await readCls(page)).busy).toBe(false)
  const s0 = (await readCls(page)).stats.submitted
  await page.waitForTimeout(1200)
  expect((await readCls(page)).stats.submitted).toBe(s0)
  // Nhãn cũ hết hạn sau labelMaxAgeMs (1,5 s) vì không có kết quả mới.
  await expect.poll(async () => (await readLoop(page)).subject, { timeout: 5000 }).toBeNull()

  // Đóng vùng: accepting tắt, nhãn xóa, không gửi thêm; kết quả về muộn (nếu có) bị loại theo epoch.
  await page.evaluate(() => window.__scenario!.run('resizeWindow(10)'))
  await expect
    .poll(async () => (await readLoop(page)).classifyGate.accepted, { timeout: 10_000 })
    .toBeGreaterThan(l2.classifyGate.accepted)
  await page.evaluate(() => window.__scenario!.run('coverAll'))
  await expect.poll(async () => (await readLoop(page)).reveal.kind).toBe('closed')
  const closed = await readLoop(page)
  expect(closed.subject).toBeNull()
  expect((await readCls(page)).accepting).toBe(false)
  await expect.poll(async () => (await readCls(page)).busy).toBe(false)
  const s1 = (await readCls(page)).stats.submitted
  await page.waitForTimeout(1000)
  const cEnd = await readCls(page)
  expect(cEnd.stats.submitted).toBe(s1)
  const lEnd = await readLoop(page)
  expect(lEnd.classifyGate.accepted).toBe(closed.classifyGate.accepted)
  note(
    `EP ${cEnd.ep}, init ${cEnd.stats.initMs.toFixed(0)} ms, warm-up ${cEnd.stats.warmupMs.toFixed(0)} ms, infer p50 ${cEnd.stats.p50InferMs.toFixed(1)} / p95 ${cEnd.stats.p95InferMs.toFixed(1)} ms, nhịp ${cEnd.minIntervalMs.toFixed(0)} ms; ${r1 - r0} kết quả trong 2 s; gửi ${cEnd.stats.submitted}, loại ${cEnd.stats.discarded}, gate nhận ${lEnd.classifyGate.accepted}, loại ${JSON.stringify(lEnd.classifyGate.rejected)}`,
  )
  await expectGateClean(page)
})

test('nhãn gắn vào mặt đã validate (face.png cục bộ): cùng epoch, subjectType theo quy tắc, xóa khi đóng', async ({
  page,
}) => {
  test.skip(!existsSync(FACE_FILE), `thiếu ${FACE_FILE} (asset spike cục bộ, không commit)`)
  test.setTimeout(180_000)
  const st = await openSynthetic(page)
  // Như faceGate.spec: ảnh 958 × 1358 vẽ tỉ lệ 0,5 tại IMG trên nền magenta; mặt khoảng FACE_CAM (px camera).
  const IMG = { x: 400, y: 20, w: 479, h: 679 }
  const FACE_CAM = { x: 560, y: 70, w: 170, h: 210 }
  await page.evaluate(
    ([src, img]) => window.__scenario!.scene({ person: null, face: { src, ...img } }),
    [FACE_SRC, IMG] as const,
  )
  await waitFaceReady(page)
  const L = st.layout
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
  await waitClassifierReady(page)
  // Đọc ngay trong trang theo rAF tới khi cùng một snapshot có mặt và nhãn: mặt chỉ được giữ 1 s sau mỗi kết quả nên
  // hai vòng poll từ Node có thể lệch nhau dưới tải của cả bộ e2e.
  const l = await page.evaluate(
    () =>
      new Promise<{
        epoch: number
        subject: { epoch: number; probs: number[] } | null
        face: { status: string; subjectType: string; confidence?: number; visible: number } | null
      }>((resolve, reject) => {
        const t0 = performance.now()
        const poll = () => {
          const s = window.__wct!.loop!.snapshot()
          const face = s.output.faces[0]
          if (face && s.subject && s.classifyGate.accepted >= 2)
            return resolve({ epoch: s.epoch, subject: s.subject, face })
          if (performance.now() - t0 > 90_000)
            return reject(new Error('hết 90 s chờ mặt có nhãn trong cùng snapshot'))
          requestAnimationFrame(poll)
        }
        poll()
      }),
  )
  expect(l.face).not.toBeNull()
  expect(['person', 'mannequin', 'unknown']).toContain(l.face!.subjectType)
  expect(l.subject?.epoch).toBe(l.epoch)
  // Stub: nhãn theo màu trung bình của crop; độ tin cậy = max(prob) của kết quả gần nhất khi có nhãn.
  const maxProb = Math.max(...l.subject!.probs)
  if (l.face!.subjectType !== 'unknown') expect(l.face!.confidence).toBeCloseTo(maxProb, 6)
  await page.evaluate(() => window.__scenario!.run('coverAll'))
  await expect.poll(async () => (await readLoop(page)).output.faces.length).toBe(0)
  expect((await readLoop(page)).subject).toBeNull()
  note(
    `mặt ${l.face!.status} (nhìn thấy ${(l.face!.visible * 100).toFixed(0)} %), subjectType ${l.face!.subjectType}, độ tin cậy ${(l.face!.confidence ?? 0).toFixed(3)}, probs ${l.subject!.probs.map((p) => p.toFixed(3)).join('/')}`,
  )
  await expectGateClean(page)
})
