import { expect, test, type Page } from '@playwright/test'
import {
  OUTLINE,
  OUTLINE_LIMITED,
  WHITE,
  expectCanvasWhite,
  installGumCounter,
  openApp,
  readLoop,
  readStage,
  samplePixel,
  seedConsent,
  startFakeCamera,
  type LoopSnap,
  type StageSnap,
} from './helpers'

// ROI-00 (mục 7.7): cửa sổ điều khiển bằng chuột. Bấm mở tại con trỏ, kéo dời, lăn đổi n, Esc đóng, Space mở;
// kẹp trong bảng và báo limited (viền đỏ); viền vẽ trong stageRect; đổi lưới thì đóng rồi mở lại với epoch mới.
// INT-01: cửa sổ chỉ mở khi camera cấp frame (gate no-camera) nên bật camera giả trước; trong cửa sổ là video
// (kiểm ở mask.spec), ở đây chỉ kiểm viền và phần ngoài.
async function openStage(page: Page): Promise<StageSnap> {
  await installGumCounter(page)
  await seedConsent(page)
  await openApp(page)
  await expect(page.locator('canvas#stage')).toBeVisible()
  await startFakeCamera(page)
  return readStage(page)
}

/** Tọa độ CSS (cho page.mouse) của một điểm stage tính bằng px thiết bị. */
async function cssPoint(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const canvas = page.locator('canvas#stage')
  const box = (await canvas.boundingBox())!
  const size = await canvas.evaluate((el: HTMLCanvasElement) => ({ w: el.width, h: el.height }))
  return { x: box.x + (x * box.width) / size.w, y: box.y + (y * box.height) / size.h }
}

async function waitOpen(page: Page): Promise<LoopSnap & { mask: NonNullable<LoopSnap['mask']> }> {
  await expect.poll(async () => (await readLoop(page)).reveal.kind).toBe('open')
  const lp = await readLoop(page)
  return lp as LoopSnap & { mask: NonNullable<LoopSnap['mask']> }
}

test('Space mở cửa sổ n = 8 giữa bảng với viền xanh trong stageRect; Esc đóng; epoch tăng khi mở và khi đóng', async ({
  page,
}) => {
  const st = await openStage(page)
  const { c, cols, rows } = st.layout
  const e0 = (await readLoop(page)).epoch
  expect((await readLoop(page)).reveal).toEqual({ kind: 'closed', reason: 'user' })

  await page.keyboard.press('Space')
  const lp = await waitOpen(page)
  expect(lp.mask.shape.window).toEqual({ col: (cols - 8) / 2, row: (rows - 8) / 2, n: 8 })
  expect(lp.mask.limited).toBe(false)
  expect(lp.epoch).toBe(e0 + 1)
  expect(lp.mask.epoch).toBe(lp.epoch)
  const r = lp.mask.stageRect
  expect(r.w).toBe(8 * c)
  expect(r.h).toBe(8 * c)
  // Lấy mẫu ở giữa ô đầu tiên theo chiều dọc (r.y + c/2) để không trúng vạch lưới ngang khi cửa sổ đã đóng.
  const half = Math.floor(c / 2)
  expect(await samplePixel(page, r.x + 1, r.y + half)).toEqual(OUTLINE)
  expect(await samplePixel(page, r.x + r.w - 2, r.y + half)).toEqual(OUTLINE)

  await page.keyboard.press('Escape')
  await expect.poll(async () => (await readLoop(page)).reveal.kind).toBe('closed')
  const lc = await readLoop(page)
  expect(lc.reveal).toEqual({ kind: 'closed', reason: 'user' })
  expect(lc.epoch).toBe(e0 + 2)
  expect(await samplePixel(page, r.x + 1, r.y + half)).toEqual(WHITE)
  expect(await samplePixel(page, r.x + r.w - 2, r.y + half)).toEqual(WHITE)
  await expectCanvasWhite(page)
})

