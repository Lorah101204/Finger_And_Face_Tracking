import { expect, test, type Page } from '@playwright/test'
import {
  expectCanvasWhite,
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
  type StageSnap,
} from './helpers'

// PERF-02 (mục 7.29, D-052): vòng lặp tiết kiệm: (a) hình không đổi thì dùng lại mask (maskBuilds không tăng); (b) danh
// sách ô của FrameOutput lấy từ cache theo mask; (c) frame tĩnh (vùng đóng, không overlay tay, không đầu ngón, layout và
// vạch lưới không đổi) không vẽ lại (paints đứng yên trong khi frames tăng); đóng vùng thì vẽ đúng một lần để xóa.
async function openSynthetic(page: Page): Promise<StageSnap> {
  await installGumCounter(page)
  await seedConsent(page)
  await openApp(page, '?debug=1&source=synthetic')
  await expect(page.locator('canvas#stage')).toBeVisible()
  await installGateAudit(page)
  return readStage(page)
}

async function counters(page: Page) {
  const l = await readLoop(page)
  return { frames: l.frames, paints: l.paints, builds: l.maskBuilds }
}

async function delta(page: Page, ms: number) {
  const a = await counters(page)
  await page.waitForTimeout(ms)
  const b = await counters(page)
  return { frames: b.frames - a.frames, paints: b.paints - a.paints, builds: b.builds - a.builds }
}

test('frame tĩnh không vẽ lại: vùng đóng thì paints đứng yên trong khi frames tăng; mở vùng thì vẽ mỗi frame; đóng vùng vẽ đúng một lần; đổi vạch lưới vẽ một lần; canvas vẫn trắng', async ({
  page,
}) => {
  await openSynthetic(page)
  // Chờ vòng lặp ổn định sau khi mount (layout, lần vẽ đầu).
  await page.waitForTimeout(500)
  const idle = await delta(page, 1000)
  expect(idle.frames).toBeGreaterThan(10)
  expect(idle.paints).toBe(0)
  await expectCanvasWhite(page)

  await page.evaluate(() => window.__scenario!.run('windowAt(20,10,12)'))
  await expect.poll(async () => (await readLoop(page)).reveal.kind).toBe('open')
  const open = await delta(page, 1000)
  expect(open.frames).toBeGreaterThan(10)
  expect(open.paints).toBe(open.frames)

  await page.evaluate(() => window.__scenario!.run('coverAll'))
  await expect.poll(async () => (await readLoop(page)).reveal.kind).toBe('closed')
  await page.waitForTimeout(300)
  const closed = await delta(page, 1000)
  expect(closed.paints).toBe(0)
  await expectCanvasWhite(page)

  // Tắt vạch lưới: một lần vẽ (StagePage vẽ ngay và vòng lặp vẽ lại vì showLines đổi), rồi lại đứng yên.
  const before = await counters(page)
  await page.getByLabel('Vạch lưới').uncheck()
  await page.waitForTimeout(500)
  const after = await counters(page)
  expect(after.paints - before.paints).toBeGreaterThanOrEqual(1)
  expect(after.paints - before.paints).toBeLessThanOrEqual(3)
  expect(after.frames - before.frames).toBeGreaterThan(5)
  await expectCanvasWhite(page, true)
  note(
    `vùng đóng: ${idle.frames} frame / ${idle.paints} lần vẽ trong 1 s; vùng mở: ${open.frames} frame / ${open.paints} lần vẽ;` +
      ` sau khi đóng: ${closed.frames} frame / ${closed.paints} lần vẽ; đổi vạch lưới: ${after.paints - before.paints} lần vẽ`,
  )
  await expectGateClean(page)
})

test('dùng lại mask khi hình không đổi: cửa sổ chuột đứng yên thì maskBuilds không tăng, dời cửa sổ tăng đúng một; tay giả theo quỹ đạo dựng lại mỗi frame (cận trên)', async ({
  page,
}) => {
  await openSynthetic(page)
  await page.evaluate(() => window.__scenario!.run('windowAt(20,10,12)'))
  await expect.poll(async () => (await readLoop(page)).reveal.kind).toBe('open')
  const still = await delta(page, 1000)
  expect(still.frames).toBeGreaterThan(10)
  expect(still.builds).toBe(0)
  const b0 = (await counters(page)).builds
  await page.evaluate(() => window.__scenario!.run('moveWindow(22,10)'))
  await expect.poll(async () => (await counters(page)).builds).toBe(b0 + 1)
  await page.waitForTimeout(300)
  expect((await counters(page)).builds).toBe(b0 + 1)
  const out = (await readLoop(page)).output
  expect(out.reveal?.cells.length).toBe(144)
  expect(out.reveal?.box).toEqual({ col: 22, row: 10, w: 12, h: 12 })

  // Tay giả: mỗi frame render là một HandFrame mới (kịch bản sinh theo frameId) nên đa giác đổi mỗi frame (One Euro
  // hội tụ chậm, cutoff 1 Hz) và mask dựng lại gần như mỗi frame: đó là cận trên. Với worker thật, HandWindowSource
  // chỉ giải một lần cho mỗi HandFrame (khoảng 30 Hz) nên các frame render giữa hai kết quả dùng lại mask; e2e không
  // giả lập được nhịp đó với tay giả.
  await page.getByLabel('Nguồn cửa sổ').selectOption('hands')
  await expect(page.getByLabel('N min')).toBeVisible()
  const L = (await readStage(page)).layout
  const spec = handsAtCell(L, 20, 10, 12)
  await setFakeHands(page, {
    ...spec,
    orbit: { radius: (3 * L.c) / L.scale, periodMs: 4000 },
  })
  await expect.poll(async () => (await readLoop(page)).reveal.kind).toBe('open')
  const orbit = await delta(page, 1000)
  expect(orbit.builds).toBeGreaterThan(orbit.frames * 0.5)
  expect(orbit.builds).toBeLessThanOrEqual(orbit.frames)
  note(
    `cửa sổ chuột đứng yên: ${still.frames} frame / ${still.builds} lần dựng mask; dời: +1; tay giả theo quỹ đạo: ${orbit.frames} frame / ${orbit.builds} lần dựng`,
  )
  await expectGateClean(page)
})
