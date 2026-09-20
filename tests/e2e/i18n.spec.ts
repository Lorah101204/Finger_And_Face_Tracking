import { expect, test } from '@playwright/test'
import {
  expectGateClean,
  installGateAudit,
  installGumCounter,
  note,
  openApp,
  seedConsent,
  watchApiLikeRequests,
} from './helpers'

// I18N-01 (mục 7.31, D-054): tùy chọn tiếng Anh cho toàn bộ giao diện. Mặc định tiếng Việt (mọi spec khác giữ nguyên);
// nút Tiếng Việt | English trên trang chào và mục Giao diện của cột cài đặt; lựa chọn lưu localStorage `wct.lang`, giữ
// qua tải lại và qua trang; `?lang=en` trên URL đi trước; <html lang> và nhãn vẽ trên canvas đổi theo; không có yêu
// cầu mạng nào thêm (từ điển nằm trong bundle).
const VI_DIACRITICS = /[ăâđêôơưàảãáạằẳẵắặầẩẫấậèẻẽéẹềểễếệìỉĩíịòỏõóọồổỗốộờởỡớợùủũúụừửữứựỳỷỹýỵ]/i

test('trang chào: mặc định tiếng Việt, bấm English đổi toàn trang và <html lang>, giữ qua tải lại; sân khấu theo cùng lựa chọn; đổi lại Tiếng Việt', async ({
  page,
}) => {
  const requests = watchApiLikeRequests(page)
  await installGumCounter(page)
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('lang', 'vi')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Web Camera Tracking')
  await expect(page.getByRole('button', { name: 'Bắt đầu' })).toBeVisible()
  const sw = page.getByTestId('lang-switch')
  await expect(sw.getByRole('button', { name: 'Tiếng Việt' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  await sw.getByRole('button', { name: 'English' }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.getByRole('button', { name: 'Start' })).toBeVisible()
  await expect(page.locator('main.landing .lead')).toHaveText(/A white screen split into cells/)
  await expect(page.locator('main.landing .pledges li').first()).toHaveText(
    /processed right in the browser/,
  )
  await expect(page.locator('main.landing figcaption')).toHaveText(/convex hull/)
  const copy = await page.locator('main.landing .landing-copy').innerText()
  expect(copy).not.toMatch(VI_DIACRITICS)
  expect(await page.evaluate(() => localStorage.getItem('wct.lang'))).toBe('en')

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.getByRole('button', { name: 'Start' })).toBeVisible()

  // Đồng ý bằng giao diện tiếng Anh rồi vào sân khấu.
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page).toHaveURL(/#\/app$/)
  await expect(page.getByRole('button', { name: 'Start camera' })).toBeVisible()
  await expect(page.getByRole('status')).toHaveText('Camera is off.')
  await expect(page.getByTestId('guide-title')).toHaveText('Turn on the camera to begin')
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible()
  await expect(page.getByLabel('Window source')).toHaveValue('mouse')
  await expect(page.getByLabel('Window source').locator('option[value="hands"]')).toHaveText(
    'Hands',
  )
  await expect(page.getByLabel('Grid', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Write local log')).toBeVisible()
  await expect(page.getByLabel('Capture data')).toBeVisible()
  const settings = await page.getByTestId('settings-panel').innerText()
  expect(settings.replace(/Tiếng Việt/g, '')).not.toMatch(VI_DIACRITICS)
  const bar = await page.locator('.bar.top').innerText()
  expect(bar).not.toMatch(VI_DIACRITICS)

  // Nguồn tay: chip đầu ngón và độ nhạy tiếng Anh; hướng dẫn tiếng Anh nêu tên ngón tiếng Anh.
  await page.getByLabel('Window source').selectOption('hands')
  await expect(page.getByLabel('Thumb finger')).toBeVisible()
  await expect(page.getByLabel('Point age')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reset sensitivity' })).toBeVisible()

  // Đổi lại tiếng Việt trong mục Giao diện: mọi nhãn cũ trở lại (các spec khác dựa vào chúng).
  await page.getByTestId('lang-switch').getByRole('button', { name: 'Tiếng Việt' }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'vi')
  await expect(page.getByRole('button', { name: 'Bật camera' })).toBeVisible()
  await expect(page.getByLabel('Nguồn cửa sổ')).toHaveValue('hands')
  await expect(page.getByLabel('Ngón cái')).toBeVisible()
  await expect(page.getByTestId('guide-title')).toHaveText('Bật camera để bắt đầu')
  expect(await page.evaluate(() => localStorage.getItem('wct.lang'))).toBe('vi')
  expect(requests).toEqual([])
  note(
    'tiếng Anh: trang chào, thanh trên, cột cài đặt (7 mục), hướng dẫn, chip đầu ngón; không yêu cầu mạng thêm',
  )
})

test('?lang=en trên URL đi trước giá trị đã lưu; hướng dẫn và nhãn phân loại vẽ trên canvas theo tiếng Anh với nguồn tổng hợp; đổi ngôn ngữ giữa chừng cập nhật ngay', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await installGumCounter(page)
  await seedConsent(page)
  await page.evaluate(() => localStorage.setItem('wct.lang', 'vi'))
  await openApp(page, '?debug=1&source=synthetic&lang=en')
  await expect(page.locator('canvas#stage')).toBeVisible()
  await installGateAudit(page)
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.getByRole('status')).toHaveText(/Synthetic source \(debug\)/)
  await expect(page.getByTestId('guide-title')).toHaveText('Open a window with the mouse')
  await expect(page.getByTestId('guide-keys')).toHaveText(/Space reopens/)
  // ?lang= không ghi đè giá trị đã lưu (chỉ cho phiên này).
  expect(await page.evaluate(() => localStorage.getItem('wct.lang'))).toBe('vi')

  await page.waitForFunction(() => window.__wct?.face?.snapshot().ready === true, undefined, {
    timeout: 90_000,
  })
  await page.evaluate(() => window.__scenario!.run('windowAt(2,4,10)'))
  // Nền magenta, không có mặt: bước 3 với tiêu đề tiếng Anh; nhãn vẽ lên canvas dùng cùng subjectText(lang) (unit).
  await expect(page.getByTestId('guide-title')).toHaveText('Looking for a face inside the window', {
    timeout: 20_000,
  })
  await expect(page.getByTestId('guide')).toHaveAttribute('data-step', '3')
  const detailEn = (await page.getByTestId('guide-detail').textContent()) ?? ''
  expect(detailEn).not.toMatch(VI_DIACRITICS)

  // Đổi sang tiếng Việt giữa chừng: hướng dẫn đổi trong một nhịp (250 ms) không cần tải lại; ?lang= không còn tác dụng.
  await page.getByTestId('lang-switch').getByRole('button', { name: 'Tiếng Việt' }).click()
  await expect(page.getByTestId('guide-title')).toHaveText('Đang tìm khuôn mặt trong cửa sổ', {
    timeout: 5000,
  })
  await expect(page.getByRole('status')).toHaveText(/Nguồn tổng hợp/)
  note(`bước 3 tiếng Anh: "Looking for a face inside the window" · ${detailEn}`)
  await expectGateClean(page)
})
