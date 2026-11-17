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
// mặt chạy cục bộ với public/spike-assets/face.png. CLS-05 (D-070, mục 7.42): mặc định classifier nhìn crop quanh mặt;
// ca đầu (nguồn tổng hợp không có mặt) ghim `clsCrop=region` để giữ kiểm đường của CLS-02. CLS-06 (D-071, mục 7.43):
// chớp mắt giả lập (kịch bản blink) trên face.png cho nhãn "Người · chớp mắt".
const FACE_FILE = 'public/spike-assets/face.png'
const FACE_SRC = '/spike-assets/face.png'

async function openSynthetic(page: Page, extra = '') {
  await installGumCounter(page)
  await seedConsent(page)
  await openApp(page, `?debug=1&source=synthetic${extra}`)
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

test('worker phân loại: sẵn sàng (wasm, D-062), đóng thì không gửi; mở trên nửa xanh lá → person, dời sang magenta → mannequin, nhịp ≤ 5 Hz; cửa sổ nhỏ hơn 96 px không gửi; đóng xóa nhãn', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const st = await openSynthetic(page, '&clsCrop=region')
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
  expect(cReady.ep).toBe('wasm')
  await expect(page.getByTestId('classifier-stat')).toHaveText(/phân loại: sẵn sàng \(wasm/)
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

// Như faceGate.spec: ảnh 958 × 1358 vẽ tỉ lệ 0,5 tại IMG trên nền magenta; mặt khoảng FACE_CAM (px camera).
const IMG = { x: 400, y: 20, w: 479, h: 679 }
const FACE_CAM = { x: 560, y: 70, w: 170, h: 210 }

/** Cảnh face.png và cửa sổ chuột N ô quanh mặt; chờ worker mặt và classifier sẵn sàng. */
async function openFaceWindow(page: Page, N = 16, extra = '') {
  const st = await openSynthetic(page, extra)
  await page.evaluate(
    ([src, img]) => window.__scenario!.scene({ person: null, face: { src, ...img } }),
    [FACE_SRC, IMG] as const,
  )
  await waitFaceReady(page)
  const L = st.layout
  const center = { x: FACE_CAM.x + FACE_CAM.w / 2, y: FACE_CAM.y + FACE_CAM.h / 2 }
  const sx = (st.settings.mirror ? L.cam.w - center.x : center.x) * L.scale + L.board.x
  const sy = center.y * L.scale + L.board.y
  const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi, v))
  const col = clamp(Math.round((sx - L.board.x) / L.c - N / 2), L.cols - N)
  const row = clamp(Math.round((sy - L.board.y) / L.c - N / 2), L.rows - N)
  await page.evaluate(
    ([c, r, n]) => window.__scenario!.run(`windowAt(${c},${r},${n})`),
    [col, row, N],
  )
  await waitClassifierReady(page)
}

type Box = { x: number; y: number; w: number; h: number }

/**
 * Đọc ngay trong trang theo rAF tới khi cùng một snapshot có mặt và nhãn của ít nhất `minAccepted` kết quả: mặt chỉ được
 * giữ 1 s sau mỗi kết quả nên hai vòng poll từ Node có thể lệch nhau dưới tải của cả bộ e2e.
 */
function readFaceWithLabel(page: Page, minAccepted: number) {
  return page.evaluate(
    (min) =>
      new Promise<{
        epoch: number
        mask: Box
        subject: {
          epoch: number
          probs: number[]
          raw: number[]
          count: number
          roiCam: Box
          crop: string
        }
        face: {
          status: string
          subjectType: string
          confidence?: number
          visible: number
          bboxCam: Box
          eyesClosed?: number
          live?: boolean
        }
        subBuilds: number
      }>((resolve, reject) => {
        const t0 = performance.now()
        const poll = () => {
          const s = window.__wct!.loop!.snapshot()
          const face = s.output.faces[0]
          if (face && s.subject && s.mask && s.classifyGate.accepted >= min)
            return resolve({
              epoch: s.epoch,
              mask: s.mask.cameraRect,
              subject: s.subject,
              face,
              subBuilds: s.restricted?.subBuilds ?? 0,
            })
          if (performance.now() - t0 > 90_000)
            return reject(new Error('hết 90 s chờ mặt có nhãn trong cùng snapshot'))
          requestAnimationFrame(poll)
        }
        poll()
      }),
    minAccepted,
  )
}

test('nhãn gắn vào mặt đã validate (face.png cục bộ): crop quanh mặt trong cameraRect, cùng epoch, subjectType theo quy tắc, xóa khi đóng', async ({
  page,
}) => {
  test.skip(!existsSync(FACE_FILE), `thiếu ${FACE_FILE} (asset spike cục bộ, không commit)`)
  test.setTimeout(180_000)
  await openFaceWindow(page)
  const l = await readFaceWithLabel(page, 2)
  expect(['person', 'mannequin', 'unknown']).toContain(l.face.subjectType)
  expect(l.subject.epoch).toBe(l.epoch)
  // CLS-05 (D-070): classifier nhìn crop vuông quanh mặt, nằm trọn trong cameraRect của mask, chứa tâm mặt; buffer
  // của nó là crop con của builder.
  const c = l.subject.roiCam
  expect(l.subject.crop).toBe('face')
  expect(l.subBuilds).toBeGreaterThan(0)
  expect(c.x).toBeGreaterThanOrEqual(l.mask.x)
  expect(c.y).toBeGreaterThanOrEqual(l.mask.y)
  expect(c.x + c.w).toBeLessThanOrEqual(l.mask.x + l.mask.w)
  expect(c.y + c.h).toBeLessThanOrEqual(l.mask.y + l.mask.h)
  const b = l.face.bboxCam
  const cx = b.x + b.w / 2
  const cy = b.y + b.h / 2
  expect(cx).toBeGreaterThanOrEqual(c.x)
  expect(cx).toBeLessThanOrEqual(c.x + c.w)
  expect(cy).toBeGreaterThanOrEqual(c.y)
  expect(cy).toBeLessThanOrEqual(c.y + c.h)
  expect(c.w * c.h).toBeLessThan(l.mask.w * l.mask.h)
  // Stub: nhãn theo màu trung bình của crop; độ tin cậy = max của xác suất đã làm mượt khi có nhãn (CLS-05, D-069).
  expect(l.subject.count).toBeGreaterThanOrEqual(1)
  const maxProb = Math.max(...l.subject.probs)
  if (l.face.subjectType !== 'unknown') expect(l.face.confidence).toBeCloseTo(maxProb, 6)
  // CLS-06: ảnh tĩnh có điểm nhắm mắt (blendshapes) và không bao giờ là tín hiệu sống.
  expect(l.face.eyesClosed).toBeDefined()
  expect(l.face.live).toBeUndefined()
  await page.evaluate(() => window.__scenario!.run('coverAll'))
  await expect.poll(async () => (await readLoop(page)).output.faces.length).toBe(0)
  expect((await readLoop(page)).subject).toBeNull()
  note(
    `mặt ${l.face.status} (nhìn thấy ${(l.face.visible * 100).toFixed(0)} %), subjectType ${l.face.subjectType}, độ tin cậy ${(l.face.confidence ?? 0).toFixed(3)}, probs ${l.subject.probs.map((p) => p.toFixed(3)).join('/')} (gộp ${l.subject.count}), crop mặt ${c.w}×${c.h} tại (${c.x}, ${c.y}) trong vùng ${l.mask.w}×${l.mask.h}, điểm nhắm mắt ${(l.face.eyesClosed ?? -1).toFixed(3)}`,
  )
  await expectGateClean(page)
})

test('CLS-05: chế độ crop mặt không phân loại khi vùng mở không có mặt (nguồn tổng hợp), dù cửa sổ đủ lớn', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const st = await openSynthetic(page)
  await waitFaceReady(page)
  await page.evaluate((c) => window.__scenario!.run(`windowAt(${c - 14},8,10)`), st.layout.cols)
  await expect.poll(async () => (await readLoop(page)).reveal.kind).toBe('open')
  await waitClassifierReady(page)
  await page.waitForTimeout(2000)
  const l = await readLoop(page)
  const c = await readCls(page)
  expect(l.output.faces).toHaveLength(0)
  expect(c.stats.submitted).toBe(0)
  expect(l.subject).toBeNull()
  expect(l.restricted!.subBuilds).toBe(0)
  note(
    `vùng ${l.mask!.cameraRect.w}×${l.mask!.cameraRect.h} không mặt: gửi classifier ${c.stats.submitted}`,
  )
  await expectGateClean(page)
})

