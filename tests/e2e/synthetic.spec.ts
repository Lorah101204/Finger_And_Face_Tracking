import { expect, test, type Page } from '@playwright/test'
import {
  GRID_GRAY,
  WHITE,
  expectCanvasWhite,
  expectGateClean,
  gumCalls,
  installGateAudit,
  installGumCounter,
  openApp,
  readLoop,
  readStage,
  samplePixel,
  seedConsent,
  startFakeCamera,
} from './helpers'

// TEST-00 (mục 7.9): nguồn camera tổng hợp qua #/app?debug=1&source=synthetic, kịch bản window.__scenario, probe
// window.__wct.probes. Cảnh mặc định: nửa trái camera xanh lá (0,255,0), nửa phải magenta (255,0,255); mirror bật nên
// nửa phải bảng xanh lá. Màu tuyệt đối kiểm được vì vùng màu đặc, lấy mẫu cách mép ô ít nhất một ô.
const GREEN = [0, 255, 0, 255]
const MAGENTA = [255, 0, 255, 255]

async function openSynthetic(page: Page) {
  await installGumCounter(page)
  await seedConsent(page)
  await openApp(page, '?debug=1&source=synthetic')
  await expect(page.locator('canvas#stage')).toBeVisible()
  const st = await readStage(page)
  await installGateAudit(page)
  return st
}

async function waitLoopFrames(page: Page, n = 2): Promise<void> {
  const f0 = (await readLoop(page)).frames
  await page.waitForFunction((t) => (window.__wct?.loop?.snapshot().frames ?? 0) >= t, f0 + n)
}

async function run(page: Page, command: string): Promise<unknown> {
  return page.evaluate((cmd) => window.__scenario!.run(cmd), command)
}

/** 9 điểm bên trong cửa sổ, cách mép ít nhất một ô. */
async function innerSamples(page: Page, c: number): Promise<number[][]> {
  const r = (await readLoop(page)).mask!.stageRect
  const out: number[][] = []
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      const x = r.x + c + Math.floor(((r.w - 2 * c) * i) / 2) + (i === 2 ? -1 : 0)
      const y = r.y + c + Math.floor(((r.h - 2 * c) * j) / 2) + (j === 2 ? -1 : 0)
      out.push(await samplePixel(page, x, y))
    }
  return out
}

test('nguồn tổng hợp: không gọi camera thật; cửa sổ bên phải xanh lá, bên trái magenta; tắt mirror thì đảo; đóng thì trắng', async ({
  page,
}) => {
  const st = await openSynthetic(page)
  const { c, cols } = st.layout
  expect(st.camSize).toEqual({ w: 1280, h: 720 })
  expect(await gumCalls(page)).toBe(0)
  await expect(page.getByRole('button', { name: 'Bật camera' })).toBeDisabled()
  await expect(page.getByRole('status')).toHaveText(/tổng hợp/)
  expect(await page.evaluate(() => window.__scenario!.list())).toEqual([
    'coverAll',
    'windowAt',
    'moveWindow',
    'resizeWindow',
    'fingers',
    'raisedOnly',
    'logo',
    'delayWorker',
    'faceMaxAge',
  ])
  await expectCanvasWhite(page)

  // Cửa sổ ở nửa phải bảng (mirror bật): thấy vùng "người" xanh lá.
  expect(await run(page, `windowAt(${cols - 10},10,8)`)).toEqual({ col: cols - 10, row: 10, n: 8 })
  await expect.poll(async () => (await readLoop(page)).mask?.shape.window.col).toBe(cols - 10)
  await waitLoopFrames(page, 2)
  for (const px of await innerSamples(page, c)) expect(px).toEqual(GREEN)
  const r1 = (await readLoop(page)).mask!.stageRect
  expect([WHITE, GRID_GRAY]).toContainEqual(await samplePixel(page, r1.x - 3, r1.y + (r1.h >> 1)))

  // Dời sang nửa trái: magenta; vị trí cũ trắng ngay.
  expect(await run(page, 'moveWindow(2,10)')).toEqual({ col: 2, row: 10 })
  await expect.poll(async () => (await readLoop(page)).mask?.shape.window.col).toBe(2)
  await waitLoopFrames(page, 2)
  for (const px of await innerSamples(page, c)) expect(px).toEqual(MAGENTA)
  expect([WHITE, GRID_GRAY]).toContainEqual(
    await samplePixel(page, r1.x + (r1.w >> 1) + 1, r1.y + (r1.h >> 1) + 1),
  )

  // Tắt mirror: cùng cửa sổ bên trái giờ thấy xanh lá.
  await page.getByLabel('Mirror').uncheck()
  await expect.poll(async () => (await readStage(page)).settings.mirror).toBe(false)
  await expect.poll(async () => (await readLoop(page)).reveal.kind).toBe('open')
  await waitLoopFrames(page, 2)
  for (const px of await innerSamples(page, c)) expect(px).toEqual(GREEN)

  // Đổi cỡ bằng kịch bản rồi đóng: toàn bộ trắng.
  expect(await run(page, 'resizeWindow(5)')).toEqual({ n: 5 })
  await expect.poll(async () => (await readLoop(page)).mask?.shape.window.n).toBe(5)
  expect(await run(page, 'coverAll')).toBeNull()
  await expect.poll(async () => (await readLoop(page)).reveal.kind).toBe('closed')
  await waitLoopFrames(page, 2)
  await expectCanvasWhite(page, false)
  await expectGateClean(page)
})

