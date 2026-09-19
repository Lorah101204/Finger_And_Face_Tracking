import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  expectCanvasWhite,
  expectGateClean,
  handsAtCell,
  installGateAudit,
  installGumCounter,
  note,
  openApp,
  readLoop,
  readStage,
  seedConsent,
  setFakeHands,
  startFakeCamera,
  type LoopSnap,
  type StageSnap,
} from './helpers'

// UX-01 (mục 7.20, UC-08): lớp hướng dẫn trên canvas nêu bước (camera → cửa sổ → khuôn mặt) và một thông điệp cho
// từng pha camera, từng CloseReason và từng trạng thái vùng mở; panel cài đặt thu gọn được và panel debug tách riêng
// (trạng thái giữ trong sessionStorage của tab); toàn màn hình với thanh và panel thành lớp phủ tự ẩn.
type GuideSnap = { step: string; tone: string; reason: string; title: string; detail: string }

async function readGuide(page: Page): Promise<GuideSnap> {
  const g = page.getByTestId('guide')
  return {
    step: (await g.getAttribute('data-step')) ?? '',
    tone: (await g.getAttribute('data-tone')) ?? '',
    reason: (await g.getAttribute('data-reason')) ?? '',
    title: (await page.getByTestId('guide-title').textContent()) ?? '',
    detail: (await page.getByTestId('guide-detail').textContent()) ?? '',
  }
}

/** Chờ hướng dẫn tới lý do (data-reason) mong đợi rồi trả về tiêu đề, để ghi chuỗi thông điệp vào note. */
async function expectReason(page: Page, reason: string, title: RegExp): Promise<string> {
  const g = page.getByTestId('guide')
  await expect(g).toHaveAttribute('data-reason', reason, { timeout: 10_000 })
  await expect(page.getByTestId('guide-title')).toHaveText(title)
  return (await page.getByTestId('guide-title').textContent()) ?? ''
}

async function openSynthetic(page: Page): Promise<StageSnap> {
  await installGumCounter(page)
  await seedConsent(page)
  await openApp(page, '?debug=1&source=synthetic')
  await expect(page.locator('canvas#stage')).toBeVisible()
  const st = await readStage(page)
  await installGateAudit(page)
  return st
}

/** Chọn nguồn tay rồi đọc layout sau khi hai thanh đầu ngón và độ nhạy đã hiện (canvas nhỏ lại). */
async function selectHands(page: Page): Promise<StageSnap> {
  await page.getByLabel('Nguồn cửa sổ').selectOption('hands')
  await expect(page.getByLabel('N min')).toBeVisible()
  let st = await readStage(page)
  for (;;) {
    await page.waitForTimeout(150)
    const next = await readStage(page)
    if (next.stageSize.w === st.stageSize.w && next.stageSize.h === st.stageSize.h) return next
    st = next
  }
}

function waitFaceReady(page: Page): Promise<unknown> {
  return page.waitForFunction(() => window.__wct?.face?.snapshot().ready === true, undefined, {
    timeout: 120_000,
  })
}

/** Như integration.spec: ghi đè document.visibilityState rồi phát visibilitychange. */
function setHidden(page: Page, hidden: boolean): Promise<LoopSnap['reveal']> {
  return page.evaluate((h) => {
    if (h) {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      })
    } else {
      delete (document as unknown as { visibilityState?: string }).visibilityState
    }
    document.dispatchEvent(new Event('visibilitychange'))
    return window.__wct!.loop!.snapshot().reveal
  }, hidden)
}

function cssPosition(l: Locator): Promise<string> {
  return l.evaluate((el) => getComputedStyle(el).position)
}