test('bấm mở tại con trỏ, kéo dời, kéo ra mép thì kẹp với viền đỏ, lăn chuột đổi n', async ({
  page,
}) => {
  const st = await openStage(page)
  const { c, board, cols, rows } = st.layout

  // Bấm ở tâm ô (10, 6): cửa sổ 8 ô quanh đó là col = round(10.5 - 4) = 7, row = round(6.5 - 4) = 3.
  const p1 = await cssPoint(page, board.x + 10 * c + c / 2, board.y + 6 * c + c / 2)
  await page.mouse.move(p1.x, p1.y)
  await page.mouse.down()
  let lp = await waitOpen(page)
  expect(lp.mask.shape.window).toEqual({ col: 7, row: 3, n: 8 })
  expect(lp.mask.limited).toBe(false)

  // Kéo tới tâm ô (30, 20): col = 27, row = 17.
  const p2 = await cssPoint(page, board.x + 30 * c + c / 2, board.y + 20 * c + c / 2)
  await page.mouse.move(p2.x, p2.y, { steps: 5 })
  await expect.poll(async () => (await readLoop(page)).mask?.shape.window.col).toBe(27)
  lp = await waitOpen(page)
  expect(lp.mask.shape.window).toEqual({ col: 27, row: 17, n: 8 })
  expect(lp.mask.limited).toBe(false)

  // Kéo tới góc dưới phải bảng: cửa sổ bị kẹp ở (cols - 8, rows - 8), limited, viền đỏ.
  const p3 = await cssPoint(page, board.x + board.w - 1, board.y + board.h - 1)
  await page.mouse.move(p3.x, p3.y, { steps: 5 })
  await expect.poll(async () => (await readLoop(page)).mask?.limited).toBe(true)
  lp = await waitOpen(page)
  expect(lp.mask.shape.window).toEqual({ col: cols - 8, row: rows - 8, n: 8 })
  const r = lp.mask.stageRect
  expect(r.x + r.w).toBe(board.x + board.w)
  expect(r.y + r.h).toBe(board.y + board.h)
  expect(await samplePixel(page, r.x + 1, r.y + Math.floor(c / 2))).toEqual(OUTLINE_LIMITED)
  await page.mouse.up()

  // Lăn lên: n = 9; lăn xuống hai lần: n = 7. Vẫn vuông và trong bảng.
  await page.mouse.wheel(0, -100)
  await expect.poll(async () => (await readLoop(page)).mask?.shape.window.n).toBe(9)
  await page.mouse.wheel(0, 100)
  await page.mouse.wheel(0, 100)
  await expect.poll(async () => (await readLoop(page)).mask?.shape.window.n).toBe(7)
  lp = await waitOpen(page)
  expect(lp.mask.stageRect.w).toBe(7 * c)
  expect(lp.mask.shape.window.col + 7).toBeLessThanOrEqual(cols)
  expect(lp.mask.shape.window.row + 7).toBeLessThanOrEqual(rows)
})

test('đổi lưới khi đang mở: đóng với config-changed rồi mở lại giữ chỗ trên màn hình với epoch mới', async ({
  page,
}) => {
  await openStage(page)
  await page.keyboard.press('Space')
  const lp1 = await waitOpen(page)
  expect(lp1.mask.shape.window).toEqual({ col: 28, row: 14, n: 8 })

  await page.getByLabel('Lưới', { exact: true }).selectOption('0')
  await expect.poll(async () => (await readLoop(page)).mask?.epoch).toBe(lp1.epoch + 2)
  const lp2 = await waitOpen(page)
  // Bảng 32 × 18 cùng tâm: cửa sổ đặt lại quanh tâm cũ là (12, 5); store đã tăng epoch một lần, mở lại tăng lần nữa.
  expect(lp2.mask.shape.window).toEqual({ col: 12, row: 5, n: 8 })
  expect(lp2.mask.limited).toBe(false)
  expect(lp2.epoch).toBe(lp1.epoch + 2)
  const st = await readStage(page)
  expect(lp2.mask.stageRect.w).toBe(8 * st.layout.c)
})

test('nguồn cửa sổ mặc định là chuột; chọn tay được (HAND-01) và đóng cửa sổ đang mở', async ({
  page,
}) => {
  await openStage(page)
  const select = page.getByLabel('Nguồn cửa sổ')
  await expect(select).toHaveValue('mouse')
  await expect(select.locator('option[value="hands"]')).toBeEnabled()
  await page.keyboard.press('Space')
  await expect.poll(async () => (await readLoop(page)).reveal.kind).toBe('open')
  await select.selectOption('hands')
  await expect
    .poll(async () => (await readLoop(page)).reveal)
    .toEqual({
      kind: 'closed',
      reason: 'few-points',
    })
  await expect(page.getByTestId('hands-stat')).toHaveText(/tay: (chưa chạy|đang nạp|sẵn sàng)/)
  await select.selectOption('mouse')
  await expect(page.getByTestId('hands-stat')).toHaveText(/tay: tắt/)
})