test('probe onOutputFrame nhận ImageData toàn canvas theo nhịp; delayWorker ghi vào probes; cảnh đổi được', async ({
  page,
}) => {
  await openSynthetic(page)
  const enabled = await page.evaluate(() => window.__wct!.probes!.enabled)
  expect(enabled).toBe(true)
  await page.evaluate(() => {
    window.__outCount = 0
    window.__wct!.probes!.onOutputFrame((img) => {
      window.__outCount = (window.__outCount ?? 0) + 1
      window.__outSize = [img.width, img.height]
    })
  })
  await page.waitForFunction(() => (window.__outCount ?? 0) >= 3)
  const size = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('canvas#stage')!
    return {
      out: window.__outSize,
      canvas: [c.width, c.height],
      counters: window.__wct!.probes!.counters,
    }
  })
  expect(size.out).toEqual(size.canvas)
  expect(size.counters.outputFrames).toBeGreaterThanOrEqual(3)
  expect(size.counters.faceDetectSubmitted).toBe(0)

  expect(await run(page, 'delayWorker(500)')).toEqual({ workerDelayMs: 500 })
  const scene = await page.evaluate(() =>
    window.__scenario!.scene({
      person: { x: 0, y: 0, w: 1280, h: 720, color: '#00ff00', vx: 0, vy: 0 },
    }),
  )
  expect(scene).toMatchObject({ width: 1280, height: 720, person: { w: 1280 } })
  await run(page, 'windowAt(2,10,6)')
  await expect.poll(async () => (await readLoop(page)).reveal.kind).toBe('open')
  await waitLoopFrames(page, 3)
  const st = await readStage(page)
  for (const px of await innerSamples(page, st.layout.c)) expect(px).toEqual(GREEN)
  await expectGateClean(page, 0)
})

test('?debug=1 không có source: camera thật vẫn là nguồn, probe bật, kịch bản có sẵn', async ({
  page,
}) => {
  await installGumCounter(page)
  await seedConsent(page)
  await openApp(page, '?debug=1')
  await expect(page.locator('canvas#stage')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Bật camera' })).toBeEnabled()
  expect(await page.evaluate(() => window.__wct!.probes!.enabled)).toBe(true)
  expect(await page.evaluate(() => window.__scenario!.scene())).toBeNull()
  // INT-01: chưa bật camera thì cửa sổ không mở (no-camera); bật camera giả rồi kịch bản mới mở được.
  await run(page, 'windowAt(4,4,4)')
  await expect
    .poll(async () => (await readLoop(page)).reveal)
    .toEqual({ kind: 'closed', reason: 'no-camera' })
  await startFakeCamera(page)
  await expect
    .poll(async () => (await readLoop(page)).mask?.shape.window, { timeout: 15_000 })
    .toEqual({ col: 4, row: 4, n: 4 })
})

test('không có ?debug=1: không có probe, không có kịch bản', async ({ page }) => {
  await installGumCounter(page)
  await seedConsent(page)
  await openApp(page)
  await expect(page.locator('canvas#stage')).toBeVisible()
  expect(await page.evaluate(() => window.__wct?.probes ?? null)).toBeNull()
  expect(await page.evaluate(() => window.__scenario ?? null)).toBeNull()
})
