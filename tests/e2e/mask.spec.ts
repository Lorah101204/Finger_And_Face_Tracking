import { expect, test, type Page } from '@playwright/test'
import {
  GRID_GRAY,
  WHITE,
  expectCanvasWhite,
  installGumCounter,
  note,
  openApp,
  readLoop,
  readStage,
  samplePixel,
  seedConsent,
} from './helpers'

// MASK-01 (mục 7.8) với camera giả của Chromium: pixel camera chỉ trong stageRect, nội dung khớp ánh xạ cameraRect →
// stageRect (có và không mirror), dời cửa sổ thì vị trí cũ trắng ngay, đóng thì toàn bộ trắng. Nguồn tổng hợp và probe
// buffer là việc của TEST-00; ở đây dừng video rồi so output với ảnh tham chiếu vẽ trong trang từ cùng cameraRect.
const VIDEO = 'video[data-wct-camera]'

type Compare = {
  maxDiff: number
  nonWhite: number
  samples: number
  outside: number[][]
  row: number[][]
  mirror: boolean
}

async function openWithCamera(page: Page): Promise<void> {
  await installGumCounter(page)
  await seedConsent(page)
  await openApp(page)
  await expect(page.locator('canvas#stage')).toBeVisible()
  await readStage(page)
  await page.getByRole('button', { name: 'Bật camera' }).click()
  await expect(page.getByRole('status')).toHaveText(/Camera đang chạy/)
  await page.waitForFunction(() => (window.__wct?.camera?.probe.frames ?? 0) >= 5)
}

/** Đợi vòng lặp vẽ thêm ít nhất n frame. */
async function waitLoopFrames(page: Page, n = 2): Promise<void> {
  const f0 = (await readLoop(page)).frames
  await page.waitForFunction((t) => (window.__wct?.loop?.snapshot().frames ?? 0) >= t, f0 + n)
}

async function openWindow(page: Page): Promise<void> {
  await page.keyboard.press('Space')
  await expect.poll(async () => (await readLoop(page)).reveal.kind).toBe('open')
  await waitLoopFrames(page, 2)
}

/**
 * Dừng video để frame đứng yên, rồi so canvas output với ảnh tham chiếu vẽ trong trang: cùng cameraRect → cùng cỡ
 * stageRect, cùng mirror. Lấy 25 điểm lưới 5 × 5 bên trong (chừa viền 2 px), 4 điểm ngay ngoài stageRect và một hàng
 * giữa để so trước và sau khi lật.
 */
async function compareWindow(page: Page): Promise<Compare | null> {
  return page.evaluate(async (sel) => {
    const v = document.querySelector<HTMLVideoElement>(sel)!
    // INT-01: dừng video, chờ vòng lặp vẽ hai frame và so ngay trong trang (không round-trip), rồi phát lại: quá
    // 500 ms không có frame thì watchdog đóng vùng với no-camera.
    v.pause()
    const f0 = window.__wct!.loop!.snapshot().frames
    while (window.__wct!.loop!.snapshot().frames < f0 + 2)
      await new Promise<number>((r) => requestAnimationFrame(r))
    try {
      const c = document.querySelector<HTMLCanvasElement>('canvas#stage')!
      const ctx = c.getContext('2d')!
      const { mask } = window.__wct!.loop!.snapshot()
      const { settings } = window.__wct!.stage!.snapshot()
      if (!mask) return null
      const s = mask.stageRect
      const r = mask.cameraRect
      const ref = document.createElement('canvas')
      ref.width = s.w
      ref.height = s.h
      const rc = ref.getContext('2d')!
      if (settings.mirror) {
        rc.translate(s.w, 0)
        rc.scale(-1, 1)
      }
      rc.drawImage(v, r.x, r.y, r.w, r.h, 0, 0, s.w, s.h)
      let maxDiff = 0
      let nonWhite = 0
      let samples = 0
      for (let i = 0; i < 5; i++)
        for (let j = 0; j < 5; j++) {
          const x = 3 + Math.floor(((s.w - 7) * i) / 4)
          const y = 3 + Math.floor(((s.h - 7) * j) / 4)
          const a = ctx.getImageData(s.x + x, s.y + y, 1, 1).data
          const b = rc.getImageData(x, y, 1, 1).data
          for (let k = 0; k < 3; k++) maxDiff = Math.max(maxDiff, Math.abs(a[k] - b[k]))
          if (a[0] < 250 || a[1] < 250 || a[2] < 250) nonWhite++
          samples++
        }
      const midY = s.y + (s.h >> 1)
      const outsidePts = [
        [s.x - 3, midY],
        [s.x + s.w + 2, midY],
        [s.x + (s.w >> 1), s.y - 3],
        [s.x + (s.w >> 1), s.y + s.h + 2],
      ]
      const outside = outsidePts.map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data))
      const row: number[][] = []
      for (let i = 0; i < 9; i++) {
        const x = s.x + 3 + Math.floor(((s.w - 7) * i) / 8)
        row.push(Array.from(ctx.getImageData(x, midY, 1, 1).data).slice(0, 3))
      }
      return { maxDiff, nonWhite, samples, outside, row, mirror: settings.mirror }
    } finally {
      void v.play()
    }
  }, VIDEO)
}