test('hướng dẫn ba bước với camera giả và cửa sổ chuột: bật camera → mở cửa sổ → tìm mặt; Esc và dừng camera đưa về bước trước, canvas trắng', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await installGumCounter(page)
  await seedConsent(page)
  await openApp(page, '?debug=1')
  await expect(page.locator('canvas#stage')).toBeVisible()
  const seq: string[] = []
  const guide = page.getByTestId('guide')
  await expect(guide).toHaveAttribute('data-step', '1')
  await expect(page.getByTestId('guide-title')).toHaveText('Bật camera để bắt đầu')
  await expect(guide.locator('.steps li').nth(0)).toHaveAttribute('aria-current', 'step')
  // Lớp hướng dẫn không nhận chuột: kéo trên canvas vẫn tới canvas.
  expect(await guide.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none')
  seq.push((await readGuide(page)).title)

  await startFakeCamera(page)
  await waitFaceReady(page)
  seq.push(await expectReason(page, 'user', /^Mở cửa sổ bằng chuột$/))
  await expect(guide).toHaveAttribute('data-step', '2')
  await expect(page.getByTestId('guide-keys')).toHaveText(/Space mở lại/)

  await page.keyboard.press('Space')
  await expect.poll(async () => (await readLoop(page)).reveal.kind).toBe('open')
  await expect(guide).toHaveAttribute('data-step', '3', { timeout: 10_000 })
  await expect(page.getByTestId('guide-title')).toHaveText('Đang tìm khuôn mặt trong cửa sổ')
  await expect(guide).toHaveAttribute('data-reason', '')
  seq.push((await readGuide(page)).title)

  // Cửa sổ chạm mép (kẹp): câu thêm về mép bảng.
  await page.evaluate(() => window.__scenario!.run('windowAt(-3,-3,8)'))
  await expect(page.getByTestId('guide-detail')).toHaveText(/chạm mép bảng/, { timeout: 10_000 })
  await page.evaluate(() => window.__scenario!.run('windowAt(12,5,8)'))
  await expect(page.getByTestId('guide-detail')).not.toHaveText(/chạm mép bảng/, {
    timeout: 10_000,
  })

  await page.keyboard.press('Escape')
  seq.push(await expectReason(page, 'user', /^Mở cửa sổ bằng chuột$/))

  await page.keyboard.press('Space')
  await expect(guide).toHaveAttribute('data-step', '3', { timeout: 10_000 })
  await page.getByRole('button', { name: 'Dừng camera' }).click()
  await expect(guide).toHaveAttribute('data-step', '1', { timeout: 10_000 })
  await expect(page.getByTestId('guide-title')).toHaveText('Bật camera để bắt đầu')
  await expectCanvasWhite(page)
  seq.push((await readGuide(page)).title)
  note(`chuỗi thông điệp: ${seq.join(' → ')}`)
})

test('hướng dẫn theo tay giả lập trên nguồn tổng hợp: mỗi lý do đóng có thông điệp riêng; tab ẩn về bước camera; mở thì sang bước khuôn mặt', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await openSynthetic(page)
  const st = await selectHands(page)
  const L = st.layout
  const guide = page.getByTestId('guide')
  const seq: string[] = []
  // Worker tay đang nạp hoặc đã sẵn sàng mà chưa thấy tay: cả hai đều là bước 2, không có gợi ý phím chuột.
  await expect(guide).toHaveAttribute('data-step', '2')
  await expect(page.getByTestId('guide-title')).toHaveText(
    /^(Đang nạp bộ nhận diện tay…|Đưa hai bàn tay vào trước camera)$/,
  )
  await expect(page.getByTestId('guide-keys')).toHaveCount(0)
  seq.push((await readGuide(page)).title)
  await waitFaceReady(page)

  const both = handsAtCell(L, 32, 18, 8.2)
  await setFakeHands(page, { left: both.left, right: null })
  seq.push(await expectReason(page, 'few-points', /^Còn thiếu đầu ngón$/))
  await expect(page.getByTestId('guide-detail')).toHaveText(/5 đầu ngón hợp lệ.*chưa thấy tay phải/)

  await setFakeHands(page, both)
  await expect.poll(async () => (await readLoop(page)).reveal.kind).toBe('open')
  await expect(guide).toHaveAttribute('data-step', '3', { timeout: 10_000 })
  await expect(page.getByTestId('guide-title')).toHaveText('Đang tìm khuôn mặt trong cửa sổ')
  seq.push((await readGuide(page)).title)

  await setFakeHands(page, { ...both, uncertain: true })
  seq.push(await expectReason(page, 'ambiguous-hands', /^Hai tay chéo nhau$/))
  await setFakeHands(page, { ...both, ageMs: 1000 })
  seq.push(await expectReason(page, 'stale-point', /^Mất dấu đầu ngón$/))
  await setFakeHands(page, handsAtCell(L, 32, 18, 1))
  seq.push(await expectReason(page, 'too-small', /^Các đầu ngón quá gần nhau$/))
  await setFakeHands(page, {
    left: { x: -400, y: both.left!.y, spread: both.left!.spread },
    right: both.right,
  })
  seq.push(await expectReason(page, 'out-of-board', /^Đầu ngón ra ngoài bảng$/))

  await setFakeHands(page, both)
  await expect(guide).toHaveAttribute('data-step', '3', { timeout: 10_000 })
  expect(await setHidden(page, true)).toEqual({ kind: 'closed', reason: 'tab-hidden' })
  seq.push(await expectReason(page, 'tab-hidden', /^Tab đang ẩn$/))
  await expect(guide).toHaveAttribute('data-step', '1')
  await expect(guide).toHaveAttribute('data-tone', 'warn')
  await setHidden(page, false)
  await expect(guide).toHaveAttribute('data-step', '3', { timeout: 10_000 })

  await setFakeHands(page, null)
  await expect(page.getByTestId('guide-title')).toHaveText(
    /^(Đang nạp bộ nhận diện tay…|Đưa hai bàn tay vào trước camera)$/,
    { timeout: 10_000 },
  )
  note(`chuỗi thông điệp: ${seq.join(' → ')}`)
  await expectGateClean(page)
})

