import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { BASE } from '../../playwright.deploy.config'
import { CONSENT_KEY, CONSENT_VERSION, note } from '../e2e/helpers'

// PERF-03 (mục 7.36, D-063) trên bản build (vite preview, như sw.spec): sân khấu là chunk riêng. (1) dist có đúng một
// chunk StagePage, mã camera và kịch bản e2e nằm trong nó chứ không trong chunk đầu, ngân sách chunk đầu; (2) trang chào
// chỉ tải tập file của index.html, chunk sân khấu được nạp trước lúc rảnh SAU sự kiện load; (3) vào sân khấu sau khi đã
// nạp trước không tải thêm JS nào; (4) mở thẳng #/app (đã đồng ý) nạp chunk và chạy; (5) chunk lỗi: tải lại đúng một
// lần rồi báo lỗi có nút tải lại, trang chào không bị tải lại. Service worker bị chặn để chỉ đo việc tách chunk (sw.spec
// kiểm cache, offline).
test.describe.configure({ mode: 'serial' })

const ORIGIN = 'http://127.0.0.1:4174'
const html = readFileSync(resolve('dist/index.html'), 'utf8')
const assets = readdirSync(resolve('dist/assets'))
/** File JS/CSS mà index.html tải (module entry, modulepreload, stylesheet), dạng 'assets/…'. */
const htmlFiles = [
  ...html.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)="([^"]+\.(?:js|css))"/g),
].map((m) => m[1].slice(m[1].indexOf('assets/')))
const entryJs = htmlFiles.find((f) => /^assets\/index-[\w-]+\.js$/.test(f))!
const stageJs = assets.filter((f) => /^StagePage-[\w-]+\.js$/.test(f))
const kb = (n: number) => (n / 1000).toFixed(1) // kB = 1000 byte, như Vite in
const sizes = (f: string) => {
  const blob = readFileSync(resolve('dist', f))
  return { raw: blob.length, gzip: gzipSync(blob, { level: 6 }).length }
}

async function freshContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ baseURL: `${ORIGIN}${BASE}`, serviceWorkers: 'block' })
}

/** JS/CSS cùng origin mà trang tải (theo thứ tự), dạng 'assets/…'. */
function trackAssets(page: Page): string[] {
  const got: string[] = []
  page.on('request', (req) => {
    const u = req.url()
    if (u.startsWith(ORIGIN) && /\/assets\/[^/]+\.(js|css)$/.test(u))
      got.push(u.slice(u.indexOf('assets/')))
  })
  return got
}

async function seedConsent(page: Page): Promise<void> {
  await page.goto(BASE)
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [CONSENT_KEY, CONSENT_VERSION])
}

test('dist: một chunk StagePage chứa mã sân khấu, chunk đầu không có camera hay kịch bản e2e, trong ngân sách', () => {
  expect(entryJs).toBeTruthy()
  expect(stageJs).toHaveLength(1)
  const entry = readFileSync(resolve('dist', entryJs), 'utf8')
  const stage = readFileSync(resolve('dist/assets', stageJs[0]), 'utf8')
  for (const marker of ['getUserMedia', '__scenario', 'requestVideoFrameCallback']) {
    expect(entry, marker).not.toContain(marker)
    expect(stage, marker).toContain(marker)
  }
  const e = sizes(entryJs)
  const s = sizes(`assets/${stageJs[0]}`)
  // Ngân sách chunk đầu: đo 314 kB raw / 103 kB gzip lúc tách (trước đó 445 / 147 kB cả sân khấu); vượt nghĩa là
  // trang chào lại kéo mã sân khấu vào.
  expect(e.gzip).toBeLessThan(115_000)
  note(
    `chunk đầu ${entryJs.slice(7)} ${kb(e.raw)} kB (gzip ${kb(e.gzip)} kB), sân khấu ${stageJs[0]} ${kb(s.raw)} kB` +
      ` (gzip ${kb(s.gzip)} kB); index.html tải ${htmlFiles.length} file JS/CSS`,
  )
})

