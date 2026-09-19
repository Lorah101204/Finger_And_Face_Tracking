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

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
page.on('requestfailed', (r) => console.log('[requestfailed]', r.url(), r.failure()?.errorText))
await page.goto(`http://127.0.0.1:${port}/check.html`)
await page.waitForFunction(
  () => document.getElementById('out').textContent.includes('DONE'),
  null,
  {
    timeout: 60000,
  },
)
const text = await page.locator('#out').textContent()
await browser.close()
server.close()
console.log(`${file}: ${blocks.length} sơ đồ`)
console.log(text)
process.exit(text.includes('ERROR') ? 1 : 0)
