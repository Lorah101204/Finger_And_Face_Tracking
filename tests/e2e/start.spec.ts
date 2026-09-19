import { expect, test, type Page } from '@playwright/test'
import { APP_URL, installGumCounter, note, seedConsent } from './helpers'

// UX-02 (mục 7.21, D-023): màn hình bắt đầu vừa một màn ở 1280 × 720 trở lên, không tài nguyên ngoài (I9), minh họa
// vẽ tại chỗ (UX-03, D-049: canvas động thay SVG tĩnh), bàn phím đi đúng thứ tự, tương phản AA; e2e của WEB-00
// (landing.spec, mục 7.4) giữ nguyên.
test.beforeEach(async ({ page }) => {
  await installGumCounter(page)
})

/** Mọi yêu cầu mạng không cùng gốc với dev server (font, ảnh, script CDN). */
function watchExternal(page: Page): string[] {
  const seen: string[] = []
  page.on('request', (req) => {
    const url = new URL(req.url())
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) seen.push(`${req.method()} ${url.href}`)
  })
  return seen
}

async function scrollMetrics(page: Page) {
  return page.evaluate(() => {
    const d = document.documentElement
    return {
      scrollH: d.scrollHeight,
      clientH: d.clientHeight,
      scrollW: d.scrollWidth,
      clientW: d.clientWidth,
      overflowY: getComputedStyle(document.body).overflowY,
    }
  })
}

test('một màn ở 1280 × 720 và 1920 × 1080 (không cuộn), không tài nguyên ngoài, minh họa canvas vẽ tại chỗ trang trí, không ảnh', async ({
  page,
}) => {
  const external = watchExternal(page)
  for (const [w, h] of [
    [1280, 720],
    [1920, 1080],
  ] as const) {
    await page.setViewportSize({ width: w, height: h })
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Web Camera Tracking' })).toBeVisible()
    const m = await scrollMetrics(page)
    expect(m.scrollH, `${w}×${h}`).toBeLessThanOrEqual(m.clientH)
    expect(m.scrollW, `${w}×${h}`).toBeLessThanOrEqual(m.clientW)
    // Tên, giới thiệu, ba cam kết, hộp đồng ý, nút và minh họa đều trong khung nhìn.
    for (const l of [
      page.getByRole('heading', { name: 'Web Camera Tracking' }),
      page.locator('.lead'),
      page.getByRole('list', { name: 'Cam kết riêng tư' }),
      page.getByRole('checkbox'),
      page.getByRole('button', { name: 'Bắt đầu' }),
      page.locator('figure.landing-art canvas'),
    ]) {
      await expect(l).toBeInViewport({ ratio: 1 })
    }
    note(`${w} × ${h}: scrollHeight ${m.scrollH} ≤ clientHeight ${m.clientH}, không cuộn`)
  }
  expect(await page.getByRole('list', { name: 'Cam kết riêng tư' }).locator('li').count()).toBe(3)
  await expect(page.locator('img')).toHaveCount(0)
  // UX-03: minh họa là canvas động (LandingPreview) trang trí, có figcaption; kích thước vẽ theo DPR.
  const art = page.locator('figure.landing-art canvas')
  await expect(art).toHaveAttribute('aria-hidden', 'true')
  await expect(page.locator('figure.landing-art figcaption')).toHaveText(/đầu ngón/)
  const artSize = await art.evaluate((el) => {
    const c = el as HTMLCanvasElement
    const r = c.getBoundingClientRect()
    return { css: [Math.round(r.width), Math.round(r.height)], px: [c.width, c.height] }
  })
  expect(artSize.px[0]).toBeGreaterThan(0)
  note(
    `minh họa canvas ${artSize.css[0]} × ${artSize.css[1]} CSS px, ${artSize.px[0]} × ${artSize.px[1]} px`,
  )
  await expect(page.getByText(/phiên bản \d{4}-\d{2}-\d{2}/)).toBeVisible()
  // Không có font, ảnh hay script từ nơi khác; stylesheet chỉ từ dev server.
  const sheets = await page.evaluate(() =>
    Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(
      (l) => (l as HTMLLinkElement).href,
    ),
  )
  for (const href of sheets) expect(new URL(href).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/)
  expect(external).toEqual([])
  const font = await page
    .getByRole('heading', { name: 'Web Camera Tracking' })
    .evaluate((el) => getComputedStyle(el).fontFamily)
  expect(font).toMatch(/system-ui/)
})

