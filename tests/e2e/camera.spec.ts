import { expect, test, type Page } from '@playwright/test'
import {
  APP_URL,
  expectCanvasWhite,
  gumCalls,
  installGumCounter,
  openApp,
  readCamera,
  readProbe,
  seedConsent,
  watchApiLikeRequests,
} from './helpers'

// CAM-01 với camera giả của Chromium (mục 7.5). Canvas không bao giờ vẽ video ở lớp này (I4); mọi getUserMedia đi qua
// cổng trong CameraSource.start() (I10, D-025). Probe window.__wct.camera do src/debug/cameraProbe.ts cài.
const VIDEO = 'video[data-wct-camera]'

async function openAppWithConsent(page: Page): Promise<void> {
  await seedConsent(page)
  await openApp(page)
  await expect(page).toHaveURL(APP_URL)
  await expect(page.locator('canvas#stage')).toBeVisible()
}

async function startCamera(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Bật camera' }).click()
  // Khi cả bộ chạy song song (mọi trang nạp wasm worker mặt), camera giả có thể mất hơn 5 s để cấp stream.
  await expect(page.getByRole('status')).toHaveText(/Camera đang chạy/, { timeout: 15_000 })
}

test('bật camera giả: getUserMedia một lần sau khi bấm, video ẩn, canvas vẫn trắng, frameId liên tục', async ({
  page,
}) => {
  await installGumCounter(page)
  const requests = watchApiLikeRequests(page)
  await openAppWithConsent(page)
  expect(await gumCalls(page)).toBe(0)

  await startCamera(page)
  expect(await gumCalls(page)).toBe(1)
  const video = page.locator(VIDEO)
  await expect(video).toHaveCount(1)
  expect(await video.evaluate((v) => getComputedStyle(v).opacity)).toBe('0')

  await page.waitForFunction(() => (window.__wct?.camera?.probe.frames ?? 0) >= 20)
  const probe = await readProbe(page)
  expect(probe.gaps).toBe(0)
  expect(probe.duplicates).toBe(0)
  expect(probe.lastFrameId).toBe(probe.frames - 1)
  // fps ổn định đo giữa hai lần đọc cách nhau 1 s (không tính giai đoạn khởi động, chậm khi cả bộ e2e chạy song song
  // với các worker mặt và tay đang nạp model).
  const p1 = await readProbe(page)
  await page.waitForTimeout(1000)
  const p2 = await readProbe(page)
  expect(p2.frames).toBeGreaterThan(p1.frames)
  expect(((p2.frames - p1.frames) * 1000) / (p2.lastTs - p1.lastTs)).toBeGreaterThan(5)
  await expectCanvasWhite(page)

  const snap = await readCamera(page)
  expect(snap.state.status).toBe('active')
  expect(snap.stalled).toBe(false)
  expect(snap.devices.length).toBeGreaterThanOrEqual(1)

  await page.getByRole('button', { name: 'Dừng camera' }).click()
  await expect(page.getByRole('status')).toHaveText('Camera chưa bật.')
  expect((await readCamera(page)).state.status).toBe('idle')
  await expectCanvasWhite(page)
  expect(requests).toEqual([])
})

test('từ chối quyền: báo lỗi, canvas trắng, bấm lại thì thử lại', async ({ page }) => {
  await installGumCounter(page, 'deny')
  await openAppWithConsent(page)
  await page.getByRole('button', { name: 'Bật camera' }).click()
  await expect(page.getByRole('status')).toHaveText(/từ chối quyền camera/)
  expect(await gumCalls(page)).toBe(1)
  expect((await readCamera(page)).state.status).toBe('error')
  await expect(page.locator('video')).toHaveCount(0)
  await expectCanvasWhite(page)

  await page.getByRole('button', { name: 'Bật camera' }).click()
  await expect.poll(() => gumCalls(page)).toBe(2)
  await expect(page.getByRole('status')).toHaveText(/từ chối quyền camera/)
})

test('track kết thúc (rút camera): về ended, canvas trắng, bật lại được', async ({ page }) => {
  await installGumCounter(page)
  await openAppWithConsent(page)
  await startCamera(page)
  await page.evaluate((sel) => {
    const v = document.querySelector<HTMLVideoElement>(sel)!
    const track = (v.srcObject as MediaStream).getVideoTracks()[0]
    track.dispatchEvent(new Event('ended'))
  }, VIDEO)
  await expect(page.getByRole('status')).toHaveText(/Camera đã dừng/)
  expect((await readCamera(page)).state).toEqual({ status: 'ended', reason: 'track-ended' })
  await expectCanvasWhite(page)

  await startCamera(page)
  expect(await gumCalls(page)).toBe(2)
})

test('watchdog báo khi video ngừng cấp frame; đổi camera tăng epoch và frameId không trùng', async ({
  page,
}) => {
  await installGumCounter(page)
  await openAppWithConsent(page)
  await startCamera(page)
  // Chờ video thật sự phát (có frame) rồi mới pause: pause trong lúc play() còn chờ có thể bị autoplay phát lại.
  await page.waitForFunction(() => (window.__wct?.camera?.probe.frames ?? 0) >= 5)

  await page.evaluate((sel) => document.querySelector<HTMLVideoElement>(sel)!.pause(), VIDEO)
  await expect(page.getByRole('status')).toHaveText(/không cấp frame/, { timeout: 3000 })
  expect((await readCamera(page)).stalled).toBe(true)
  await page.evaluate((sel) => document.querySelector<HTMLVideoElement>(sel)!.play(), VIDEO)
  await expect(page.getByRole('status')).toHaveText(/Camera đang chạy/)

  await page.waitForFunction(() => (window.__wct?.camera?.probe.frames ?? 0) >= 10)
  const before = await readCamera(page)
  const probeBefore = await readProbe(page)
  expect(before.devices.length).toBeGreaterThanOrEqual(2)
  const other = before.devices.find((d) => d.deviceId !== before.state.deviceId)!
  await page.getByLabel('Chọn camera').selectOption(other.deviceId)
  await page.getByRole('button', { name: 'Đổi camera' }).click()
  await expect(page.getByRole('status')).toHaveText(/Camera đang chạy/)
  expect(await gumCalls(page)).toBe(2)

  await page.waitForFunction(
    (n) => (window.__wct?.camera?.probe.frames ?? 0) >= n,
    probeBefore.frames + 10,
  )
  const after = await readCamera(page)
  const probeAfter = await readProbe(page)
  expect(after.state.deviceId).toBe(other.deviceId)
  expect(after.epoch).toBeGreaterThan(before.epoch)
  expect(probeAfter.lastFrameId).toBeGreaterThan(probeBefore.lastFrameId)
  expect(probeAfter.gaps).toBe(0)
  expect(probeAfter.duplicates).toBe(0)
  await expectCanvasWhite(page)
})
