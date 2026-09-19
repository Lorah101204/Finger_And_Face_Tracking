// SPIKE-00: tạo public/spike-assets/test.webm (16 s, 1280x720, VP8) bằng MediaRecorder trong Chromium headless của Playwright.
// Dùng làm nguồn video decode độc lập rAF cho S4 (tab nền) và S5. Chạy: node tools/spikes/make-webm.mjs
/* global document, requestAnimationFrame, MediaRecorder */
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
await page.goto('about:blank')
const b64 = await page.evaluate(async (ms) => {
  const canvas = document.createElement('canvas')
  canvas.width = 1280
  canvas.height = 720
  const ctx = canvas.getContext('2d')
  let t = 0
  const anim = () => {
    ctx.fillStyle = `hsl(${t % 360} 60% 50%)`
    ctx.fillRect(0, 0, 1280, 720)
    ctx.fillStyle = '#fff'
    ctx.fillRect((t * 5) % 1280, 100, 60, 60)
    t++
    requestAnimationFrame(anim)
  }
  anim()
  const rec = new MediaRecorder(canvas.captureStream(30), { mimeType: 'video/webm;codecs=vp8' })
  const chunks = []
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data)
  }
  const stopped = new Promise((r) => (rec.onstop = r))
  rec.start(500)
  await new Promise((r) => setTimeout(r, ms))
  rec.stop()
  await stopped
  const bytes = new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer())
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return btoa(s)
}, 16000)
mkdirSync('public/spike-assets', { recursive: true })
writeFileSync('public/spike-assets/test.webm', Buffer.from(b64, 'base64'))
console.log(`đã ghi public/spike-assets/test.webm (${Buffer.from(b64, 'base64').length} byte)`)
await browser.close()
