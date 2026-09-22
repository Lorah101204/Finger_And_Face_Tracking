import { expect, test, type Page } from '@playwright/test'
import { convexHull, listCells, rasterizePolygon } from '../../src/core/cells'
import { DEFAULTS } from '../../src/core/config'
import type { Layout } from '../../src/core/coords'
import { fakeHandFrame } from '../../src/debug/fakeHands'
import { evaluateFingertips } from '../../src/hands/fingertips'
import {
  OUTLINE,
  camAtCell,
  expectCanvasWhite,
  expectGateClean,
  handsAtCell,
  installGateAudit,
  note,
  openApp,
  readHandWindow,
  readHands,
  readLoop,
  readStage,
  seedConsent,
  setFakeHands,
  type LoopSnap,
} from './helpers'

// ROI-01, ROI-02, ROI-03 (mục 7.15, 7.17, 7.26): vùng mở theo tay với tay giả lập (window.__scenario.hands,
// src/debug/fakeHands.ts) thay worker: các đầu ngón giả lập ở px camera → HandWindowSource (lọc, bao lồi) → buildMask
// rasterize đa giác thành tập ô (kể cả ô bị cạnh cắt qua, hysteresis theo ô) → mask. Các ca hình học dùng hai ngón cái
// và trỏ (kịch bản fingers(4,8)) để bốn đầu ngón tạo hình chữ nhật; ca cuối dùng cả năm ngón và tính lại tập ô trong
// Node. Kiểm mở đúng ô, ổn định khi rung, dời và phóng không đổi epoch, đa giác lệch có lỗ, too-small, tuổi điểm và độ
// nhạy (UC-09).

/**
 * Mở sân khấu tổng hợp, chọn nguồn tay (và đầu ngón dùng) rồi mới đọc layout: hai thanh đầu ngón và độ nhạy hiện ra làm
 * canvas nhỏ lại.
 */
async function openHands(page: Page, fingers: number[] | null = [4, 8]) {
  await seedConsent(page)
  await openApp(page, '?debug=1&source=synthetic')
  await expect(page.locator('canvas#stage')).toBeVisible()
  await page.getByLabel('Nguồn cửa sổ').selectOption('hands')
  await expect(page.getByLabel('N min')).toBeVisible()
  if (fingers) await page.evaluate((f) => window.__scenario!.run('fingers', ...f), fingers)
  await installGateAudit(page)
  let st = await readStage(page)
  for (;;) {
    await page.waitForTimeout(150)
    const next = await readStage(page)
    if (next.stageSize.w === st.stageSize.w && next.stageSize.h === st.stageSize.h) return next
    st = next
  }
}

/** Pixel canvas tại (x, y). */
function pixelAt(page: Page, x: number, y: number): Promise<number[]> {
  return page.evaluate(
    ([x, y]) => {
      const c = document.querySelector<HTMLCanvasElement>('canvas#stage')!
      return Array.from(c.getContext('2d')!.getImageData(x, y, 1, 1).data)
    },
    [x, y] as const,
  )
}

function hasCell(m: NonNullable<LoopSnap['output']['reveal']>, col: number, row: number) {
  return m.cells.some((c) => c.col === col && c.row === row)
}

// Hình chữ nhật (hai ngón mỗi tay) quanh góc ô (32, 18): rộng 1,5 × 8,2 = 12,3 ô, cao 8,2 ô → mép lấn 0,15 và 0,1 ô vào ô 25, 38, 13,
// 22 (dưới hysteresis 0,25) nên hộp là cột 26..37, hàng 14..21, đầy 96 ô.
const BOX = { col: 26, row: 14, w: 12, h: 8 }