test('panel cài đặt thu gọn được (canvas nhận lại chỗ theo chiều rộng, UX-03), panel debug tách riêng và mặc định đóng khi không có ?debug=1; trạng thái giữ qua tải lại trong tab', async ({
  page,
}) => {
  await installGumCounter(page)
  await seedConsent(page)
  await openApp(page)
  await expect(page.locator('canvas#stage')).toBeVisible()
  const settings = page.getByTestId('settings-panel')
  const debug = page.getByTestId('debug-panel')
  const btnSettings = page.getByRole('button', { name: 'Cài đặt' })
  const btnDebug = page.getByRole('button', { name: 'Debug' })
  await expect(settings).toBeVisible()
  await expect(btnSettings).toHaveAttribute('aria-expanded', 'true')
  await expect(debug).toBeHidden()
  await expect(btnDebug).toHaveAttribute('aria-expanded', 'false')
  // Dòng debug vẫn trong DOM khi panel đóng (e2e cũ đọc bằng toHaveText).
  await expect(page.getByTestId('stage-status')).toHaveText(/./)
  await expect(page.getByLabel('Lưới', { exact: true })).toBeVisible()

  // UX-03 (D-049): cài đặt là cột bên phải nên thu gọn trả lại chiều rộng; debug là ngăn kéo dưới nên mở lấy chiều cao.
  const s0 = await readStage(page)
  await btnSettings.click()
  await expect(settings).toBeHidden()
  await expect(btnSettings).toHaveAttribute('aria-expanded', 'false')
  await expect.poll(async () => (await readStage(page)).stageSize.w).toBeGreaterThan(s0.stageSize.w)
  const s1 = await readStage(page)
  expect(s1.epoch).toBeGreaterThan(s0.epoch)
  await btnDebug.click()
  await expect(debug).toBeVisible()
  await expect(page.getByTestId('stats-stat')).toBeVisible()
  await expect.poll(async () => (await readStage(page)).stageSize.h).toBeLessThan(s1.stageSize.h)
  const s2 = await readStage(page)

  await page.reload()
  await expect(page.locator('canvas#stage')).toBeVisible()
  await expect(page.getByTestId('settings-panel')).toBeHidden()
  await expect(page.getByTestId('debug-panel')).toBeVisible()
  await page.getByRole('button', { name: 'Cài đặt' }).click()
  await expect(page.getByTestId('settings-panel')).toBeVisible()
  await expect(page.getByLabel('Nguồn cửa sổ')).toBeVisible()

  // ?debug=1: panel debug mở sẵn (giá trị đã lưu trong tab được ưu tiên nên xóa trước).
  await page.evaluate(() => sessionStorage.removeItem('wct.ui'))
  await openApp(page, '?debug=1')
  await expect(page.getByTestId('debug-panel')).toBeVisible()
  await expect(page.getByTestId('settings-panel')).toBeVisible()
  note(
    `canvas ${s0.stageSize.w}×${s0.stageSize.h} px khi mở cột cài đặt, ${s1.stageSize.w}×${s1.stageSize.h} px khi thu gọn (epoch ${s0.epoch} → ${s1.epoch}), ${s2.stageSize.w}×${s2.stageSize.h} px khi mở ngăn kéo debug`,
  )
})

