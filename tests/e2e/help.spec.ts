import { expect, test, type Locator, type Page } from '@playwright/test'
import { DEFAULTS } from '../../src/core/config'
import { en } from '../../src/core/i18n/en'
import { vi } from '../../src/core/i18n/vi'
import {
  handsAtCell,
  note,
  openApp,
  readLoop,
  readStage,
  seedConsent,
  setFakeHands,
} from './helpers'

// UX-05 (mục 7.34, D-059, D-060): nút "?" cạnh từng mục của cột cài đặt (di chuột, focus, bấm ghim, Esc, bấm ngoài;
// bong bóng role=tooltip qua portal, nằm trong viewport, không đè lên nhãn của mục với getByLabel) và mặc định mới của
// độ nhạy: tuổi điểm 600 ms, lọc 3 Hz.

/** Khóa data-help đang hiện trong cột cài đặt, sắp thứ tự. */
async function helpKeys(page: Page): Promise<string[]> {
  const keys = await page
    .getByTestId('settings-panel')
    .locator('button[data-help]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-help')!))
  return keys.sort()
}

function tip(page: Page, key: string): Locator {
  return page.locator(`[role="tooltip"][data-help-tip="${key}"]`)
}

/** Hộp bao nằm trọn trong viewport. */
async function expectInViewport(page: Page, el: Locator): Promise<{ w: number; h: number }> {
  const box = (await el.boundingBox())!
  const vp = page.viewportSize()!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width)
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height)
  return { w: Math.round(box.width), h: Math.round(box.height) }
}

const MOUSE_KEYS = [
  'cols',
  'dataset',
  'guide',
  'language',
  'lines',
  'log',
  'logo',
  'mirror',
  'preset',
  'rows',
  'source',
].sort()
const HANDS_KEYS = [
  ...MOUSE_KEYS,
  'swap',
  'raisedOnly',
  'fingers',
  'minCutoff',
  'beta',
  'hysteresisCells',
  'nMin',
  'pointMaxAgeMs',
].sort()

test('mỗi mục có nút "?": di chuột hiện chú thích trong viewport, rời chuột thì ẩn; bấm ghim, bấm lại, Esc hay bấm ngoài thì đóng; tên nút chung nên getByLabel(nhãn mục) vẫn trúng một phần tử', async ({
  page,
}) => {
  await seedConsent(page)
  await openApp(page, '?debug=1&source=synthetic')
  await expect(page.locator('canvas#stage')).toBeVisible()

  // Nguồn chuột: các mục chung; đổi sang tay thì thêm Cửa sổ (đảo, chỉ ngón giơ), Đầu ngón và năm tham số độ nhạy.
  expect(await helpKeys(page)).toEqual(MOUSE_KEYS)
  await page.getByLabel('Nguồn cửa sổ').selectOption('hands')
  await expect(page.getByLabel('N min')).toBeVisible()
  expect(await helpKeys(page)).toEqual(HANDS_KEYS)
  const buttons = page.getByTestId('settings-panel').locator('button[data-help]')
  const n = await buttons.count()
  for (let i = 0; i < n; i++) {
    await expect(buttons.nth(i)).toHaveAccessibleName(vi.settings.help.aria)
    await expect(buttons.nth(i)).toHaveAttribute('aria-expanded', 'false')
  }
  await expect(page.locator('[role="tooltip"]')).toHaveCount(0)

  // Di chuột: bong bóng của đúng mục, chữ từ từ điển, nằm dưới nút và trong viewport; rời chuột thì mất.
  const age = buttons.and(page.locator('[data-help="pointMaxAgeMs"]'))
  await age.hover()
  const ageTip = tip(page, 'pointMaxAgeMs')
  await expect(ageTip).toBeVisible()
  await expect(ageTip).toHaveText(vi.settings.help.sensitivity.pointMaxAgeMs)
  await expect(page.locator('[role="tooltip"]')).toHaveCount(1)
  await expect(age).toHaveAttribute('aria-describedby', (await ageTip.getAttribute('id'))!)
  const tipBox = await expectInViewport(page, ageTip)
  const btnBox = (await age.boundingBox())!
  const tipTop = (await ageTip.boundingBox())!.y
  expect(tipTop).toBeGreaterThanOrEqual(btnBox.y + btnBox.height)
  // Di chuột chưa ghim: aria-expanded vẫn false; nhãn của mục vẫn chỉ trúng ô số (tên nút "?" không chứa nhãn).
  await expect(age).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByLabel('Tuổi điểm')).toHaveCount(1)
  await expect(page.getByLabel('N min')).toHaveCount(1)
  await expect(page.getByLabel('Lưới', { exact: true })).toHaveCount(1)
  await page.mouse.move(5, 5)
  await expect(ageTip).toHaveCount(0)

  // Bấm: ghim (aria-expanded true), rời chuột vẫn còn; bấm lại thì đóng.
  await age.click()
  await expect(age).toHaveAttribute('aria-expanded', 'true')
  await page.mouse.move(5, 5)
  await expect(ageTip).toBeVisible()
  await age.click()
  await expect(age).toHaveAttribute('aria-expanded', 'false')
  await expect(ageTip).toHaveCount(0)

  // Bấm rồi Esc; bấm rồi bấm ra ngoài (tiêu đề cột, không phải canvas để không mở cửa sổ chuột).
  await age.click()
  await expect(ageTip).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(ageTip).toHaveCount(0)
  await age.click()
  await expect(ageTip).toBeVisible()
  await page.locator('.panel-title').click()
  await expect(ageTip).toHaveCount(0)
  await expect(age).toHaveAttribute('aria-expanded', 'false')

  // Ghim mục khác trong lúc một mục đang ghim: cả hai bong bóng có thể cùng hiện, nhưng bấm ngoài đóng cả hai.
  const cut = buttons.and(page.locator('[data-help="minCutoff"]'))
  await cut.click()
  await expect(tip(page, 'minCutoff')).toHaveText(vi.settings.help.sensitivity.minCutoff)
  await page.locator('.panel-title').click()
  await expect(page.locator('[role="tooltip"]')).toHaveCount(0)

  // Bàn phím: Tab tới nút "?" (focus-visible) hiện bong bóng, Tab tiếp thì ẩn.
  await page.getByLabel('Lọc minCutoff').focus()
  await page.keyboard.press('Shift+Tab')
  await expect(cut).toBeFocused()
  await expect(tip(page, 'minCutoff')).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(tip(page, 'minCutoff')).toHaveCount(0)

  // Mục không phải độ nhạy: chú thích lưới và đầu ngón từ từ điển (hàm với minPoints, minHands).
  await buttons.and(page.locator('[data-help="fingers"]')).hover()
  await expect(tip(page, 'fingers')).toHaveText(
    vi.settings.help.fingers(DEFAULTS.reveal.minPoints, DEFAULTS.hands.minHands),
  )
  await page.mouse.move(5, 5)
  await buttons.and(page.locator('[data-help="preset"]')).hover()
  await expect(tip(page, 'preset')).toHaveText(vi.settings.help.grid.preset)
  await page.mouse.move(5, 5)

  // Tiếng Anh: tên nút và chú thích đổi ngay.
  await page.getByTestId('lang-switch').getByRole('button', { name: 'English' }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(age).toHaveAccessibleName(en.settings.help.aria)
  await age.hover()
  await expect(ageTip).toHaveText(en.settings.help.sensitivity.pointMaxAgeMs)
  const enBox = await expectInViewport(page, ageTip)
  await page.mouse.move(5, 5)
  await page.getByTestId('lang-switch').getByRole('button', { name: 'Tiếng Việt' }).click()

  note(
    `${MOUSE_KEYS.length} nút "?" với nguồn chuột, ${HANDS_KEYS.length} với nguồn tay; bong bóng "Tuổi điểm" ${tipBox.w}×${tipBox.h} px` +
      ` (en ${enBox.w}×${enBox.h}) dưới nút ${Math.round(tipTop - btnBox.y - btnBox.height)} px, trong viewport;` +
      ` hover ẩn khi rời, bấm ghim, Esc và bấm ngoài đóng; getByLabel('Tuổi điểm') = 1 phần tử`,
  )
})