test('tay giả lập mở đúng tập ô; đứng yên và rung ±3 px không đổi ô; dời và phóng theo tay không đổi epoch; rời nguồn tay thì đóng', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const st = await openHands(page)
  const L = st.layout
  expect(L.cols).toBe(64)
  await setFakeHands(page, handsAtCell(L, 32, 18, 8.2))
  await expect
    .poll(async () => (await readLoop(page)).reveal.kind, { timeout: 15_000 })
    .toBe('open')
  const l1 = await readLoop(page)
  expect(l1.mask!.shape.kind).toBe('polygon')
  expect(l1.mask!.box).toEqual(BOX)
  expect(l1.mask!.cellCount).toBe(96)
  expect(l1.mask!.holesCam).toEqual([])
  expect(l1.mask!.limited).toBe(false)
  expect(l1.mask!.stageRect).toEqual({
    x: L.board.x + BOX.col * L.c,
    y: L.board.y + BOX.row * L.c,
    w: BOX.w * L.c,
    h: BOX.h * L.c,
  })
  expect(l1.output.reveal!.cells).toHaveLength(96)
  expect(l1.output.points.every((p) => p.valid)).toBe(true)
  expect(l1.output.status).not.toBe('covered')
  expect((await readHands(page)).fake).toBe(true)
  await expect(page.getByTestId('hands-stat')).toHaveText(/giả lập/)
  await expect(page.getByTestId('solver-stat')).toHaveText(/mở đa giác/)
  await expect(page.getByTestId('reveal-stat')).toHaveText(/mở đa giác 96 ô, hộp \(26, 14\) 12×8/)
  // Video (cảnh tổng hợp) hiện trong vùng mở: tâm hộp không trắng; viền xanh ở cạnh trái hộp.
  const r = l1.mask!.stageRect
  const center = await pixelAt(page, r.x + Math.floor(r.w / 2), r.y + Math.floor(r.h / 2))
  expect(center.slice(0, 3)).not.toEqual([255, 255, 255])
  expect(await pixelAt(page, r.x + 1, r.y + Math.floor(L.c / 2))).toEqual(OUTLINE)

  // Đứng yên 800 ms: tập ô và epoch giữ nguyên, solver vẫn giải mỗi frame.
  const solves0 = (await readHandWindow(page)).solves
  await page.waitForTimeout(800)
  const l2 = await readLoop(page)
  expect(l2.mask!.box).toEqual(BOX)
  expect(l2.mask!.cellCount).toBe(96)
  expect(l2.epoch).toBe(l1.epoch)
  expect((await readHandWindow(page)).solves).toBeGreaterThan(solves0 + 5)

  // Rung ±3 px camera quanh vị trí cũ (One Euro và hysteresis ô): không đổi ô, không đổi epoch. Cạnh 8,0 ô để mép
  // nằm đúng vạch ô (26, 38, 14, 22): cùng 96 ô, cách ngưỡng hysteresis 0,25 ô = 5 px camera nên rung thô ±3 px không
  // thể lật ô. Với mép 12,3 × 8,2 (cách ngưỡng 0,1 ô = 2 px camera) bộ lọc 3 Hz mặc định (D-059) ở nhịp vòng lặp thấp
  // để lọt đủ rung cho cột 25 bật: giới hạn thật của lọc 3 Hz, ghi ở D-059.
  await setFakeHands(page, handsAtCell(L, 32, 18, 8.0, { jitter: 3 }))
  await page.waitForTimeout(800)
  const l3 = await readLoop(page)
  expect(l3.mask!.box).toEqual(BOX)
  expect(l3.mask!.cellCount).toBe(96)
  expect(l3.epoch).toBe(l1.epoch)

  // Dời tâm sang góc ô (36, 18): mép mới 29,85..42,15 ô; cột 30..41 mở, cột 29 đang mở còn chạm ô nới 0,25 (29,85 <
  // 30,25) nên giữ (hysteresis), cột 42 chỉ lấn 0,15 nên chưa bật → hộp cột 29..41; cùng epoch (open → open); One Euro
  // kéo tới trong dưới một giây.
  await setFakeHands(page, handsAtCell(L, 36, 18, 8.2))
  await expect
    .poll(async () => (await readLoop(page)).mask?.box, { timeout: 10_000 })
    .toEqual({ col: 29, row: 14, w: 13, h: 8 })
  expect((await readLoop(page)).epoch).toBe(l1.epoch)
  // Phóng: cao 10,2 ô, rộng 15,3 ô quanh (36, 18): cột 28,35..43,65 → 28..43 (lấn 0,65 > 0,25), hàng 12,9..23,1 →
  // 13..22 (hàng 12 và 23 chỉ lấn 0,1).
  await setFakeHands(page, handsAtCell(L, 36, 18, 10.2))
  await expect
    .poll(async () => (await readLoop(page)).mask?.box, { timeout: 10_000 })
    .toEqual({ col: 28, row: 13, w: 16, h: 10 })
  expect((await readLoop(page)).epoch).toBe(l1.epoch)

  // Rời nguồn tay: đóng, không còn slot, HandFrame bị xóa; canvas trắng.
  await page.getByLabel('Nguồn cửa sổ').selectOption('mouse')
  await expect
    .poll(async () => (await readLoop(page)).reveal)
    .toEqual({ kind: 'closed', reason: 'user' })
  expect((await readLoop(page)).output.points).toEqual([])
  expect((await readHands(page)).latest).toBeNull()
  await expectCanvasWhite(page)
  await setFakeHands(page, null)
  expect((await readHands(page)).fake).toBe(false)
  note(
    `chữ nhật 12,3 × 8,2 ô → hộp (${BOX.col}, ${BOX.row}) ${BOX.w}×${BOX.h}, 96 ô, 0 lỗ; đứng yên và rung ±3 px: cùng hộp,` +
      ` epoch ${l1.epoch} giữ nguyên; dời 4 ô → hộp (29, 14) 13×8; phóng → (28, 13) 16×10; cùng epoch`,
  )
  await expectGateClean(page)
})

