import { expect, test, type Page } from '@playwright/test'
import {
  camAtCell,
  expectGateClean,
  installGateAudit,
  installGumCounter,
  note,
  openApp,
  readLoop,
  readStage,
  seedConsent,
  setFakeHands,
  type RfAnalysis,
} from './helpers'

// MASK-02 (mục 7.10, gate cứng 7.2): đo tại probe onRestrictedFrame, không đo trên màn hình. Cảnh: nền magenta
// (255,0,255) ngoài cửa sổ, vùng "người" xanh dương (0,0,255) đặt đúng cameraRect của mask, đệm letterbox xám 128.
// Mọi pixel hợp lệ của buffer có r == g (xanh dương, xám và mọi mức pha giữa hai màu đó); pixel có r != g là dấu vết
// magenta, tức pixel ngoài cameraRect lọt vào. Đối chứng: thu vùng người vào 1 px thì viền magenta nằm trong
// cameraRect phải xuất hiện (bad > 0), chứng tỏ phép đo thấy được sai lệch 1 px.
const BLUE = '#0000ff'
const MAGENTA = '#ff00ff'
const SIZE = 256

type Rect = { x: number; y: number; w: number; h: number }

async function openSynthetic(page: Page) {
  await installGumCounter(page)
  await seedConsent(page)
  await openApp(page, '?debug=1&source=synthetic')
  await expect(page.locator('canvas#stage')).toBeVisible()
  const st = await readStage(page)
  await page.evaluate(() => {
    window.__rfCount = 0
    const p = window.__wct!.probes!
    p.minIntervalMs.restricted = 40
    p.onRestrictedFrame((img, meta) => {
      const d = img.data
      let bad = 0
      let blue = 0
      let gray = 0
      let hash = 0x811c9dc5
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i]
        const g = d[i + 1]
        const b = d[i + 2]
        if (r !== g) bad++
        if (r === 0 && g === 0 && b === 255) blue++
        if (r === 128 && g === 128 && b === 128) gray++
        hash = Math.imul(hash ^ r, 16777619)
        hash = Math.imul(hash ^ g, 16777619)
        hash = Math.imul(hash ^ b, 16777619)
      }
      window.__rf = { w: img.width, h: img.height, bad, blue, gray, hash: hash >>> 0, meta }
      window.__rfCount = (window.__rfCount ?? 0) + 1
    })
  })
  // QA-01: cách đo thứ hai chạy song song: so từng buffer với ảnh tham chiếu dựng từ định nghĩa cảnh.
  await installGateAudit(page)
  return st
}

function run(page: Page, command: string): Promise<unknown> {
  return page.evaluate((cmd) => window.__scenario!.run(cmd), command)
}

/** Đợi thêm n buffer qua probe (nguồn tổng hợp vẽ 30 fps nên cảnh mới có hiệu lực ở frame kế; n = 3 là đủ trễ). */
async function nextAnalysis(page: Page, n = 3): Promise<RfAnalysis> {
  const c0 = await page.evaluate(() => window.__rfCount ?? 0)
  await page.waitForFunction((t) => (window.__rfCount ?? 0) >= t, c0 + n)
  return page.evaluate(() => window.__rf!)
}

async function openWindowAt(page: Page, col: number, row: number, n: number): Promise<Rect> {
  await run(page, `windowAt(${col},${row},${n})`)
  await expect.poll(async () => (await readLoop(page)).mask?.shape.window).toEqual({ col, row, n })
  return (await readLoop(page)).mask!.cameraRect
}

/** Vùng "người" phủ đúng rect (inset > 0 thì thu vào mỗi phía), nền một màu khác. */
function fillRect(page: Page, r: Rect, inset = 0, background = MAGENTA, color = BLUE) {
  return page.evaluate(
    ([r, inset, background, color]) =>
      window.__scenario!.scene({
        background,
        person: {
          x: r.x + inset,
          y: r.y + inset,
          w: r.w - 2 * inset,
          h: r.h - 2 * inset,
          color,
          vx: 0,
          vy: 0,
        },
      }),
    [r, inset, background, color] as const,
  )
}

/** Cạnh ô nhỏ nhất để cameraRect có cạnh ≥ 64 px (thêm 2 px dự phòng làm tròn). */
function smallestN(layout: { c: number; scale: number }): number {
  return Math.max(3, Math.ceil((66 * layout.scale) / layout.c))
}