test('camera chạy, mở cửa sổ: pixel camera chỉ trong stageRect và khớp ánh xạ cameraRect → stageRect; tắt mirror thì lật', async ({
  page,
}) => {
  await openWithCamera(page)
  await expectCanvasWhite(page)
  await openWindow(page)

  const a = await compareWindow(page)
  expect(a).not.toBeNull()
  expect(a!.mirror).toBe(true)
  expect(a!.samples).toBe(25)
  expect(a!.maxDiff).toBeLessThanOrEqual(8)
  expect(a!.nonWhite).toBeGreaterThan(5)
  for (const px of a!.outside) expect([WHITE, GRID_GRAY]).toContainEqual(px)

  await page.getByLabel('Mirror').uncheck()
  await expect.poll(async () => (await readStage(page)).settings.mirror).toBe(false)
  await expect.poll(async () => (await readLoop(page)).reveal.kind).toBe('open')
  const b = await compareWindow(page)
  expect(b).not.toBeNull()
  expect(b!.mirror).toBe(false)
  expect(b!.maxDiff).toBeLessThanOrEqual(8)
  for (const px of b!.outside) expect([WHITE, GRID_GRAY]).toContainEqual(px)
  // Việc lật thật sự đổi nội dung được kiểm tất định ở synthetic.spec.ts (nửa trái, nửa phải khác màu); frame của
  // camera giả có thể đối xứng theo hàng nên không so hàng giữa trước và sau ở đây.

  // QA-01 (mục 7.1 "đổi grid"): đổi lưới khi đang mở → đóng config-changed rồi mở lại với epoch mới (store + mở lại);
  // pixel trong cửa sổ vẫn khớp ánh xạ cameraRect → stageRect của layout mới, ngoài cửa sổ vẫn trắng.
  const eBefore = (await readLoop(page)).epoch
  await page.getByLabel('Lưới', { exact: true }).selectOption('0')
  await expect.poll(async () => (await readStage(page)).settings.cols).toBe(32)
  await expect.poll(async () => (await readLoop(page)).epoch).toBeGreaterThanOrEqual(eBefore + 2)
  await expect.poll(async () => (await readLoop(page)).reveal.kind).toBe('open')
  const g = await compareWindow(page)
  expect(g).not.toBeNull()
  expect(g!.maxDiff).toBeLessThanOrEqual(8)
  expect(g!.nonWhite).toBeGreaterThan(5)
  for (const px of g!.outside) expect([WHITE, GRID_GRAY]).toContainEqual(px)
  note(
    `mirror bật: maxDiff ${a!.maxDiff}/255 trên 25 điểm, ${a!.nonWhite} điểm có video; mirror tắt: maxDiff ${b!.maxDiff};` +
      ` lưới 32 × 18: maxDiff ${g!.maxDiff}, epoch ${eBefore} → ${(await readLoop(page)).epoch}; 4 điểm ngoài trắng`,
  )
})

test('dời cửa sổ thì vị trí cũ trắng ngay; đóng thì toàn bộ trắng', async ({ page }) => {
  await openWithCamera(page)
  await openWindow(page)
  const st = await readStage(page)
  const { c, board } = st.layout
  const r1 = (await readLoop(page)).mask!.stageRect

  // Kéo từ tâm cửa sổ tới gần góc trên trái bảng (không chồng vị trí cũ).
  const canvas = page.locator('canvas#stage')
  const box = (await canvas.boundingBox())!
  const size = await canvas.evaluate((el: HTMLCanvasElement) => ({ w: el.width, h: el.height }))
  const css = (x: number, y: number) => ({
    x: box.x + (x * box.width) / size.w,
    y: box.y + (y * box.height) / size.h,
  })
  const from = css(r1.x + r1.w / 2, r1.y + r1.h / 2)
  const to = css(board.x + 6 * c, board.y + 6 * c)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 4 })
  await page.mouse.up()
  await expect.poll(async () => (await readLoop(page)).mask?.shape.window.col).toBe(2)
  await waitLoopFrames(page, 2)
  const r2 = (await readLoop(page)).mask!.stageRect
  expect(r2.x + r2.w).toBeLessThanOrEqual(r1.x)

  // Vị trí cũ: các điểm bên trong rect cũ (chừa viền) phải trắng hoặc vạch lưới.
  const half = Math.floor(c / 2)
  for (const [x, y] of [
    [r1.x + half, r1.y + half],
    [r1.x + r1.w - half, r1.y + half],
    [r1.x + half, r1.y + r1.h - half],
    [r1.x + r1.w - half, r1.y + r1.h - half],
    [r1.x + (r1.w >> 1) + 1, r1.y + (r1.h >> 1) + 1],
  ]) {
    expect([WHITE, GRID_GRAY]).toContainEqual(await samplePixel(page, x, y))
  }

  await page.keyboard.press('Escape')
  await expect.poll(async () => (await readLoop(page)).reveal.kind).toBe('closed')
  await waitLoopFrames(page, 2)
  for (const [x, y] of [
    [r2.x + half, r2.y + half],
    [r2.x + r2.w - half, r2.y + r2.h - half],
  ]) {
    expect([WHITE, GRID_GRAY]).toContainEqual(await samplePixel(page, x, y))
  }
  await expectCanvasWhite(page)
})