test('đa giác lệch: ô bị cạnh cắt qua mở, ô ngoài đa giác trong hộp bao là lỗ (không vẽ video, không gửi worker); đa giác nét đứt', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const st = await openHands(page)
  const L = st.layout
  // Tay trái tại góc ô (26, 18) cao 8 ô, tay phải tại (38, 21) cao 4 ô: tứ giác hình thang lệch, đỉnh
  // (26, 14) (38, 19) (38, 23) (26, 22) theo ô.
  const pL = camAtCell(L, 26, 18)
  const pR = camAtCell(L, 38, 21)
  await setFakeHands(page, {
    left: { x: pL.x, y: pL.y, spread: (8 * L.c) / L.scale },
    right: { x: pR.x, y: pR.y, spread: (4 * L.c) / L.scale },
  })
  await expect
    .poll(async () => (await readLoop(page)).reveal.kind, { timeout: 15_000 })
    .toBe('open')
  const l = await readLoop(page)
  const m = l.output.reveal!
  expect(m.box).toEqual({ col: 26, row: 14, w: 12, h: 9 })
  expect(l.mask!.holesCam.length).toBeGreaterThan(0)
  expect(m.cells.length + l.mask!.holesCam.length).toBe(12 * 9)
  // Góc trên phải nằm ngoài hình thang (cạnh trên tại cột 37 ở hàng 18,6): ô (37, 14) và (37, 17) là lỗ; góc dưới
  // phải (37, 22) trong hình thang (cạnh dưới tại cột 37 ở hàng 22,9) nên mở; cột 26 mở suốt hàng 14..21.
  expect(hasCell(m, 37, 14)).toBe(false)
  expect(hasCell(m, 37, 17)).toBe(false)
  expect(hasCell(m, 37, 22)).toBe(true)
  expect(hasCell(m, 26, 14)).toBe(true)
  expect(hasCell(m, 26, 21)).toBe(true)
  // Cạnh trên từ (26, 14) tới (38, 19): tại cột 32 cạnh ở hàng 16,5 → ô (32, 16) bị cắt qua nên mở, ô (32, 15) ở trên
  // cạnh nên đóng.
  expect(hasCell(m, 32, 16)).toBe(true)
  expect(hasCell(m, 32, 15)).toBe(false)
  // Lỗ trên canvas trắng (kể vạch lưới), ô mở có video (không trắng).
  const holePx = await pixelAt(
    page,
    L.board.x + 37 * L.c + Math.floor(L.c / 2),
    L.board.y + 14 * L.c + Math.floor(L.c / 2),
  )
  expect(holePx.slice(0, 3)).toEqual([255, 255, 255])
  const openPx = await pixelAt(
    page,
    L.board.x + 27 * L.c + Math.floor(L.c / 2),
    L.board.y + 17 * L.c + Math.floor(L.c / 2),
  )
  expect(openPx.slice(0, 3)).not.toEqual([255, 255, 255])
  await expect(page.getByTestId('reveal-stat')).toHaveText(/mở đa giác \d+ ô, hộp \(26, 14\) 12×9/)
  note(
    `hình thang lệch → hộp (26, 14) 12×9: ${m.cells.length} ô mở, ${l.mask!.holesCam.length} lỗ; (37,14) (37,17) (32,15) tắt,` +
      ` (37,22) (26,14) (26,21) (32,16) mở; lỗ trên canvas trắng, ô mở có video`,
  )
  await setFakeHands(page, null)
  await expectGateClean(page)
})

