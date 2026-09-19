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

// UX-03 (mục 7.28, D-049): thanh trên ba vùng một dòng với bậc nút và pill trạng thái; cột cài đặt bên phải (canvas
// nhận lại chiều rộng, chọn nguồn Tay không đổi cỡ canvas) và ngăn kéo debug; thanh trượt độ nhạy và chip đầu ngón;
// chế độ trình diễn (nút Trình diễn, ?mode=present): mọi panel là lớp nổi không đổi cỡ canvas, tự ẩn khi không tương
// tác, giữ qua tải lại; màn hình bắt đầu kiosk (?mode=present) với minh họa canvas phủ cả màn.
const ACCENT = 'rgb(25, 103, 210)'
const ERROR_INK = 'rgb(176, 0, 32)'

async function openSynthetic(page: Page) {
  await installGumCounter(page)
  await seedConsent(page)
  await openApp(page, '?debug=1&source=synthetic')
  await expect(page.locator('canvas#stage')).toBeVisible()
  return readStage(page)
}

function css(l: Locator, prop: string): Promise<string> {
  return l.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop)
}

async function box(l: Locator): Promise<{ w: number; h: number }> {
  const b = (await l.boundingBox())!
  return { w: Math.round(b.width), h: Math.round(b.height) }
}

/** Đặt giá trị input[type=range] như người dùng kéo (qua setter gốc để React nhận sự kiện input). */
function dragRange(l: Locator, value: string): Promise<void> {
  return l.evaluate((el, v) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    set.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}

test('thanh trên một dòng ở 1280 px kể cả khi câu trạng thái dài và nhật ký bật; bậc nút: chỉ Bật camera là primary, Xóa nhật ký là danger; pill trạng thái có chấm theo pha', async ({
  page,
}) => {
  await openSynthetic(page)
  const top = page.locator('.bar.top')
  const h0 = (await box(top)).h
  expect(h0).toBeLessThanOrEqual(56)
  // Nhật ký bật thêm chữ "nhật ký bật · N" mà thanh vẫn một dòng (LOG-02 từng làm thanh xuống dòng).
  await page.getByLabel('Ghi nhật ký cục bộ').check()
  await expect(page.getByTestId('log-stat')).toHaveText(/^nhật ký bật · \d+$/)
  const h1 = (await box(top)).h
  expect(h1).toBe(h0)
  // Câu trạng thái đầy đủ vẫn ở role=status (cắt bớt bằng dấu ba chấm chỉ về hình ảnh).
  const status = page.getByRole('status')
  await expect(status).toHaveText(/Nguồn tổng hợp/)
  await expect(status).toHaveClass(/\bon\b/)
  await expect(status.locator('.dot')).toHaveCount(1)
  // Bậc nút.
  expect(await css(page.getByRole('button', { name: 'Bật camera' }), 'background-color')).toBe(
    ACCENT,
  )
  expect(await css(page.getByRole('button', { name: 'Cài đặt' }), 'background-color')).not.toBe(
    ACCENT,
  )
  expect(await css(page.getByRole('button', { name: 'Xóa nhật ký' }), 'color')).toBe(ERROR_INK)
  const dark = await page.evaluate(
    () =>
      Array.from(document.querySelectorAll('.stage button')).filter(
        (b) => getComputedStyle(b).backgroundColor === 'rgb(32, 33, 36)',
      ).length,
  )
  expect(dark).toBe(0)
  await page.getByLabel('Ghi nhật ký cục bộ').uncheck()
  note(`thanh trên cao ${h0} px (có nhật ký: ${h1} px), 0 nút đen, primary = ${ACCENT}`)
})

test('cột cài đặt 320 px bên phải: thu gọn trả lại chiều rộng; chọn nguồn Tay không đổi cỡ canvas; ngăn kéo debug dưới canvas có giới hạn chiều cao; thanh trượt và chip', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await openSynthetic(page)
  // ?debug=1 mở sẵn ngăn kéo debug: đóng để lấy mốc canvas chỉ với cột cài đặt; chờ ResizeObserver tinh chỉnh cỡ
  // canvas (epoch có thể tăng một lần ngay sau khi mở) rồi mới lấy mốc.
  await page.getByRole('button', { name: 'Debug' }).click()
  await expect(page.getByTestId('debug-panel')).toBeHidden()
  await page.waitForTimeout(500)
  const s0 = await readStage(page)
  const stageBox = await box(page.locator('.stage'))
  const aside = page.getByTestId('settings-panel')
  await expect(aside).toBeVisible()
  const asideBox = await box(aside)
  expect(asideBox.w).toBe(320)
  expect(s0.stageSize.w + asideBox.w).toBeLessThanOrEqual(stageBox.w)
  expect(s0.stageSize.w + asideBox.w).toBeGreaterThanOrEqual(stageBox.w - 2)
  expect(await css(aside, 'position')).toBe('static')

  // Chọn nguồn Tay: thêm hai mục trong cột, canvas không đổi cỡ, epoch chỉ tăng vì đổi cấu hình.
  await page.getByLabel('Nguồn cửa sổ').selectOption('hands')
  await expect(page.getByLabel('N min')).toBeVisible()
  await expect(page.getByLabel('Ngón út')).toBeVisible()
  await page.waitForTimeout(400)
  const s1 = await readStage(page)
  expect(s1.stageSize).toEqual(s0.stageSize)
  expect(s1.epoch).toBe(s0.epoch + 1)

  // Thanh trượt độ nhạy: kéo thanh N min thì ô số và store cùng đổi (không đổi epoch, D-036).
  const nMinRange = page.locator('[data-testid="sensitivity-bar"] input[type="range"]').nth(3)
  await dragRange(nMinRange, '5')
  await expect(page.getByLabel('N min')).toHaveValue('5')
  await expect.poll(async () => (await readStage(page)).settings.sensitivity.nMin).toBe(5)
  expect((await readStage(page)).epoch).toBe(s1.epoch)
  // Chip đầu ngón vẫn là checkbox có nhãn: bỏ ngón út thì store bỏ tip 20 và epoch tăng.
  await page.getByLabel('Ngón út').uncheck()
  await expect.poll(async () => (await readStage(page)).settings.fingers).toEqual([4, 8, 12, 16])
  expect(await page.getByLabel('Ngón út').evaluate((el) => el.closest('label')?.className)).toBe(
    'chip',
  )

  // Mở hết: thu dữ liệu và debug; ngăn kéo debug lấy chiều cao nhưng có giới hạn; ô lưới còn đủ lớn.
  await page.getByLabel('Thu dữ liệu').check()
  await page.getByRole('button', { name: 'Debug' }).click()
  const drawer = page.getByTestId('debug-panel')
  await expect(drawer).toBeVisible()
  const drawerBox = await box(drawer)
  expect(drawerBox.h).toBeLessThanOrEqual(150)
  await expect.poll(async () => (await readStage(page)).stageSize.h).toBeLessThan(s1.stageSize.h)
  const s2 = await readStage(page)
  expect(s2.stageSize.w).toBe(s1.stageSize.w)
  expect(s2.layout.c).toBeGreaterThanOrEqual(12)

  // Thu gọn cột: canvas rộng ra đúng bề rộng cột.
  await page.getByRole('button', { name: 'Cài đặt' }).click()
  await expect(aside).toBeHidden()
  await expect.poll(async () => (await readStage(page)).stageSize.w).toBeGreaterThan(s2.stageSize.w)
  const s3 = await readStage(page)
  expect(s3.stageSize.w - s2.stageSize.w).toBeGreaterThanOrEqual(asideBox.w - 1)
  note(
    `cột cài đặt ${asideBox.w} px; canvas ${s0.stageSize.w}×${s0.stageSize.h} (chuột) = ${s1.stageSize.w}×${s1.stageSize.h} (tay); mở hết ${s2.stageSize.w}×${s2.stageSize.h}, ô ${s2.layout.c} px, ngăn kéo ${drawerBox.h} px; thu gọn cột ${s3.stageSize.w}×${s3.stageSize.h}`,
  )
})