test('toàn màn hình: nút và phím F; thanh và panel thành lớp phủ (canvas không đổi cỡ khi lớp phủ ẩn), tự ẩn sau khi không tương tác, chuột hiện lại', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await openSynthetic(page)
  const button = page.getByRole('button', { name: 'Toàn màn hình' })
  const supported = await page.evaluate(() => document.fullscreenEnabled)
  if (!supported) {
    await expect(button).toHaveCount(0)
    note(
      'trình duyệt không cho requestFullscreen (fullscreenEnabled sai): nút ẩn, bỏ qua phần còn lại',
    )
    return
  }
  await expect(button).toBeVisible()
  const stage = page.locator('.stage')
  const chrome = page.locator('.stage .chrome')
  expect(await cssPosition(chrome)).toBe('static')
  await button.click()
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement !== null), {
      timeout: 5000,
    })
    .toBe(true)
  await expect(stage).toHaveClass(/fullscreen/)
  await expect(page.getByRole('button', { name: 'Thoát toàn màn hình' })).toBeVisible()
  expect(await cssPosition(chrome)).toBe('absolute')
  // Canvas chiếm toàn bộ .stage: lớp phủ không lấy chỗ.
  const sizes = await page.evaluate(() => {
    const s = document.querySelector('.stage')!.getBoundingClientRect()
    const c = document.querySelector('canvas#stage')!.getBoundingClientRect()
    return { stage: [s.width, s.height], canvas: [c.width, c.height] }
  })
  expect(sizes.canvas).toEqual(sizes.stage)
  const e0 = (await readStage(page)).epoch

  // Không tương tác 2,5 s: lớp phủ ẩn (opacity 0), canvas và epoch không đổi; di chuột: hiện lại.
  await expect(stage).toHaveClass(/idle/, { timeout: 6000 })
  await expect
    .poll(() => chrome.evaluate((el) => getComputedStyle(el).opacity), { timeout: 3000 })
    .toBe('0')
  const e1 = (await readStage(page)).epoch
  expect(e1).toBe(e0)
  await page.mouse.move(200, 300)
  await page.mouse.move(220, 320)
  await expect(stage).not.toHaveClass(/idle/)
  await expect
    .poll(() => chrome.evaluate((el) => getComputedStyle(el).opacity), { timeout: 3000 })
    .toBe('1')
  expect((await readStage(page)).epoch).toBe(e0)

  // Phím F thoát; gõ trong ô nhập không kích hoạt; bấm lên canvas (dưới lớp phủ) trả focus cho trang để phím chạy.
  await page.getByLabel('Số cột').focus()
  await page.keyboard.press('f')
  await page.waitForTimeout(200)
  expect(await page.evaluate(() => document.fullscreenElement !== null)).toBe(true)
  const box = (await page.locator('canvas#stage').boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.85)
  expect(await page.evaluate(() => document.activeElement?.tagName ?? '')).not.toBe('INPUT')
  await page.keyboard.press('f')
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement !== null), {
      timeout: 5000,
    })
    .toBe(false)
  await expect(stage).not.toHaveClass(/fullscreen/)
  expect(await cssPosition(chrome)).toBe('static')
  await page.keyboard.press('f')
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement !== null), {
      timeout: 5000,
    })
    .toBe(true)
  await page.getByRole('button', { name: 'Thoát toàn màn hình' }).click()
  await expect(stage).not.toHaveClass(/fullscreen/, { timeout: 5000 })
  note(
    `toàn màn hình ${sizes.stage[0]}×${sizes.stage[1]} CSS px, canvas bằng đúng .stage; epoch ${e0} giữ nguyên khi lớp phủ ẩn và hiện`,
  )
  await expectGateClean(page)
})
