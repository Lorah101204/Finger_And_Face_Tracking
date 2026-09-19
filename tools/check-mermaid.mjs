// Kiểm tra cú pháp mọi khối ```mermaid trong một file Markdown bằng cách render thật với Mermaid (bản trong node_modules)
// trong Chromium headless của Playwright. Không phụ thuộc CDN. Thoát khác 0 nếu có sơ đồ lỗi.
// Chạy: node tools/check-mermaid.mjs docs/WORK-BREAKDOWN.md
/* global document */
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { chromium } from '@playwright/test'

const file = process.argv[2]
if (!file) {
  console.error('cách dùng: node tools/check-mermaid.mjs <file.md>')
  process.exit(1)
}

const blocks = []
let current = null
for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
  if (current === null && line.startsWith('```mermaid')) current = []
  else if (current !== null && line.startsWith('```')) {
    blocks.push(current.join('\n'))
    current = null
  } else if (current !== null) current.push(line)
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const html = `<!doctype html><meta charset="utf-8"><pre id="out">running</pre>
${blocks.map((b, i) => `<textarea class="src" data-name="${i + 1}">${esc(b)}</textarea>`).join('\n')}
<script type="module">
import mermaid from '/node_modules/mermaid/dist/mermaid.esm.min.mjs';
mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });
const lines = []; let i = 0;
for (const ta of document.querySelectorAll('textarea.src')) {
  i++;
  try { await mermaid.parse(ta.value); await mermaid.render('g' + i, ta.value); lines.push('OK ' + ta.dataset.name); }
  catch (e) { lines.push('ERROR ' + ta.dataset.name + ': ' + (e && e.message ? e.message : String(e))); }
}
lines.push('DONE ' + i);
document.getElementById('out').textContent = lines.join('\\n');
</script>`

const MIME = {
  '.mjs': 'text/javascript',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
}
const root = process.cwd()
const server = createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0]
  if (url === '/check.html') {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end(html)
    return
  }
  const p = normalize(join(root, decodeURIComponent(url)))
  if (!p.startsWith(root)) {
    res.statusCode = 403
    res.end()
    return
  }
  try {
    const data = readFileSync(p)
    res.setHeader('content-type', MIME[extname(p)] ?? 'application/octet-stream')
    res.end(data)
  } catch {
    res.statusCode = 404
    res.end()
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const { port } = server.address()

/**
 * REL-01: trong GitHub Actions, in thêm lệnh workflow `::error` để thông điệp lỗi thành annotation của check run (đọc
 * được qua API công khai, không cần tải log). Xuống dòng mã hóa %0A theo quy ước của Actions.
 */
function annotate(message) {
  if (!process.env.GITHUB_ACTIONS) return
  const one = message.replace(/\r?\n/g, '%0A').slice(0, 4000)
  console.log(`::error title=check-mermaid ${file}::${one}`)
}

const logs = []
let text = ''
try {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning')
      logs.push(`[console.${m.type()}] ${m.text()}`)
  })
  page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`))
  await page.goto(`http://127.0.0.1:${port}/check.html`)
  await page.waitForFunction(
    () => document.getElementById('out').textContent.includes('DONE'),
    null,
    { timeout: 120000 },
  )
  text = await page.locator('#out').textContent()
  await browser.close()
} catch (err) {
  const msg = `${file}: không render được: ${err?.message ?? err}\n${logs.join('\n')}`
  console.error(msg)
  annotate(msg)
  server.close()
  process.exit(1)
}
server.close()
for (const l of logs) console.log(l)
console.log(`${file}: ${blocks.length} sơ đồ`)
console.log(text)
if (text.includes('ERROR')) {
  // Toàn bộ kết quả (thông điệp lỗi của Mermaid nhiều dòng: vị trí, đoạn nguồn, token mong đợi) và log của trang.
  annotate(text + (logs.length ? '\n' + logs.join('\n') : ''))
  process.exit(1)
}