test('CLS-06: chớp mắt (kịch bản blink trên face.png) cho nhãn "Người · chớp mắt" bất kể classifier; đóng vùng xóa tín hiệu sống', async ({
  page,
}) => {
  test.skip(!existsSync(FACE_FILE), `thiếu ${FACE_FILE} (asset spike cục bộ, không commit)`)
  test.setTimeout(180_000)
  await openFaceWindow(page)
  const before = await readFaceWithLabel(page, 2)
  // Ảnh tĩnh mắt mở: dưới ngưỡng mở 0,3 nên bộ phát hiện ở trạng thái open, chưa chớp.
  expect(before.face.eyesClosed!).toBeLessThanOrEqual(0.3)
  await expect.poll(async () => (await readLoop(page)).liveness.state).toBe('open')
  const l0 = await readLoop(page)
  expect(l0.liveness).toMatchObject({ enabled: true, live: false, blinks: 0 })
  // Giả lập một lần chớp (frame trong 300 ms tới có điểm nhắm 1), rồi mắt mở lại theo ảnh thật.
  await page.evaluate(() => window.__scenario!.run('blink(300)'))
  await expect
    .poll(async () => (await readLoop(page)).liveness.blinks, { timeout: 20_000 })
    .toBeGreaterThanOrEqual(1)
  await expect
    .poll(async () => (await readLoop(page)).output.faces[0]?.live ?? false, { timeout: 10_000 })
    .toBe(true)
  const l1 = await readLoop(page)
  expect(l1.liveness.live).toBe(true)
  expect(l1.output.faces[0].subjectType).toBe('person')
  await expect(page.getByTestId('guide')).toContainText('chớp mắt')
  // Đóng vùng: epoch mới, không mang tín hiệu sống của lần mở trước sang lần mở sau (mục 5.10).
  await page.evaluate(() => window.__scenario!.run('coverAll'))
  await expect.poll(async () => (await readLoop(page)).reveal.kind).toBe('closed')
  const closed = await readLoop(page)
  expect(closed.liveness).toMatchObject({ live: false, blinks: 0, samples: 0 })
  note(
    `trước chớp: ${before.face.subjectType} (điểm nhắm mắt ${before.face.eyesClosed!.toFixed(3)}, probs ${before.subject.probs.map((p) => p.toFixed(3)).join('/')}); sau chớp: ${l1.output.faces[0].subjectType} live, ${l1.liveness.blinks} lần chớp`,
  )
  await expectGateClean(page)
})