test('too-small khi các đầu ngón quá gần; tuổi điểm và độ nhạy (UC-09) áp dụng ngay', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const st = await openHands(page)
  const L = st.layout
  // Cạnh ngắn 2,5 ô < nMin 3: đóng too-small dù mọi đầu ngón hợp lệ; thông điệp bảo xòe ngón hoặc tách tay.
  await setFakeHands(page, handsAtCell(L, 32, 18, 2.5))
  await expect
    .poll(async () => (await readLoop(page)).reveal, { timeout: 15_000 })
    .toEqual({ kind: 'closed', reason: 'too-small' })
  const t = await readLoop(page)
  expect(t.output.points.every((p) => p.valid)).toBe(true)
  await expect(page.getByTestId('stage-status')).toHaveText(/quá gần nhau/)
  await expect(page.getByTestId('solver-stat')).toHaveText(/đóng: too-small/)

  // Đủ cỡ: mở với epoch mới.
  await setFakeHands(page, handsAtCell(L, 32, 18, 8.2))
  await expect.poll(async () => (await readLoop(page)).mask?.box, { timeout: 10_000 }).toEqual(BOX)
  const e1 = (await readLoop(page)).epoch
  expect(e1).toBe(t.epoch + 1)

  // Điểm cũ 700 ms: đóng stale-point với tuổi tối đa mặc định (D-059: 600 với cả hai delegate; headless là CPU vì WebGL
  // là SwiftShader); nâng "Tuổi điểm" lên 1000 thì mở lại; đặt lại về mặc định thì đóng.
  const defaultAge = (await readStage(page)).settings.sensitivity.pointMaxAgeMs
  expect([DEFAULTS.freshness.pointMaxAgeMs, DEFAULTS.freshness.pointMaxAgeMsCpu]).toContain(
    defaultAge,
  )
  await setFakeHands(page, handsAtCell(L, 32, 18, 8.2, { ageMs: 700 }))
  await expect
    .poll(async () => (await readLoop(page)).reveal, { timeout: 10_000 })
    .toEqual({ kind: 'closed', reason: 'stale-point' })
  await page.getByLabel('Tuổi điểm').fill('1000')
  await expect
    .poll(async () => (await readStage(page)).settings.sensitivity.pointMaxAgeMs)
    .toBe(1000)
  await expect
    .poll(async () => (await readLoop(page)).reveal.kind, { timeout: 10_000 })
    .toBe('open')
  await page.getByRole('button', { name: 'Đặt lại độ nhạy' }).click()
  await expect
    .poll(async () => (await readStage(page)).settings.sensitivity.pointMaxAgeMs)
    .toBe(defaultAge)
  await expect
    .poll(async () => (await readLoop(page)).reveal, { timeout: 10_000 })
    .toEqual({ kind: 'closed', reason: 'stale-point' })

  // N min 9 với cạnh ngắn 8,2 ô: too-small; về 3 thì mở lại. Độ nhạy không đổi epoch của store.
  await setFakeHands(page, handsAtCell(L, 32, 18, 8.2))
  await expect.poll(async () => (await readLoop(page)).mask?.box, { timeout: 10_000 }).toEqual(BOX)
  const e2 = (await readStage(page)).epoch
  await page.getByLabel('N min').fill('9')
  await expect
    .poll(async () => (await readLoop(page)).reveal, { timeout: 10_000 })
    .toEqual({ kind: 'closed', reason: 'too-small' })
  await page.getByLabel('N min').fill('3')
  await expect.poll(async () => (await readLoop(page)).mask?.box, { timeout: 10_000 }).toEqual(BOX)
  const stAfter = await readStage(page)
  expect(stAfter.settings.sensitivity.nMin).toBe(3)
  expect(stAfter.epoch).toBe(e2 + 1) // chỉ lần mở lại (closed → open) tăng epoch, đổi độ nhạy không tăng

  // Hysteresis 0: mép lấn 0,15 ô cũng mở → hộp rộng thêm hai cột và hai hàng (25..38, 13..22).
  await page.getByLabel('Hysteresis').fill('0')
  await expect
    .poll(async () => (await readLoop(page)).mask?.box, { timeout: 10_000 })
    .toEqual({ col: 25, row: 13, w: 14, h: 10 })
  await setFakeHands(page, null)
  await expect
    .poll(async () => (await readLoop(page)).reveal, { timeout: 10_000 })
    .toEqual({ kind: 'closed', reason: 'few-points' })
  note(
    `cạnh 2,5 ô → too-small; điểm cũ 300 ms → stale-point, tuổi 500 → mở, đặt lại → đóng; N min 9 → too-small, 3 → mở;` +
      ` epoch ${e2} → ${stAfter.epoch} (chỉ khi mở lại); hysteresis 0 → hộp (25, 13) 14×10`,
  )
  await expectGateClean(page)
})

