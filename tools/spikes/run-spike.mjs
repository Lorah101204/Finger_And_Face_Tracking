// SPIKE-00 runner chung: mở một trang spike trong Chromium của Playwright (cửa sổ hiển thị, camera giả),
// chờ window.__done rồi ghi JSON. Dev server phải đang chạy.
// Chạy: node tools/spikes/run-spike.mjs <s1|s2|s3|s5|s6> [query] [hậu tố tên file]
// Ví dụ: node tools/spikes/run-spike.mjs s6            -> docs/spikes/raw/s6.json
//        node tools/spikes/run-spike.mjs s1 "?only=main" -main
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const name = process.argv[2]
if (!name) {
  console.error('cách dùng: node tools/spikes/run-spike.mjs <tên trang> [query] [hậu tố]')
  process.exit(1)
}
const query = process.argv[3] ?? ''
const suffix = process.argv[4] ?? ''
const url = `http://localhost:5173/tools/spikes/${name}.html${query}`

// Chromium headless shell (mặc định của Playwright): môi trường chạy tool không spawn được chrome.exe có cửa sổ.
// Lưu ý: Playwright luôn thêm cờ tắt throttling nền, nên KHÔNG dùng runner này để đo hành vi tab nền.
/* global window, document */
const browser = await chromium.launch({
  headless: true,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
})
const context = await browser.newContext({ permissions: ['camera'] })
const page = await context.newPage()
page.on('console', (m) => console.log('[page]', m.text()))
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
await page.goto(url)
await page.waitForFunction(() => window.__done === true, null, { timeout: 300000 })
const results = await page.evaluate(() => {
  const c = document.createElement('canvas')
  const gl = c.getContext('webgl2') ?? c.getContext('webgl')
  const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info')
  return {
    ...window.__results,
    runner: {
      ua: navigator.userAgent,
      visibility: document.visibilityState,
      webglRenderer: gl && dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
    },
  }
})
mkdirSync('docs/spikes/raw', { recursive: true })
const file = `docs/spikes/raw/${name}${suffix}.json`
writeFileSync(file, JSON.stringify(results, null, 2) + '\n')
console.log(JSON.stringify(results, null, 2))
console.log(`đã ghi ${file}`)
await browser.close()
