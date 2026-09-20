import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  expectGateClean,
  installGateAudit,
  installGumCounter,
  note,
  openApp,
  readStage,
  seedConsent,
} from './helpers'

// UX-04 (mục 7.30, D-053): lớp hướng dẫn gọn: thẻ đầy đủ nhỏ hơn bản UX-03, sau 6 s không đổi thông điệp thu còn một
// dòng (câu chi tiết vẫn trong DOM), đổi thông điệp thì mở lại; tone lỗi không thu; chế độ trong mục Giao diện (Tự thu
// gọn, Luôn đầy đủ, Ẩn) giữ qua tải lại; bản HUD (trình diễn) cũng thu gọn.
async function openSynthetic(page: Page) {
  await installGumCounter(page)
  await seedConsent(page)
  await openApp(page, '?debug=1&source=synthetic')
  await expect(page.locator('canvas#stage')).toBeVisible()
  await installGateAudit(page)
  return readStage(page)
}

async function box(l: Locator): Promise<{ w: number; h: number }> {
  const b = (await l.boundingBox())!
  return { w: Math.round(b.width), h: Math.round(b.height) }
}

test('thẻ hướng dẫn gọn: đầy đủ ≤ 500 × 120 px, thu còn một dòng sau 6 s (chi tiết vẫn trong DOM), mở lại khi thông điệp đổi, không nhận chuột', async ({
  page,
}) => {
  await openSynthetic(page)
  const guide = page.getByTestId('guide')
  await expect(guide).toHaveAttribute('data-step', '2')
  await expect(guide).toHaveAttribute('data-collapsed', '0')
  const full = await box(guide)
  expect(full.w).toBeLessThanOrEqual(500)
  expect(full.h).toBeLessThanOrEqual(120)
  await expect(page.getByTestId('guide-detail')).toBeVisible()
  await expect(page.getByTestId('guide-keys')).toBeVisible()
  // Chỉ bước hiện tại ghi nhãn; bước khác là chấm số.
  await expect(guide.locator('.steps li.current .label')).toBeVisible()
  await expect(guide.locator('.steps li:not(.current) .label').first()).toBeHidden()
  expect(await guide.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none')

  await expect(guide).toHaveAttribute('data-collapsed', '1', { timeout: 10_000 })
  const collapsed = await box(guide)
  expect(collapsed.h).toBeLessThanOrEqual(40)
  expect(collapsed.w).toBeLessThan(full.w)
  // Câu chi tiết và gợi ý phím ẩn bằng CSS nhưng vẫn trong DOM (e2e và trình đọc màn hình đọc được).
  await expect(page.getByTestId('guide-detail')).toBeHidden()
  await expect(page.getByTestId('guide-detail')).toHaveText(/Bấm hoặc kéo trên bảng/)
  await expect(page.getByTestId('guide-title')).toBeVisible()
  note(
    `thẻ hướng dẫn 1280 × 720: đầy đủ ${full.w} × ${full.h} px, thu gọn ${collapsed.w} × ${collapsed.h} px` +
      ` (UX-03: 480 × 146 và không thu gọn)`,
  )

  // Đổi thông điệp (mở cửa sổ → bước 3) thì thẻ mở lại đầy đủ rồi lại thu.
  await page.evaluate(() => window.__scenario!.run('windowAt(20,10,12)'))
  await expect(guide).toHaveAttribute('data-step', '3', { timeout: 10_000 })
  await expect(guide).toHaveAttribute('data-collapsed', '0')
  await expect(page.getByTestId('guide-detail')).toBeVisible()
  await expect(guide).toHaveAttribute('data-collapsed', '1', { timeout: 10_000 })
  await expectGateClean(page)
})

test('chế độ hướng dẫn trong mục Giao diện: Luôn đầy đủ không thu; Ẩn bỏ thẻ; giữ qua tải lại (sessionStorage); tone lỗi camera không thu gọn', async ({
  page,
}) => {
  await openSynthetic(page)
  const guide = page.getByTestId('guide')
  const mode = page.getByLabel('Hướng dẫn trên màn')
  await expect(mode).toHaveValue('auto')
  await mode.selectOption('full')
  await page.waitForTimeout(6500)
  await expect(guide).toHaveAttribute('data-collapsed', '0')
  await expect(page.getByTestId('guide-detail')).toBeVisible()
  await mode.selectOption('hidden')
  await expect(guide).toHaveCount(0)
  await page.reload()
  await expect(page.locator('canvas#stage')).toBeVisible()
  await expect(page.getByLabel('Hướng dẫn trên màn')).toHaveValue('hidden')
  await expect(page.getByTestId('guide')).toHaveCount(0)
  await page.getByLabel('Hướng dẫn trên màn').selectOption('auto')
  await expect(page.getByTestId('guide')).toHaveAttribute('data-collapsed', '0')

  // Tone lỗi (camera từ chối) giữ đầy đủ: mở trang camera thật với getUserMedia bị từ chối.
  await installGumCounter(page, 'deny')
  await openApp(page, '?debug=1')
  await page.getByRole('button', { name: 'Bật camera' }).click()
  const g = page.getByTestId('guide')
  await expect(g).toHaveAttribute('data-tone', 'error', { timeout: 10_000 })
  await page.waitForTimeout(6500)
  await expect(g).toHaveAttribute('data-collapsed', '0')
  await expect(page.getByTestId('guide-detail')).toBeVisible()
})

test('chế độ trình diễn: bản HUD cũng thu gọn còn một dòng và vẫn hiện khi các lớp nổi tự ẩn', async ({
  page,
}) => {
  await openSynthetic(page)
  await page.getByRole('button', { name: 'Trình diễn' }).click()
  const guide = page.getByTestId('guide')
  await expect(guide).toHaveClass(/\bhud\b/)
  const full = await box(guide)
  await expect(guide).toHaveAttribute('data-collapsed', '1', { timeout: 10_000 })
  const collapsed = await box(guide)
  expect(collapsed.h).toBeLessThanOrEqual(48)
  await expect(page.locator('.stage')).toHaveClass(/\bidle\b/, { timeout: 5000 })
  expect(await guide.evaluate((el) => getComputedStyle(el).opacity)).toBe('1')
  note(
    `HUD trình diễn 1280 × 720: đầy đủ ${full.w} × ${full.h} px, thu gọn ${collapsed.w} × ${collapsed.h} px (UX-03: 640 × 164)`,
  )
})