test('chế độ trình diễn: panel thành lớp nổi không đổi cỡ canvas (epoch giữ nguyên), tự ẩn sau 2,5 s rồi hiện lại khi di chuột, giữ qua tải lại; ?mode=present mở sẵn với cột cài đặt đóng', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const s0 = await openSynthetic(page)
  await installGateAudit(page)
  const stage = page.locator('.stage')
  const chrome = page.locator('.stage .chrome')
  const aside = page.getByTestId('settings-panel')
  const present = page.getByRole('button', { name: 'Trình diễn' })
  await expect(present).toHaveAttribute('aria-pressed', 'false')
  expect(await css(chrome, 'position')).toBe('static')

  await present.click()
  await expect(present).toHaveAttribute('aria-pressed', 'true')
  await expect(stage).toHaveClass(/\bpresent\b/)
  await expect(stage).toHaveClass(/\boverlay\b/)
  expect(await css(chrome, 'position')).toBe('absolute')
  expect(await css(aside, 'position')).toBe('absolute')
  const sizes = await page.evaluate(() => {
    const s = document.querySelector('.stage')!.getBoundingClientRect()
    const c = document.querySelector('canvas#stage')!.getBoundingClientRect()
    return { stage: [s.width, s.height], canvas: [c.width, c.height] }
  })
  expect(sizes.canvas).toEqual(sizes.stage)
  await expect.poll(async () => (await readStage(page)).stageSize.w).toBeGreaterThan(s0.stageSize.w)
  const s1 = await readStage(page)

  // Mở cửa sổ chuột rồi bật/tắt cột cài đặt và debug: canvas và epoch không đổi, cửa sổ vẫn mở.
  await page.evaluate(() => window.__scenario!.run('windowAt(20,8,12)'))
  await expect
    .poll(() => page.evaluate(() => window.__wct!.loop!.snapshot().reveal.kind))
    .toBe('open')
  const e1 = (await readStage(page)).epoch
  await page.getByRole('button', { name: 'Cài đặt' }).click()
  await page.getByRole('button', { name: 'Debug' }).click()
  await page.waitForTimeout(400)
  const s2 = await readStage(page)
  expect(s2.stageSize).toEqual(s1.stageSize)
  expect(s2.epoch).toBe(e1)
  expect((await page.evaluate(() => window.__wct!.loop!.snapshot().reveal.kind)) as string).toBe(
    'open',
  )
  await expect(page.getByTestId('guide')).toHaveClass(/\bhud\b/)

  // Không tương tác 2,5 s: lớp nổi ẩn (opacity 0), hướng dẫn vẫn hiện, vạch gợi ý hiện; di chuột thì hiện lại.
  await expect(stage).toHaveClass(/\bidle\b/, { timeout: 6000 })
  await expect.poll(() => css(chrome, 'opacity'), { timeout: 3000 }).toBe('0')
  expect(await css(page.getByTestId('guide'), 'opacity')).toBe('1')
  await expect
    .poll(() => css(page.locator('.present-hint'), 'opacity'), { timeout: 3000 })
    .toBe('1')
  expect((await readStage(page)).epoch).toBe(e1)
  await page.mouse.move(300, 300)
  await page.mouse.move(320, 320)
  await expect(stage).not.toHaveClass(/\bidle\b/)
  await expect.poll(() => css(chrome, 'opacity'), { timeout: 3000 }).toBe('1')

  await expectGateClean(page)

  // Giữ qua tải lại (sessionStorage wct.ui); tắt thì về bố cục trong luồng.
  await page.reload()
  await expect(page.locator('canvas#stage')).toBeVisible()
  await expect(page.locator('.stage')).toHaveClass(/\bpresent\b/)
  await page.getByRole('button', { name: 'Trình diễn' }).click()
  await expect(page.locator('.stage')).not.toHaveClass(/\boverlay\b/)
  expect(await css(page.locator('.stage .chrome'), 'position')).toBe('static')

  // ?mode=present trên tab mới (không có wct.ui): trình diễn mở sẵn, cột cài đặt đóng.
  await page.evaluate(() => sessionStorage.removeItem('wct.ui'))
  await openApp(page, '?debug=1&source=synthetic&mode=present')
  await expect(page.locator('.stage')).toHaveClass(/\bpresent\b/)
  await expect(page.getByRole('button', { name: 'Cài đặt' })).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  await expect(page.getByTestId('settings-panel')).toBeHidden()
  note(
    `trình diễn: canvas ${sizes.canvas[0]}×${sizes.canvas[1]} = .stage; mở cột cài đặt và debug giữ ${s2.stageSize.w}×${s2.stageSize.h}, epoch ${e1}; lớp nổi ẩn sau 2,5 s`,
  )
})

