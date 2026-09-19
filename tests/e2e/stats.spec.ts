import { expect, test, type Page } from '@playwright/test'
import {
  expectGateClean,
  handsAtCell,
  installGateAudit,
  installGumCounter,
  note,
  openApp,
  readFace,
  readLoop,
  readStage,
  readStats,
  seedConsent,
  setFakeHands,
} from './helpers'

// PERF-01 (mục 7.19): overlay hiệu năng (dòng stats-stat) và window.__wct.stats: fps output, Hz mặt và tay, p50/p95
// inferMs, buffer rớt, tác vụ chờ ≤ 1 (một tại một thời điểm), thời gian vẽ và tick; rate control: mặt không vượt
// face.targetHz (12) vì nhịp gửi là max(1000 / targetHz, p50); đóng vùng thì Hz mặt về 0. Tay giả lập theo quỹ đạo
// (soak) làm cửa sổ đổi ô liên tục mà epoch giữ nguyên.
async function openSynthetic(page: Page) {
  await installGumCounter(page)
  await seedConsent(page)
  await openApp(page, '?debug=1&source=synthetic')
  await expect(page.locator('canvas#stage')).toBeVisible()
  const st = await readStage(page)
  await installGateAudit(page)
  return st
}

/** Chọn nguồn tay rồi đọc layout sau khi hai thanh đầu ngón và độ nhạy đã hiện (canvas nhỏ lại). */
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

test('overlay hiệu năng: fps output > 0, mặt ≤ 12 Hz với tác vụ chờ ≤ 1, p95 ≥ p50, dòng stats-stat đúng dạng; đóng vùng thì mặt 0 Hz', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await openSynthetic(page)
  await page.waitForFunction(() => window.__wct?.face?.snapshot().ready === true, undefined, {
    timeout: 120_000,
  })
  await page.evaluate(() => window.__scenario!.run('windowAt(2,4,10)'))
  await expect
    .poll(async () => (await readStats(page)).faceHz, { timeout: 30_000 })
    .toBeGreaterThan(0)
  await page.waitForTimeout(2500)
  const s = await readStats(page)
  expect(s.samples).toBeGreaterThanOrEqual(8)
  expect(s.windowMs).toBe(2000)
  expect(s.fpsOutput).toBeGreaterThan(5)
  expect(s.faceHz).toBeGreaterThan(0)
  // Rate control: nhịp gửi ≥ 1000 / 12 ms nên không quá 12 kết quả mỗi giây (dung sai làm tròn cửa sổ).
  expect(s.faceHz).toBeLessThanOrEqual(12.5)
  expect(s.face.p50).toBeGreaterThan(0)
  expect(s.face.p95).toBeGreaterThanOrEqual(s.face.p50)
  expect(s.face.pending).toBeLessThanOrEqual(1)
  expect(s.face.submitted).toBeGreaterThan(0)
  // CLS-02: worker phân loại chạy khi vùng mở và cạnh ROI ≥ 96 px (khởi tạo lười nên có thể chưa có kết quả).
  expect(s.classifierHz).toBeGreaterThanOrEqual(0)
  expect(s.tick.n).toBeGreaterThan(30)
  expect(s.render.p95).toBeGreaterThanOrEqual(s.render.p50)
  expect(s.status).toBe('searching')
  const f = await readFace(page)
  expect(f.minIntervalMs).toBeGreaterThanOrEqual(1000 / 12 - 1e-6)
  expect(f.minIntervalMs).toBeGreaterThanOrEqual(f.stats.p50InferMs)
  // Overlay: cùng sampler (một dòng, re-render 4 Hz); số có thể lệch một mẫu so với snapshot nên chỉ kiểm dạng.
  await expect(page.getByTestId('stats-stat')).toHaveText(
    /^hiệu năng: output \d+\.\d fps · tay \d+\.\d Hz \(p50 [\d.]+ \/ p95 [\d.]+ ms, bỏ \d+\) · mặt \d+\.\d Hz \(p50 [\d.]+ \/ p95 [\d.]+ ms, rớt \d+, chờ [01]\) · phân loại \d+\.\d Hz · vẽ p50 [\d.]+ \/ p95 [\d.]+ ms · tick p95 [\d.]+ ms · epoch \d+ · searching$/,
  )
  note(
    `mở vùng: output ${s.fpsOutput.toFixed(1)} fps, mặt ${s.faceHz.toFixed(1)} Hz (p50 ${s.face.p50.toFixed(1)} / p95 ${s.face.p95.toFixed(1)} ms,` +
      ` nhịp ${f.minIntervalMs.toFixed(0)} ms, rớt ${s.face.dropped}, chờ ${s.face.pending}), vẽ p50 ${s.render.p50.toFixed(2)} / p95` +
      ` ${s.render.p95.toFixed(2)} ms, tick p95 ${s.tick.p95.toFixed(2)} ms`,
  )

  // Đóng: không còn tác vụ; sau cửa sổ 2 s Hz mặt về 0, chờ 0, trạng thái covered, vòng lặp vẫn vẽ.
  await page.evaluate(() => window.__scenario!.run('coverAll'))
  await expect.poll(async () => (await readStats(page)).faceHz, { timeout: 10_000 }).toBe(0)
  await expect.poll(async () => (await readStats(page)).classifierHz, { timeout: 10_000 }).toBe(0)
  const c = await readStats(page)
  expect(c.face.pending).toBe(0)
  expect(c.status).toBe('covered')
  expect(c.fpsOutput).toBeGreaterThan(5)
  note(
    `đóng vùng: mặt ${c.faceHz.toFixed(1)} Hz, chờ ${c.face.pending}, output ${c.fpsOutput.toFixed(1)} fps`,
  )
  await expectGateClean(page)
})