test('gate cứng: buffer 256 × 256 không có pixel ngoài cameraRect ở nhiều vị trí và cỡ cửa sổ, kể cả sát mép và nhỏ nhất; đối chứng 1 px', async ({
  page,
}) => {
  const st = await openSynthetic(page)
  const { cols, rows } = st.layout
  const nMin = smallestN(st.layout)
  const cases: [number, number, number][] = [
    [0, 0, nMin],
    [cols - nMin, rows - nMin, nMin],
    [10, 5, 12],
    [20, 2, Math.min(20, rows - 2)],
  ]
  for (const [col, row, n] of cases) {
    const r = await openWindowAt(page, col, row, n)
    expect(Math.min(r.w, r.h)).toBeGreaterThanOrEqual(64)
    await fillRect(page, r)
    const a = await nextAnalysis(page)
    expect([a.w, a.h]).toEqual([SIZE, SIZE])
    expect(a.meta.roiCam).toEqual(r)
    expect(a.bad).toBe(0)
    // Diện tích xanh dương đúng cỡ crop sau letterbox; phần còn lại là đệm xám.
    const sc = SIZE / Math.max(r.w, r.h)
    const dw = r.w * sc
    const dh = r.h * sc
    expect(a.blue).toBeGreaterThanOrEqual(Math.floor(dw - 2) * Math.floor(dh - 2))
    expect(a.blue).toBeLessThanOrEqual(Math.ceil(dw + 1) * Math.ceil(dh + 1))
    expect(a.gray + a.blue).toBeGreaterThanOrEqual(
      SIZE * SIZE - 4 * (Math.ceil(dw) + Math.ceil(dh)),
    )
    // Đối chứng: viền magenta 1 px nằm trong cameraRect phải lọt vào buffer.
    await fillRect(page, r, 1)
    const b = await nextAnalysis(page)
    expect(b.bad).toBeGreaterThan(0)
    note(
      `(${col}, ${row}) n=${n}: cameraRect ${r.w}×${r.h}, pixel ngoài ROI ${a.bad}/${a.w * a.h}, xanh ${a.blue},` +
        ` xám ${a.gray}; đối chứng viền 1 px lọt ${b.bad} pixel`,
    )
  }

  // Tắt mirror: cameraRect đổi phía trong camera, buffer vẫn sạch và roiCam vẫn đúng.
  await page.getByLabel('Mirror').uncheck()
  await expect.poll(async () => (await readStage(page)).settings.mirror).toBe(false)
  const r = await openWindowAt(page, 2, 2, 8)
  await fillRect(page, r)
  const a = await nextAnalysis(page)
  expect(a.bad).toBe(0)
  expect(a.meta.roiCam).toEqual(r)
  expect((await readLoop(page)).restricted!.builds).toBeGreaterThan(0)
  const counters = await page.evaluate(() => window.__wct!.probes!.counters)
  expect(counters.restrictedFrames).toBeGreaterThan(0)
  // Worker phân loại khởi tạo lười khi vùng mở lần đầu; cửa sổ ở đây đều ≥ 96 px nên nó có thể đã nhận bitmap (tùy
  // máy nhanh hay chậm: CI runner có, máy phát triển thường chưa kịp). Số đó chỉ ghi nhận; gate cứng của mọi buffer,
  // kể cả bản cho classifier, do expectGateClean khẳng định.
  note(
    `mirror tắt (2, 2) n=8: pixel ngoài ROI ${a.bad}; ${counters.restrictedFrames} buffer qua probe, ` +
      `${counters.classifierSubmitted} bitmap tới worker phân loại`,
  )
  await expectGateClean(page)
})

test('chỉ đổi nội dung ngoài cửa sổ: hash buffer không đổi; đổi nội dung trong cửa sổ: hash đổi', async ({
  page,
}) => {
  await openSynthetic(page)
  const r = await openWindowAt(page, 8, 6, 10)
  await fillRect(page, r)
  const a = await nextAnalysis(page)
  expect(a.bad).toBe(0)
  // Nền đổi sang vàng, trong cửa sổ giữ nguyên: buffer giống hệt.
  await fillRect(page, r, 0, '#ffff00')
  const b = await nextAnalysis(page)
  expect(b.meta.frameId).toBeGreaterThan(a.meta.frameId)
  expect(b.hash).toBe(a.hash)
  expect(b.blue).toBe(a.blue)
  // Trong cửa sổ đổi màu: buffer khác.
  await fillRect(page, r, 0, '#ffff00', '#00ff00')
  const d = await nextAnalysis(page)
  expect(d.hash).not.toBe(a.hash)
  expect(d.blue).toBe(0)
  note(
    `hash ${a.hash.toString(16)} giữ nguyên khi chỉ đổi nền (frame ${a.meta.frameId} → ${b.meta.frameId});` +
      ` đổi màu trong cửa sổ → ${d.hash.toString(16)}`,
  )
  await expectGateClean(page)
})

