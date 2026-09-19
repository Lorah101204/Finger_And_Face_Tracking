import { expect, test, type Page } from '@playwright/test'

// WEB-00: trang chào không gọi getUserMedia (I10); sau đồng ý mới vào /app với canvas trắng (I4).
declare global {
  interface Window {
    __gumCalls: number
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__gumCalls = 0
    const md = navigator.mediaDevices
    if (md) {
      const orig = md.getUserMedia.bind(md)
      md.getUserMedia = (c) => {
        window.__gumCalls++
        return orig(c)
      }
    }
  })
})

async function gumCalls(page: Page): Promise<number> {
  return page.evaluate(() => window.__gumCalls)
}

test('trang chào không gọi getUserMedia; sau đồng ý mới vào /app với canvas trắng', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Web Camera Tracking' })).toBeVisible()
  await expect(page.locator('video')).toHaveCount(0)
  const start = page.getByRole('button', { name: 'Bắt đầu' })
  await expect(start).toBeDisabled()
  await page.getByLabel('Tên hiển thị (tùy chọn)').fill('Khách e2e')
  await page.getByRole('checkbox').check()
  await expect(start).toBeEnabled()
  expect(await gumCalls(page)).toBe(0)

  await start.click()
  await expect(page).toHaveURL(/\/app$/)
  await expect(page.getByText('Xin chào Khách e2e')).toBeVisible()
  const canvas = page.locator('canvas#stage')
  await expect(canvas).toBeVisible()
  await expect(page.locator('video')).toHaveCount(0)

  const samples = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('canvas#stage')
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return null
    const pts = [
      [0, 0],
      [c.width - 1, 0],
      [0, c.height - 1],
      [c.width - 1, c.height - 1],
      [Math.floor(c.width / 2), Math.floor(c.height / 2)],
    ]
    return pts.map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data))
  })
  expect(samples).not.toBeNull()
  for (const px of samples ?? []) expect(px).toEqual([255, 255, 255, 255])

  // Cổng camera mở nhưng CAM-01 chưa nối getUserMedia: số lần gọi vẫn bằng 0.
  await page.getByRole('button', { name: 'Bật camera' }).click()
  await expect(page.getByText('Cổng camera đã mở')).toBeVisible()
  expect(await gumCalls(page)).toBe(0)
})

test('chưa đồng ý mà mở /app thì về trang chào', async ({ page }) => {
  await page.goto('/app')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: 'Web Camera Tracking' })).toBeVisible()
  expect(await gumCalls(page)).toBe(0)
})