// QA-01 (mục 7.1 "tay chéo"): HandFrame uncertain (hai tay cùng nhãn chéo nhau, HAND-01) → mọi đầu ngón ambiguous-hands,
// vùng đóng ngay và không đổi epoch (đóng vì tay, mục 4.6); hết chéo thì mở lại cùng tập ô với epoch mới.
test('hai tay chéo nhau (frame uncertain): đóng ambiguous-hands với mọi đầu ngón không hợp lệ, canvas trắng, epoch giữ; hết chéo thì mở lại cùng ô', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const st = await openHands(page)
  const L = st.layout
  await setFakeHands(page, handsAtCell(L, 32, 18, 8.2))
  await expect.poll(async () => (await readLoop(page)).mask?.box, { timeout: 15_000 }).toEqual(BOX)
  const e0 = (await readLoop(page)).epoch
  await setFakeHands(page, handsAtCell(L, 32, 18, 8.2, { uncertain: true }))
  await expect
    .poll(async () => (await readLoop(page)).reveal, { timeout: 10_000 })
    .toEqual({ kind: 'closed', reason: 'ambiguous-hands' })
  const l = await readLoop(page)
  expect(l.output.points.map((p) => p.reason)).toEqual(Array(4).fill('ambiguous-hands'))
  expect(l.output.points.every((p) => !p.valid)).toBe(true)
  expect(l.output.faces).toEqual([])
  expect(l.epoch).toBe(e0)
  await expectCanvasWhite(page)
  await expect(page.getByTestId('stage-status')).toHaveText(/hai tay chéo nhau/)
  await setFakeHands(page, handsAtCell(L, 32, 18, 8.2))
  await expect.poll(async () => (await readLoop(page)).mask?.box, { timeout: 10_000 }).toEqual(BOX)
  expect((await readLoop(page)).epoch).toBe(e0 + 1)
  note(
    `uncertain → đóng ambiguous-hands, epoch ${e0} giữ; hết chéo → mở lại hộp (${BOX.col}, ${BOX.row}), epoch ${e0 + 1}`,
  )
  await setFakeHands(page, null)
  await expectGateClean(page)
})