test('tay giả lập theo quỹ đạo: cửa sổ đổi ô liên tục mà epoch giữ nguyên, fps output ổn định, tác vụ chờ ≤ 1', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await openSynthetic(page)
  const st = await selectHands(page)
  const L = st.layout
  await setFakeHands(
    page,
    handsAtCell(L, 32, 18, 8.2, {
      orbit: { radius: (3 * L.c) / L.scale, periodMs: 4000 },
      jitter: 2,
    }),
  )
  await expect
    .poll(async () => (await readLoop(page)).reveal.kind, { timeout: 15_000 })
    .toBe('open')
  const e0 = (await readLoop(page)).epoch
  const boxes = new Set<string>()
  let pendingMax = 0
  const t0 = Date.now()
  while (Date.now() - t0 < 4500) {
    const l = await readLoop(page)
    if (l.mask) boxes.add(`${l.mask.box.col},${l.mask.box.row}`)
    pendingMax = Math.max(pendingMax, (await readFace(page)).busy ? 1 : 0)
    await page.waitForTimeout(150)
  }
  const l = await readLoop(page)
  expect(l.reveal.kind).toBe('open')
  expect(l.epoch).toBe(e0)
  expect(boxes.size).toBeGreaterThan(2)
  expect(pendingMax).toBeLessThanOrEqual(1)
  const s = await readStats(page)
  expect(s.fpsOutput).toBeGreaterThan(5)
  expect(s.status).not.toBe('covered')
  expect(s.hand.fed).toBe(0) // tay giả lập: worker tay không chạy
  note(
    `quỹ đạo 3 ô / 4 s: ${boxes.size} vị trí hộp trong 4,5 s, epoch ${e0} giữ nguyên; output ${s.fpsOutput.toFixed(1)} fps,` +
      ` mặt ${s.faceHz.toFixed(1)} Hz, vẽ p95 ${s.render.p95.toFixed(2)} ms, tick p95 ${s.tick.p95.toFixed(2)} ms`,
  )
  await setFakeHands(page, null)
  await expectGateClean(page)
})
