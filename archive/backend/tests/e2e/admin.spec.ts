import { expect, test } from '@playwright/test'

// ADM-01: admin đăng nhập và thấy phiên vừa tạo với tên hiển thị. Mật khẩu đặt trong playwright.config.ts (env của API).
test('admin đăng nhập và thấy phiên khách vừa đồng ý', async ({ browser, page }) => {
  const visitor = await browser.newContext()
  const vp = await visitor.newPage()
  await vp.goto('/')
  await vp.getByLabel('Tên hiển thị (tùy chọn)').fill('Khách admin-e2e')
  await vp.getByRole('checkbox').check()
  await vp.getByRole('button', { name: 'Bắt đầu' }).click()
  await expect(vp).toHaveURL(/\/app$/)
  await visitor.close()

  await page.goto('/admin')
  await page.getByLabel('Tài khoản').fill('admin')
  await page.getByLabel('Mật khẩu').fill('e2e-password-123')
  await page.getByRole('button', { name: 'Đăng nhập' }).click()
  await expect(page.getByRole('heading', { name: 'Nhật ký người vào web' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Khách admin-e2e' }).first()).toBeVisible()

  await page.getByRole('cell', { name: 'Khách admin-e2e' }).first().click()
  await expect(page.getByRole('cell', { name: 'consent' }).first()).toBeVisible()
})

test('sai mật khẩu thì báo lỗi, không vào được', async ({ page }) => {
  await page.goto('/admin')
  await page.getByLabel('Tài khoản').fill('admin')
  await page.getByLabel('Mật khẩu').fill('sai-mat-khau')
  await page.getByRole('button', { name: 'Đăng nhập' }).click()
  await expect(page.getByText('Sai tài khoản hoặc mật khẩu.')).toBeVisible()
})