test('đổi n: crop đúng cỡ cameraRect, letterbox đúng công thức, góc crop ánh xạ ngược về đúng góc cameraRect', async ({
  page,
}) => {
  const st = await openSynthetic(page)
  const { rows } = st.layout
  for (const n of [smallestN(st.layout), 9, Math.min(16, rows - 3)]) {
    const r = await openWindowAt(page, 3, 3, n)
    await expect.poll(async () => (await readLoop(page)).restricted?.lastRoiCam).toEqual(r)
    const s = (await readLoop(page)).restricted!
    expect(s.lastKind).toBe('ok')
    expect(s.lastCrop).toEqual({ w: r.w, h: r.h })
    const lb = s.lastLetterbox!
    const sc = SIZE / Math.max(r.w, r.h)
    expect(lb.size).toBe(SIZE)
    expect(lb.scale).toBeCloseTo(sc, 12)
    expect(lb.dx).toBe(Math.floor((SIZE - r.w * sc) / 2))
    expect(lb.dy).toBe(Math.floor((SIZE - r.h * sc) / 2))
    expect(Math.max(r.w, r.h) * lb.scale).toBeCloseTo(SIZE, 9)
    // Góc dưới phải của crop trong ảnh letterbox → bỏ letterbox → cộng roiCam = góc dưới phải cameraRect.
    const corner = { x: lb.dx + r.w * lb.scale, y: lb.dy + r.h * lb.scale }
    const cam = { x: r.x + (corner.x - lb.dx) / lb.scale, y: r.y + (corner.y - lb.dy) / lb.scale }
    expect(cam.x).toBeCloseTo(r.x + r.w, 9)
    expect(cam.y).toBeCloseTo(r.y + r.h, 9)
    const a = await nextAnalysis(page, 1)
    expect([a.w, a.h]).toEqual([SIZE, SIZE])
    note(
      `n=${n}: crop ${r.w}×${r.h}, letterbox scale ${lb.scale.toFixed(4)}, dx ${lb.dx}, dy ${lb.dy}`,
    )
  }
  await expectGateClean(page)
})

test('đóng thì không tạo tác vụ; cửa sổ quá nhỏ thì too-small, không tiêu taskId; mở rộng thì taskId từ 1', async ({
  page,
}) => {
  await openSynthetic(page)
  const waitFrames = async (n: number) => {
    const f0 = (await readLoop(page)).frames
    await page.waitForFunction((t) => (window.__wct?.loop?.snapshot().frames ?? 0) >= t, f0 + n)
  }
  await waitFrames(10)
  let s = (await readLoop(page)).restricted!
  expect(s).toMatchObject({ builds: 0, tooSmall: 0, noFrame: 0, lastTaskId: -1, lastKind: null })
  expect(await page.evaluate(() => window.__rfCount)).toBe(0)

  // Lưới 128 × 72: n = 3 cho cạnh camera dưới 64 px.
  await page.getByLabel('Lưới', { exact: true }).selectOption('2')
  await expect.poll(async () => (await readStage(page)).settings.cols).toBe(128)
  const r = await openWindowAt(page, 5, 5, 3)
  expect(Math.min(r.w, r.h)).toBeLessThan(64)
  await expect.poll(async () => (await readLoop(page)).restricted!.tooSmall).toBeGreaterThan(0)
  s = (await readLoop(page)).restricted!
  expect(s.builds).toBe(0)
  expect(s.lastKind).toBe('too-small')
  expect(s.lastTaskId).toBe(-1)
  await expect(page.getByTestId('restricted-stat')).toHaveText(/quá nhỏ/)
  expect(await page.evaluate(() => window.__rfCount)).toBe(0)

  // Mở rộng: tạo tác vụ, taskId tăng từ 1 và bằng số lần ok.
  await run(page, 'resizeWindow(12)')
  await expect.poll(async () => (await readLoop(page)).restricted!.builds).toBeGreaterThan(0)
  s = (await readLoop(page)).restricted!
  expect(s.lastKind).toBe('ok')
  expect(s.lastTaskId).toBe(s.builds)
  await expect(page.getByTestId('restricted-stat')).not.toHaveText(/quá nhỏ/)

  // Đóng: số tác vụ và số too-small đứng yên.
  await run(page, 'coverAll')
  await expect.poll(async () => (await readLoop(page)).reveal.kind).toBe('closed')
  const before = (await readLoop(page)).restricted!
  const c0 = await page.evaluate(() => window.__rfCount ?? 0)
  await waitFrames(15)
  const after = (await readLoop(page)).restricted!
  expect(after.builds).toBe(before.builds)
  expect(after.tooSmall).toBe(before.tooSmall)
  expect(await page.evaluate(() => window.__rfCount)).toBe(c0)
  note(
    `đóng 15 frame: tác vụ ${before.builds} → ${after.builds}, too-small ${before.tooSmall} → ${after.tooSmall}`,
  )
  await expectGateClean(page)
})