test('mặc định mới (D-059): Tuổi điểm 600 ms và Lọc 3 Hz trong ô số; điểm cũ 500 ms vẫn mở, đặt lại độ nhạy về đúng 600/3', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await seedConsent(page)
  await openApp(page, '?debug=1&source=synthetic')
  await expect(page.locator('canvas#stage')).toBeVisible()
  await page.getByLabel('Nguồn cửa sổ').selectOption('hands')
  await expect(page.getByLabel('N min')).toBeVisible()
  const st0 = await readStage(page)
  expect(st0.settings.sensitivity.pointMaxAgeMs).toBe(600)
  expect(st0.settings.sensitivity.minCutoff).toBe(3)
  expect(DEFAULTS.freshness.pointMaxAgeMs).toBe(600)
  expect(DEFAULTS.freshness.pointMaxAgeMsCpu).toBe(600)
  expect(DEFAULTS.hands.trackDropMs).toBe(600)
  await expect(page.getByLabel('Tuổi điểm')).toHaveValue('600')
  await expect(page.getByLabel('Lọc minCutoff')).toHaveValue('3')

  // Điểm cũ 500 ms (dưới 600): mở; với mặc định cũ 150/250 sẽ đóng stale-point.
  let st = st0
  for (;;) {
    await page.waitForTimeout(150)
    const next = await readStage(page)
    if (next.stageSize.w === st.stageSize.w && next.stageSize.h === st.stageSize.h) break
    st = next
  }
  await setFakeHands(page, handsAtCell(st.layout, 32, 18, 8.2, { ageMs: 500 }))
  await expect
    .poll(async () => (await readLoop(page)).reveal.kind, { timeout: 15_000 })
    .toBe('open')
  const open = await readLoop(page)
  expect(open.output.points.every((p) => p.valid)).toBe(true)
  await setFakeHands(page, null)

  // Đổi rồi đặt lại: về 600 và 3.
  await page.getByLabel('Tuổi điểm').fill('900')
  await page.getByLabel('Lọc minCutoff').fill('1')
  await expect
    .poll(async () => (await readStage(page)).settings.sensitivity)
    .toMatchObject({ pointMaxAgeMs: 900, minCutoff: 1 })
  await page.getByRole('button', { name: 'Đặt lại độ nhạy' }).click()
  await expect
    .poll(async () => (await readStage(page)).settings.sensitivity)
    .toMatchObject({ pointMaxAgeMs: 600, minCutoff: 3 })
  note(
    `mặc định tuổi điểm ${st0.settings.sensitivity.pointMaxAgeMs} ms, lọc ${st0.settings.sensitivity.minCutoff} Hz;` +
      ` điểm cũ 500 ms mở với ${open.output.points.length} điểm hợp lệ; đặt lại về 600/3`,
  )
})