test('điện thoại 390 × 844: một cột, không cuộn ngang, nút Bắt đầu vẫn tới được', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const m = await scrollMetrics(page)
  expect(m.scrollW).toBeLessThanOrEqual(m.clientW)
  const cols = await page
    .locator('main.landing')
    .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)
  expect(cols).toBe(1)
  await page.getByRole('checkbox').check()
  const start = page.getByRole('button', { name: 'Bắt đầu' })
  await start.scrollIntoViewIfNeeded()
  await expect(start).toBeEnabled()
  note(
    `390 × 844: scrollWidth ${m.scrollW} ≤ clientWidth ${m.clientW}, ${cols} cột, scrollHeight ${m.scrollH}`,
  )
})

test('bàn phím: Tab tới hộp đồng ý (nút chưa bật bị bỏ qua), Space tích, Tab tới Bắt đầu, Enter vào #/app; nhãn hộp đồng ý đọc được', async ({
  page,
}) => {
  await page.goto('/')
  const focused = () =>
    page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null
      if (!a || a === document.body) return 'body'
      return `${a.tagName.toLowerCase()}${a.getAttribute('type') ? `[${a.getAttribute('type')}]` : ''}`
    })
  expect(await focused()).toBe('body')
  await page.keyboard.press('Tab')
  expect(await focused()).toBe('input[checkbox]')
  const checkbox = page.getByRole('checkbox', {
    name: /Tôi đã đọc và đồng ý \(văn bản đồng ý phiên bản \d{4}-\d{2}-\d{2}\)/,
  })
  await expect(checkbox).toBeFocused()
  await page.keyboard.press('Space')
  await expect(checkbox).toBeChecked()
  await page.keyboard.press('Tab')
  expect(await focused()).toBe('button[submit]')
  await expect(page.getByRole('button', { name: 'Bắt đầu' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(APP_URL)
  await expect(page.locator('canvas#stage')).toBeVisible()
  note('thứ tự Tab: body → hộp đồng ý → Bắt đầu (sau khi tích) → Enter vào #/app')
})

test('khối "đã đồng ý trước đó" có đường dẫn vào thẳng và đi trước nút trong thứ tự Tab sau nút Bắt đầu', async ({
  page,
}) => {
  await seedConsent(page)
  await page.goto('/')
  const direct = page.getByRole('link', { name: 'Vào thẳng màn hình' })
  await expect(direct).toBeVisible()
  await expect(page.getByRole('button', { name: 'Bắt đầu' })).toBeDisabled()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('checkbox')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(direct).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(APP_URL)
})

test('tương phản AA: chữ, cam kết, nhãn đồng ý, chữ mờ, nút Bắt đầu, liên kết đều ≥ 4,5:1 (tiêu đề lớn ≥ 3:1)', async ({
  page,
}) => {
  await seedConsent(page)
  await page.goto('/')
  await page.getByRole('checkbox').check()
  const rows = await page.evaluate(() => {
    const parse = (s: string) => {
      const m = /rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)/.exec(s)
      return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null
    }
    const lum = (c: { r: number; g: number; b: number }) => {
      const f = (v: number) => {
        const x = v / 255
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
    }
    const bgOf = (el: Element): { r: number; g: number; b: number } => {
      let e: Element | null = el
      while (e) {
        const c = parse(getComputedStyle(e).backgroundColor)
        if (c && c.a > 0) return c
        e = e.parentElement
      }
      return { r: 255, g: 255, b: 255 }
    }
    const targets: [string, string][] = [
      ['tiêu đề', 'h1'],
      ['giới thiệu', '.lead'],
      ['cam kết', '.pledges li'],
      ['nhãn đồng ý', 'label.consent span'],
      ['chữ mờ', '.actions .muted'],
      ['liên kết', '.actions a'],
      ['nút Bắt đầu', 'button[type="submit"]'],
      ['ba bước', '.steps li'],
      ['chú thích minh họa', 'figcaption'],
    ]
    return targets.map(([name, sel]) => {
      const el = document.querySelector(sel)!
      const cs = getComputedStyle(el)
      const fg = parse(cs.color)!
      const bg = bgOf(el)
      const l1 = lum(fg)
      const l2 = lum(bg)
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
      const size = parseFloat(cs.fontSize)
      const bold = parseInt(cs.fontWeight, 10) >= 700
      const large = size >= 24 || (size >= 18.66 && bold)
      return { name, ratio: Math.round(ratio * 100) / 100, size, large }
    })
  })
  for (const r of rows) expect(r.ratio, r.name).toBeGreaterThanOrEqual(r.large ? 3 : 4.5)
  note(rows.map((r) => `${r.name} ${r.ratio}:1 (${r.size}px)`).join(' · '))
})