test('màn hình bắt đầu kiosk (?mode=present): minh họa canvas phủ cả màn, thẻ đồng ý nổi, không ảnh, không tài nguyên ngoài; đồng ý thì vào #/app?mode=present ở chế độ trình diễn', async ({
  page,
}) => {
  await installGumCounter(page)
  const external: string[] = []
  page.on('request', (req) => {
    // blob: là worker và wasm loader cùng origin của app (I9), không phải mạng.
    if (req.url().startsWith('blob:')) return
    const url = new URL(req.url())
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) external.push(url.href)
  })
  await page.goto('/#/?mode=present')
  const kiosk = page.getByTestId('landing-kiosk')
  await expect(kiosk).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Web Camera Tracking' })).toBeVisible()
  const bg = page.getByTestId('landing-preview')
  await expect(bg).toHaveAttribute('data-variant', 'window')
  const vp = page.viewportSize()!
  const bgBox = await box(bg)
  expect(bgBox.w).toBe(vp.width)
  expect(bgBox.h).toBe(vp.height)
  await expect(page.locator('img')).toHaveCount(0)
  const m = await page.evaluate(() => {
    const d = document.documentElement
    return { scrollH: d.scrollHeight, clientH: d.clientHeight }
  })
  expect(m.scrollH).toBeLessThanOrEqual(m.clientH)
  // Tương phản của chữ trên thẻ (nền thẻ trắng 94 %): tiêu đề, giới thiệu, nhãn đồng ý ≥ 4,5:1 (tiêu đề lớn ≥ 3:1).
  const rows = await page.evaluate(() => {
    const parse = (s: string) => {
      const m = /rgba?\(([\d.]+), ([\d.]+), ([\d.]+)/.exec(s)
      return m ? [+m[1], +m[2], +m[3]] : [255, 255, 255]
    }
    const lum = (c: number[]) => {
      const f = (v: number) => {
        const x = v / 255
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
    }
    return (['h1', '.lead', 'label.consent span', '.steps li'] as const).map((sel) => {
      const el = document.querySelector(sel)!
      const cs = getComputedStyle(el)
      const l1 = lum(parse(cs.color))
      const l2 = lum([255, 255, 255])
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
      const size = parseFloat(cs.fontSize)
      return { sel, ratio: Math.round(ratio * 100) / 100, large: size >= 24 }
    })
  })
  for (const r of rows) expect(r.ratio, r.sel).toBeGreaterThanOrEqual(r.large ? 3 : 4.5)

  const start = page.getByRole('button', { name: 'Bắt đầu' })
  await expect(start).toBeDisabled()
  await page.getByRole('checkbox').check()
  await expect(start).toBeEnabled()
  await start.click()
  await expect(page).toHaveURL(/#\/app\?mode=present$/)
  await expect(page.locator('canvas#stage')).toBeVisible()
  await expect(page.locator('.stage')).toHaveClass(/\bpresent\b/)
  await expect(page.getByRole('button', { name: 'Trình diễn' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(external).toEqual([])
  note(
    `kiosk: nền canvas ${bgBox.w}×${bgBox.h}, không cuộn; tương phản ${rows.map((r) => `${r.sel} ${r.ratio}:1`).join(' · ')}`,
  )
})