test('năm đầu ngón mỗi tay (mặc định): vùng mở là bao lồi của mười điểm, tập ô khớp tính lại trong Node; chọn lại hai ngón thì về hình chữ nhật với epoch mới', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const st = await openHands(page, null)
  const L = st.layout as Layout
  expect(st.settings.fingers).toEqual([4, 8, 12, 16, 20])
  const spec = handsAtCell(L, 32, 18, 8.2)
  await setFakeHands(page, spec)
  await expect
    .poll(async () => (await readLoop(page)).reveal.kind, { timeout: 15_000 })
    .toBe('open')
  const l = await readLoop(page)
  expect(l.mask!.shape.kind).toBe('polygon')
  expect(l.output.points).toHaveLength(10)
  expect(l.output.points.every((p) => p.valid)).toBe(true)
  expect(new Set(l.output.points.map((p) => p.hand))).toEqual(new Set(['left', 'right']))
  // Tính lại trong Node từ cùng định nghĩa tay giả lập: 10 đầu ngón → stage (mirror) → bao lồi → tập ô với cùng
  // hysteresis (frame mở đầu không có mask trước nên mọi ô dùng ngưỡng bật: lấn quá 0,25 ô; tay đứng yên nên các
  // frame sau giữ nguyên tập ô).
  const frame = fakeHandFrame(spec, 1000, 1)
  const fingers = evaluateFingertips(frame, [4, 8, 12, 16, 20], L, st.settings.mirror, 1000)
  expect(fingers.every((f) => f.valid)).toBe(true)
  const hull = convexHull(fingers.map((f) => f.pStage))
  const cells = rasterizePolygon(hull, L, {
    hysteresisCells: st.settings.sensitivity.hysteresisCells,
  })
  expect(l.mask!.shape.polygonStage).toHaveLength(hull.length)
  expect(l.mask!.box).toEqual(cells.box)
  expect(l.mask!.cellCount).toBe(cells.cellCount)
  const key = (c: { col: number; row: number }) => `${c.col},${c.row}`
  expect(new Set(l.output.reveal!.cells.map(key))).toEqual(new Set(listCells(cells).map(key)))
  // Rộng hơn hình chữ nhật hai ngón (96 ô) và không phải hình chữ nhật (có lỗ trong hộp bao).
  expect(cells.cellCount).toBeGreaterThan(96)
  expect(l.mask!.holesCam.length).toBeGreaterThan(0)
  await expect(page.getByTestId('fingers-stat')).toHaveText(/trái 5\/5 ok · phải 5\/5 ok/)
  await expect(page.getByTestId('solver-stat')).toHaveText(/mở đa giác \d+ đỉnh/)
  await expect(page.getByTestId('reveal-stat')).toHaveText(
    new RegExp(
      `mở đa giác ${cells.cellCount} ô, hộp \\(${cells.box.col}, ${cells.box.row}\\) ${cells.box.w}×${cells.box.h}`,
    ),
  )

  // Chọn lại hai ngón cái và trỏ qua thanh Đầu ngón dùng: cấu hình đổi → đóng config-changed rồi mở lại hình chữ nhật
  // BOX với epoch mới, 4 điểm.
  const e0 = l.epoch
  await page.getByLabel('Ngón giữa').uncheck()
  await page.getByLabel('Ngón áp út').uncheck()
  await page.getByLabel('Ngón út').uncheck()
  await expect.poll(async () => (await readStage(page)).settings.fingers).toEqual([4, 8])
  await expect.poll(async () => (await readLoop(page)).mask?.box, { timeout: 10_000 }).toEqual(BOX)
  const l2 = await readLoop(page)
  expect(l2.epoch).toBeGreaterThan(e0)
  expect(l2.mask!.cellCount).toBe(96)
  expect(l2.output.points).toHaveLength(4)
  // Không cho bỏ ngón cuối: bỏ cái rồi bấm bỏ trỏ thì ngón trỏ vẫn còn (click thay uncheck vì Playwright kiểm trạng
  // thái sau khi bấm).
  await page.getByLabel('Ngón cái').uncheck()
  await expect.poll(async () => (await readStage(page)).settings.fingers).toEqual([8])
  await page.getByLabel('Ngón trỏ').click()
  await page.waitForTimeout(200)
  await expect(page.getByLabel('Ngón trỏ')).toBeChecked()
  expect((await readStage(page)).settings.fingers).toEqual([8])
  note(
    `mười đầu ngón → bao lồi ${hull.length} đỉnh, hộp (${cells.box.col}, ${cells.box.row}) ${cells.box.w}×${cells.box.h}, ${cells.cellCount} ô khớp tính lại trong Node,` +
      ` ${l.mask!.holesCam.length} lỗ; hai ngón → hộp (${BOX.col}, ${BOX.row}) ${BOX.w}×${BOX.h}, 96 ô, epoch ${e0} → ${l2.epoch}`,
  )
  await setFakeHands(page, null)
  await expectGateClean(page)
})