test('trang chào: chỉ tải tập file của index.html; chunk sân khấu nạp trước lúc rảnh, sau sự kiện load; vào sân khấu không tải thêm JS', async ({
  browser,
}) => {
  const context = await freshContext(browser)
  const page = await context.newPage()
  const got = trackAssets(page)
  await page.goto(BASE)
  await expect(page.locator('main.landing')).toBeVisible()
  await expect
    .poll(() => got.some((f) => f.startsWith('assets/StagePage-')), { timeout: 15_000 })
    .toBe(true)
  // `got` ghi lúc request bắt đầu, còn entry Resource Timing chỉ có khi chunk tải xong: chờ entry rồi mới đọc.
  await page.waitForFunction(() =>
    performance
      .getEntriesByType('resource')
      .some((r) => /\/assets\/StagePage-[\w-]+\.js$/.test(r.name)),
  )
  const timing = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
    const st = performance
      .getEntriesByType('resource')
      .find((r) => /\/assets\/StagePage-[\w-]+\.js$/.test(r.name))!
    return { loadEnd: nav.loadEventEnd, stageStart: st.startTime }
  })
  // Mọi file trước chunk sân khấu đều là file của index.html.
  const before = got.slice(
    0,
    got.findIndex((f) => f.startsWith('assets/StagePage-')),
  )
  expect([...new Set(before)].sort()).toEqual([...new Set(htmlFiles)].sort())
  expect(timing.stageStart).toBeGreaterThanOrEqual(timing.loadEnd)
  const landingBytes = htmlFiles.reduce((a, f) => a + sizes(f).gzip, 0)

  // Vào sân khấu: chunk đã có sẵn, không tải thêm JS nào (ngoài worker khi sân khấu khởi động).
  const n0 = got.length
  await page.getByRole('checkbox').check()
  const t0 = Date.now()
  await page.getByRole('button', { name: 'Bắt đầu' }).click()
  await expect(page.locator('canvas#stage')).toBeVisible()
  const enterMs = Date.now() - t0
  const after = got.slice(n0).filter((f) => !/worker-/.test(f))
  expect(after).toEqual([])
  note(
    `trang chào tải ${htmlFiles.length} file JS/CSS (gzip ${kb(landingBytes)} kB); chunk sân khấu bắt đầu ` +
      `${Math.round(timing.stageStart - timing.loadEnd)} ms sau load; bấm Bắt đầu → canvas ${enterMs} ms, 0 file JS thêm`,
  )
  await context.close()
})

test('mở thẳng #/app khi đã đồng ý: nạp chunk sân khấu và chạy', async ({ browser }) => {
  const context = await freshContext(browser)
  const page = await context.newPage()
  await seedConsent(page)
  const doc = await context.newPage()
  const got = trackAssets(doc)
  await doc.goto(`${BASE}#/app?debug=1&source=synthetic`)
  await expect(doc.locator('canvas#stage')).toBeVisible()
  await doc.waitForFunction(() => !!window.__wct?.stage)
  expect(got.filter((f) => f.startsWith('assets/StagePage-'))).toHaveLength(1)
  await context.close()
})

test('chunk sân khấu lỗi: tải lại đúng một lần rồi báo lỗi có nút tải lại; trang chào không bị tải lại', async ({
  browser,
}) => {
  const context = await freshContext(browser)
  // Chặn chunk ngay từ đầu: lần nạp trước trên trang chào cũng lỗi, nhưng lỗi nạp trước phải im lặng.
  let aborted = 0
  await context.route(/\/assets\/StagePage-[\w-]+\.js$/, (r) => {
    aborted++
    return r.abort()
  })
  const page = await context.newPage()
  let landingLoads = 0
  page.on('load', () => landingLoads++)
  await seedConsent(page)
  // Lần nạp trước lúc rảnh chạy và bị chặn; trang chào vẫn ở đó, không tải lại, không báo lỗi.
  await expect.poll(() => aborted, { timeout: 15_000 }).toBeGreaterThanOrEqual(1)
  await page.waitForTimeout(500)
  await expect(page.locator('main.landing')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(landingLoads).toBe(1)

  const doc = await context.newPage()
  let loads = 0
  doc.on('load', () => loads++)
  await doc.goto(`${BASE}#/app`)
  await expect(doc.getByTestId('stage-boot-failed')).toBeVisible({ timeout: 20_000 })
  await expect(doc.getByRole('alert')).toContainText('Tải lại trang')
  await doc.waitForTimeout(1500)
  expect(loads).toBe(2)
  note(
    `chunk bị chặn: ${loads - 1} lần tải lại tự động rồi role=alert; trang chào ${landingLoads} lần load`,
  )
  await context.close()
})
