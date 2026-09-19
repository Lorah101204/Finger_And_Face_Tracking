// UX-02: chụp màn hình bắt đầu (1280 × 720, 1920 × 1080, 390 × 844) và sân khấu với lớp hướng dẫn (UX-01) vào
// docs/screenshots/ bằng Chromium của Playwright trên dev server Vite khởi động tại chỗ (cổng 5175, không đụng dev
// server đang chạy và cổng e2e 5174). Chạy: npm run screenshots. Sân khấu dùng nguồn tổng hợp (?debug=1&source=synthetic)
// nên không cần camera; không có gì rời máy (I9). UX-03 (D-049): thêm sân khấu ở chế độ trình diễn (?mode=present, cột
// cài đặt mở để thấy tấm kính) và màn hình bắt đầu kiosk (/#/?mode=present).
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'

/* global window */

const ROOT = process.cwd()
const OUT = join(ROOT, 'docs', 'screenshots')
const PORT = 5175
const CONSENT_KEY = 'wct.consent'

mkdirSync(OUT, { recursive: true })
const server = await createServer({
  root: ROOT,
  server: { port: PORT, strictPort: true, host: '127.0.0.1' },
})
await server.listen()
const base = `http://127.0.0.1:${PORT}`
const browser = await chromium.launch()
const written = []

async function shot(name, { width, height, path, setup, ready, after, scale = 1 }) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
  })
  const page = await context.newPage()
  if (setup) await setup(page)
  await page.goto(`${base}/${path}`)
  if (ready) await ready(page)
  if (after) await after(page)
  await page.waitForTimeout(1500)
  const file = join(OUT, `${name}.png`)
  await page.screenshot({ path: file })
  written.push(`${name}.png (${width} × ${height})`)
  await context.close()
}

try {
  await shot('landing-1280x720', { width: 1280, height: 720, path: '#/' })
  await shot('landing-1920x1080', { width: 1920, height: 1080, path: '#/' })
  await shot('landing-390x844', { width: 390, height: 844, path: '#/', scale: 2 })
  await shot('landing-kiosk-1280x720', { width: 1280, height: 720, path: '#/?mode=present' })
  // Sân khấu: đã đồng ý, nguồn tổng hợp, cửa sổ chuột 8 ô ở giữa bảng → lớp hướng dẫn bước 3.
  await shot('stage-guide-1280x720', {
    width: 1280,
    height: 720,
    path: '#/app?debug=1&source=synthetic',
    // Chờ worker mặt sẵn sàng để lớp hướng dẫn ở bước 3 "Đang tìm khuôn mặt" thay vì "Đang nạp".
    ready: (page) =>
      page.waitForFunction(() => window.__wct?.face?.snapshot().ready === true, undefined, {
        timeout: 90_000,
      }),
    setup: async (page) => {
      await page.addInitScript(
        ([k, v]) => {
          localStorage.setItem(k, v)
          sessionStorage.setItem('wct.ui', JSON.stringify({ settingsOpen: true, debugOpen: false }))
        },
        [CONSENT_KEY, await consentVersion()],
      )
      // Mã trong waitForFunction và evaluate chạy trong trang (Playwright chuyển thành chuỗi), không phải trong Node.
      page.on('load', () => {
        page
          .waitForFunction(() => Boolean(window.__scenario), undefined, { timeout: 10_000 })
          .then(() => page.evaluate(() => window.__scenario.run('windowAt(28,10,10)')))
          .catch(() => {})
      })
    },
  })
  // UX-03: chế độ trình diễn với cửa sổ chuột mở, cột cài đặt (tấm kính) mở, lớp nổi đang hiện.
  await shot('stage-present-1280x720', {
    width: 1280,
    height: 720,
    path: '#/app?debug=1&source=synthetic&mode=present',
    ready: (page) =>
      page.waitForFunction(() => window.__wct?.face?.snapshot().ready === true, undefined, {
        timeout: 90_000,
      }),
    setup: async (page) => {
      await page.addInitScript(
        ([k, v]) => {
          localStorage.setItem(k, v)
          sessionStorage.removeItem('wct.ui')
        },
        [CONSENT_KEY, await consentVersion()],
      )
      page.on('load', () => {
        page
          .waitForFunction(() => Boolean(window.__scenario), undefined, { timeout: 10_000 })
          .then(() => page.evaluate(() => window.__scenario.run('windowAt(20,8,12)')))
          .catch(() => {})
      })
    },
    after: async (page) => {
      await page.getByRole('button', { name: 'Cài đặt' }).click()
      await page.mouse.move(400, 400)
    },
  })
} finally {
  await browser.close()
  await server.close()
}
console.log(`đã ghi ${OUT}:\n  ${written.join('\n  ')}`)

async function consentVersion() {
  // Đọc CONSENT_VERSION từ mã nguồn để không lệch khi đổi văn bản đồng ý.
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(join(ROOT, 'src', 'app', 'session.ts'), 'utf8')
  const m = /CONSENT_VERSION = '([^']+)'/.exec(src)
  if (!m) throw new Error('không tìm thấy CONSENT_VERSION trong src/app/session.ts')
  return m[1]
}