test('chỉ ngón đang giơ (ROI-04): trái 3 ngón, phải 2 ngón → bao lồi 5 điểm khớp tính lại trong Node, 5 điểm folded; gập thêm một ngón thì thu lại cùng epoch; nắm một tay thì few-points nêu số ngón gập; tắt công tắc thì về 10 điểm với epoch mới', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const st = await openHands(page, null)
  const L = st.layout as Layout
  expect(st.settings.raisedOnly).toBe(true)
  await expect(page.getByLabel('Chỉ ngón đang giơ')).toBeChecked()
  const base = handsAtCell(L, 32, 18, 8.2)
  // Trái: cái, trỏ, giữa; phải: cái, trỏ → năm đỉnh (hai ngón cái là hai đỉnh dưới, ba đầu ngón trên).
  const spec = {
    ...base,
    left: { ...base.left!, raised: [4, 8, 12] as (4 | 8 | 12)[] },
    right: { ...base.right!, raised: [4, 8] as (4 | 8)[] },
  }
  await setFakeHands(page, spec)
  await expect
    .poll(async () => (await readLoop(page)).reveal.kind, { timeout: 15_000 })
    .toBe('open')
  const l = await readLoop(page)
  expect(l.output.points).toHaveLength(10)
  const valid = l.output.points.filter((p) => p.valid)
  expect(valid.map((p) => `${p.hand}:${p.tip}`).sort()).toEqual(
    ['left:4', 'left:8', 'left:12', 'right:4', 'right:8'].sort(),
  )
  expect(l.output.points.filter((p) => p.reason === 'folded')).toHaveLength(5)
  // Tính lại trong Node: cùng tay giả → chỉ đầu ngón đang giơ → bao lồi → tập ô.
  const frame = fakeHandFrame(spec, 1000, 1)
  const fingers = evaluateFingertips(frame, [4, 8, 12, 16, 20], L, st.settings.mirror, 1000)
  const raised = fingers.filter((f) => f.valid)
  expect(raised).toHaveLength(5)
  const hull = convexHull(raised.map((f) => f.pStage))
  const cells = rasterizePolygon(hull, L, {
    hysteresisCells: st.settings.sensitivity.hysteresisCells,
  })
  expect(hull).toHaveLength(5)
  expect(l.mask!.shape.polygonStage).toHaveLength(5)
  expect(l.mask!.box).toEqual(cells.box)
  expect(l.mask!.cellCount).toBe(cells.cellCount)
  const key = (c: { col: number; row: number }) => `${c.col},${c.row}`
  expect(new Set(l.output.reveal!.cells.map(key))).toEqual(new Set(listCells(cells).map(key)))
  await expect(page.getByTestId('fingers-stat')).toHaveText(
    /trái 3\/5 \(2 folded\) · phải 2\/5 \(3 folded\)/,
  )
  note(
    `3 + 2 ngón giơ: bao lồi ${hull.length} đỉnh, ${cells.cellCount} ô, hộp ${cells.box.w}×${cells.box.h}`,
  )

  // Gập ngón cái phải (một đỉnh dưới của bao lồi): 4 điểm, bao lồi mất góc dưới phải nên ít ô hơn; epoch giữ nguyên
  // (chỉ là điểm rời bao lồi, không phải đổi cấu hình).
  const e0 = l.epoch
  await setFakeHands(page, { ...spec, right: { ...spec.right, raised: [8] } })
  await expect
    .poll(async () => (await readLoop(page)).output.points.filter((p) => p.valid).length)
    .toBe(4)
  const l2 = await readLoop(page)
  expect(l2.reveal.kind).toBe('open')
  expect(l2.epoch).toBe(e0)
  expect(l2.mask!.shape.polygonStage).toHaveLength(4)
  expect(l2.mask!.cellCount).toBeLessThan(l.mask!.cellCount)

  // Nắm tay phải: chỉ còn một tay có điểm → few-points, hướng dẫn nêu số ngón gập (2 trái + 5 phải).
  await setFakeHands(page, { ...spec, right: { ...spec.right, raised: [] } })
  await expect
    .poll(async () => (await readLoop(page)).reveal)
    .toEqual({ kind: 'closed', reason: 'few-points' })
  await expect(page.getByTestId('guide-detail')).toHaveText(/7 đầu ngón đang gập/)
  await expectCanvasWhite(page)

  // Tắt công tắc (kịch bản): cấu hình đổi → epoch++; mọi đầu ngón đã chọn tham gia (kể cả ngón gập ở lòng bàn tay).
  await page.evaluate(() => window.__scenario!.run('raisedOnly', 0))
  await expect.poll(async () => (await readStage(page)).settings.raisedOnly).toBe(false)
  await expect(page.getByLabel('Chỉ ngón đang giơ')).not.toBeChecked()
  await expect
    .poll(async () => (await readLoop(page)).output.points.filter((p) => p.valid).length, {
      timeout: 10_000,
    })
    .toBe(10)
  const l3 = await readLoop(page)
  expect(l3.epoch).toBeGreaterThan(e0)
  expect(l3.reveal.kind).toBe('open')
  const spec3 = { ...spec, right: { ...spec.right, raised: [] as 4[] } }
  const all = evaluateFingertips(
    fakeHandFrame(spec3, 1000, 1),
    [4, 8, 12, 16, 20],
    L,
    st.settings.mirror,
    1000,
    { raisedOnly: false },
  )
  const cells3 = rasterizePolygon(convexHull(all.map((f) => f.pStage)), L, {
    hysteresisCells: st.settings.sensitivity.hysteresisCells,
  })
  expect(l3.mask!.box).toEqual(cells3.box)
  expect(l3.mask!.cellCount).toBe(cells3.cellCount)
  // Bật lại bằng công tắc trong cột cài đặt: epoch++ lần nữa, đóng config-changed rồi lại few-points (tay phải nắm).
  await page.getByLabel('Chỉ ngón đang giơ').check()
  await expect.poll(async () => (await readStage(page)).settings.raisedOnly).toBe(true)
  await expect
    .poll(async () => (await readLoop(page)).reveal)
    .toEqual({ kind: 'closed', reason: 'few-points' })
  expect((await readLoop(page)).epoch).toBeGreaterThan(l3.epoch)
  await expectGateClean(page)
})
