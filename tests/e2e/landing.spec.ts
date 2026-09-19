import { expect, test } from '@playwright/test'
import {
  APP_URL,
  CONSENT_KEY,
  CONSENT_VERSION,
  LANDING_URL,
  expectCanvasWhite,
  gumCalls,
  installGumCounter,
  openApp,
  seedConsent,
  watchApiLikeRequests,
} from './helpers'

// WEB-00: trang chào không gọi getUserMedia (I10); sau đồng ý mới vào #/app với canvas trắng (I4);
// không có yêu cầu mạng nào ngoài tài nguyên tĩnh của dev server (I9, D-019). Định tuyến hash (D-020).
test.beforeEach(async ({ page }) => {
  await installGumCounter(page)
})

test('trang chào không gọi getUserMedia; sau đồng ý mới vào #/app với canvas trắng; không gọi mạng', async ({
  page,
}) => {
  const requests = watchApiLikeRequests(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Web Camera Tracking' })).toBeVisible()
  await expect(page.locator('video')).toHaveCount(0)
  const start = page.getByRole('button', { name: 'Bắt đầu' })
  await expect(start).toBeDisabled()
  await page.getByRole('checkbox').check()
  await expect(start).toBeEnabled()
  expect(await gumCalls(page)).toBe(0)

  await start.click()
  await expect(page).toHaveURL(APP_URL)
  await expect(page.locator('canvas#stage')).toBeVisible()
  await expect(page.locator('video')).toHaveCount(0)
  await expectCanvasWhite(page)

  // Ở #/app, trước khi bấm Bật camera vẫn chưa có lần gọi getUserMedia nào (I10). Bật camera thật: camera.spec.ts.
  await expect(page.getByRole('button', { name: 'Bật camera' })).toBeEnabled()
  await expect(page.getByRole('status')).toHaveText('Camera chưa bật.')
  expect(await gumCalls(page)).toBe(0)

  // Đồng ý được lưu trong trình duyệt: tải lại #/app vẫn ở lại.
  expect(await page.evaluate((k) => localStorage.getItem(k), CONSENT_KEY)).toBe(CONSENT_VERSION)
  await page.reload()
  await expect(page).toHaveURL(APP_URL)
  await expect(page.locator('canvas#stage')).toBeVisible()

  expect(requests).toEqual([])
})

test('chưa đồng ý mà mở #/app thì về trang chào', async ({ page }) => {
  await openApp(page)
  await expect(page).toHaveURL(LANDING_URL)
  await expect(page.getByRole('heading', { name: 'Web Camera Tracking' })).toBeVisible()
  expect(await gumCalls(page)).toBe(0)
})

test('đồng ý phiên bản cũ không còn hiệu lực', async ({ page }) => {
  await seedConsent(page, '2000-01-01')
  await openApp(page)
  await expect(page).toHaveURL(LANDING_URL)
  await expect(page.getByRole('button', { name: 'Bắt đầu' })).toBeDisabled()
})

test('thu hồi đồng ý thì về trang chào và không vào lại được #/app', async ({ page }) => {
  await seedConsent(page)
  await openApp(page)
  await expect(page.locator('canvas#stage')).toBeVisible()
  await page.getByRole('button', { name: 'Thu hồi đồng ý' }).click()
  await expect(page).toHaveURL(LANDING_URL)
  expect(await page.evaluate((k) => localStorage.getItem(k), CONSENT_KEY)).toBeNull()
  await openApp(page)
  await expect(page).toHaveURL(LANDING_URL)
})
