import { expect, test, type Page } from '@playwright/test'
import {
  GRID_GRAY,
  WHITE,
  expectCanvasWhite,
  installGumCounter,
  openApp,
  readStage,
  samplePixel,
  seedConsent,
} from './helpers'
import { DEFAULTS } from '../../src/core/config'
import { resolveHandDelegate } from '../../src/hands/handDelegate'

// GRID-01 (mục 7.6): canvas theo DPR, c = floor(min(W / cols, H / rows)), bảng căn giữa, vạch lưới xám nhạt sau nền
// trắng, preset và custom có giới hạn, mirror; đổi lưới, mirror, kích thước làm epoch++ (mục 3); vạch lưới thì không.
async function openStage(page: Page): Promise<void> {
  await installGumCounter(page)
  await seedConsent(page)
  await openApp(page)
  await expect(page.locator('canvas#stage')).toBeVisible()
}

function canvasSize(
  page: Page,
): Promise<{ w: number; h: number; cssW: number; cssH: number; dpr: number }> {
  return page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('canvas#stage')!
    return {
      w: c.width,
      h: c.height,
      cssW: c.clientWidth,
      cssH: c.clientHeight,
      dpr: window.devicePixelRatio,
    }
  })
}

test('lưới mặc định 64 × 36: canvas theo DPR, c và bảng đúng công thức, vạch lưới xám; tắt vạch thì toàn trắng', async ({
  page,
}) => {
  await openStage(page)
  const st = await readStage(page)
  const size = await canvasSize(page)
  expect(size.w).toBe(Math.round(size.cssW * size.dpr))
  expect(size.h).toBe(Math.round(size.cssH * size.dpr))
  // D-045 (QA-02): tuổi điểm mặc định theo delegate tay app tự chọn từ renderer WebGL (headless SwiftShader → CPU);
  // D-059: cả hai là 600 và lọc 3 Hz.
  const webgl = await page.evaluate(() => window.__wct!.env!.snapshot().webgl)
  const pointMaxAgeMs =
    resolveHandDelegate(DEFAULTS.hands.delegate, webgl) === 'CPU'
      ? DEFAULTS.freshness.pointMaxAgeMsCpu
      : DEFAULTS.freshness.pointMaxAgeMs
  expect(st.settings).toEqual({
    cols: 64,
    rows: 36,
    showLines: true,
    mirror: true,
    windowSource: 'mouse',
    handednessSwap: false,
    fingers: [4, 8, 12, 16, 20],
    raisedOnly: true,
    sensitivity: {
      minCutoff: DEFAULTS.reveal.oneEuro.minCutoff,
      beta: 0.02,
      hysteresisCells: 0.25,
      nMin: 3,
      pointMaxAgeMs,
    },
  })
  expect(st.stageSize).toEqual({ w: size.w, h: size.h })
  const { c, board } = st.layout
  expect(c).toBe(Math.floor(Math.min(size.w / 64, size.h / 36)))
  expect(board).toEqual({
    x: Math.floor((size.w - 64 * c) / 2),
    y: Math.floor((size.h - 36 * c) / 2),
    w: 64 * c,
    h: 36 * c,
  })
  // Chưa có camera: layout dùng camera mặc định 1280 × 720.
  expect(st.camSize).toBeNull()
  expect(st.layout.cam).toEqual({ w: 1280, h: 720 })

  // Vạch dọc đầu tiên bên trong bảng là xám; tâm ô bên cạnh là trắng; ngoài bảng (nếu có đệm) là trắng.
  const half = Math.floor(c / 2)
  expect(await samplePixel(page, board.x + c, board.y + half)).toEqual(GRID_GRAY)
  expect(await samplePixel(page, board.x + half, board.y + half)).toEqual(WHITE)
  expect(await samplePixel(page, board.x, board.y)).toEqual(GRID_GRAY)
  await expectCanvasWhite(page)

  const e0 = st.epoch
  await page.getByLabel('Vạch lưới').uncheck()
  await expect.poll(async () => (await readStage(page)).settings.showLines).toBe(false)
  expect(await samplePixel(page, board.x + c, board.y + half)).toEqual(WHITE)
  await expectCanvasWhite(page, true)
  expect((await readStage(page)).epoch).toBe(e0)
})

test('preset, custom có giới hạn và mirror: layout tính lại, epoch tăng', async ({ page }) => {
  await openStage(page)
  const st0 = await readStage(page)
  const size = await canvasSize(page)

  await page.getByLabel('Lưới', { exact: true }).selectOption('0')
  await expect.poll(async () => (await readStage(page)).settings.cols).toBe(32)
  const st1 = await readStage(page)
  expect(st1.settings.rows).toBe(18)
  expect(st1.layout.c).toBe(Math.floor(Math.min(size.w / 32, size.h / 18)))
  expect(st1.epoch).toBe(st0.epoch + 1)

  await page.getByLabel('Số cột').fill('1000')
  await expect.poll(async () => (await readStage(page)).settings.cols).toBe(256)
  await page.getByLabel('Số hàng').fill('10')
  await expect.poll(async () => (await readStage(page)).settings.rows).toBe(10)
  const st2 = await readStage(page)
  expect(st2.layout.c).toBe(Math.floor(Math.min(size.w / 256, size.h / 10)))
  expect(st2.layout.board.w).toBe(256 * st2.layout.c)
  expect(st2.epoch).toBeGreaterThan(st1.epoch)
  await expect(page.getByLabel('Lưới', { exact: true })).toHaveValue('custom')

  await page.getByLabel('Mirror').uncheck()
  await expect.poll(async () => (await readStage(page)).settings.mirror).toBe(false)
  expect((await readStage(page)).epoch).toBe(st2.epoch + 1)
  await expectCanvasWhite(page)
})

test('đổi kích thước cửa sổ: canvas và layout tính lại, epoch tăng', async ({ page }) => {
  await openStage(page)
  const st0 = await readStage(page)
  await page.setViewportSize({ width: 900, height: 700 })
  await expect.poll(async () => (await readStage(page)).stageSize.w).not.toBe(st0.stageSize.w)
  const st1 = await readStage(page)
  const size = await canvasSize(page)
  expect(st1.stageSize).toEqual({ w: size.w, h: size.h })
  expect(st1.layout.c).toBe(Math.floor(Math.min(size.w / 64, size.h / 36)))
  expect(st1.epoch).toBeGreaterThan(st0.epoch)
  await expectCanvasWhite(page)
})