// ROI-02 (D-038): mask tứ giác có lỗ: buffer chỉ chứa pixel của ô mở; các lỗ trong hộp bao là xám đệm.
test('gate cứng với tứ giác lệch (tay giả lập): lỗ trong hộp bao là xám, không có pixel ngoài ô mở; đối chứng 1 px', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await openSynthetic(page)
  await page.getByLabel('Nguồn cửa sổ').selectOption('hands')
  await expect(page.getByLabel('N min')).toBeVisible()
  await page.waitForTimeout(300)
  const st = await readStage(page)
  const L = st.layout
  // Hình thang lệch như solver.spec: tay trái tại góc ô (26, 18) cao 8 ô, tay phải tại (38, 21) cao 4 ô.
  const pL = camAtCell(L, 26, 18)
  const pR = camAtCell(L, 38, 21)
  await setFakeHands(page, {
    left: { x: pL.x, y: pL.y, spread: (8 * L.c) / L.scale },
    right: { x: pR.x, y: pR.y, spread: (4 * L.c) / L.scale },
  })
  await expect
    .poll(async () => (await readLoop(page)).reveal.kind, { timeout: 15_000 })
    .toBe('open')
  const m = (await readLoop(page)).mask!
  expect(m.holesCam.length).toBeGreaterThan(0)
  const r = m.cameraRect
  expect(Math.min(r.w, r.h)).toBeGreaterThanOrEqual(64)
  // Vùng xanh dương phủ đúng hộp bao camera: buffer chỉ có xanh (ô mở) và xám (lỗ, đệm), không có magenta.
  await fillRect(page, r)
  const a = await nextAnalysis(page)
  expect(a.meta.roiCam).toEqual(r)
  expect(a.bad).toBe(0)
  const sc = SIZE / Math.max(r.w, r.h)
  const rectPx = r.w * sc * (r.h * sc)
  const openFrac = m.cellCount / (m.box.w * m.box.h)
  expect(a.blue).toBeLessThanOrEqual(Math.ceil(rectPx * openFrac) + 4 * (r.w + r.h) * sc)
  expect(a.blue).toBeGreaterThanOrEqual(Math.floor(rectPx * openFrac) - 4 * (r.w + r.h) * sc)
  expect(a.gray).toBeGreaterThan(SIZE * SIZE - rectPx * openFrac - 4 * (r.w + r.h) * sc - 1)
  // Đối chứng: viền magenta 1 px trong hộp bao đi qua ô mở ở biên hộp nên phải lọt vào buffer.
  await fillRect(page, r, 1)
  const b = await nextAnalysis(page)
  expect(b.bad).toBeGreaterThan(0)
  note(
    `hộp ${m.box.w}×${m.box.h} ô, ${m.cellCount} ô mở, ${m.holesCam.length} lỗ: pixel ngoài ô mở ${a.bad}, xanh` +
      ` ${a.blue} (tỉ lệ mở ${openFrac.toFixed(3)} → ${Math.round(rectPx * openFrac)}), xám ${a.gray}; đối chứng ${b.bad}`,
  )
  await setFakeHands(page, null)
  await expectGateClean(page)
})
