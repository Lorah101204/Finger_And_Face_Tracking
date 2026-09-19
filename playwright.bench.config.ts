import { existsSync } from 'node:fs'
import { defineConfig, devices, firefox, webkit } from '@playwright/test'
import base from './playwright.config'

// QA-02: benchmark trên nhiều trình duyệt (ma trận thiết bị, docs/benchmark.md): `npm run test:bench`. Mỗi project là
// một trình duyệt; chỉ đưa vào những trình duyệt có sẵn trên máy: Chromium headless shell của Playwright (luôn có,
// SwiftShader), Chrome và Edge cài trên máy qua `channel` (không tải gì; ở chế độ headless mới vẫn dùng GPU thật qua
// ANGLE), Firefox và WebKit của Playwright khi đã `npx playwright install firefox webkit`. Nguồn tổng hợp, không cần
// camera giả. Một worker, không thử lại; BENCH_SECONDS giây mỗi số đo (mặc định 20); BENCH_HEADED=1 để xem cửa sổ;
// BENCH_BROWSERS=chrome,msedge để chọn project. Kết quả thô ghi reports/bench-<project>.json (test tự ghi) và
// reports/bench.json (Playwright); tools/benchmark-report.mjs gộp vào docs/benchmark-matrix.json và docs/benchmark.md.
const seconds = Number(process.env.BENCH_SECONDS ?? 20)
const headless = process.env.BENCH_HEADED !== '1'
const only = process.env.BENCH_BROWSERS?.split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const has = (p: string) => {
  try {
    return existsSync(p)
  } catch {
    return false
  }
}
const env = (k: string) => process.env[k] ?? ''
/** Đường dẫn cài đặt thường gặp của Chrome và Edge (Playwright không cho hỏi executablePath theo channel). */
const CHANNEL_PATHS: Record<'chrome' | 'msedge', string[]> = {
  chrome: [
    `${env('ProgramFiles')}\\Google\\Chrome\\Application\\chrome.exe`,
    `${env('ProgramFiles(x86)')}\\Google\\Chrome\\Application\\chrome.exe`,
    `${env('LOCALAPPDATA')}\\Google\\Chrome\\Application\\chrome.exe`,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/opt/google/chrome/chrome',
  ],
  msedge: [
    `${env('ProgramFiles(x86)')}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${env('ProgramFiles')}\\Microsoft\\Edge\\Application\\msedge.exe`,
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/microsoft-edge',
    '/opt/microsoft/msedge/msedge',
  ],
}
const channelExists = (channel: 'chrome' | 'msedge') => CHANNEL_PATHS[channel].some(has)

const projects = [
  { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ...(channelExists('chrome')
    ? [{ name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome', headless } }]
    : []),
  ...(channelExists('msedge')
    ? [{ name: 'msedge', use: { ...devices['Desktop Edge'], channel: 'msedge', headless } }]
    : []),
  ...(has(firefox.executablePath())
    ? [{ name: 'firefox', use: { ...devices['Desktop Firefox'] } }]
    : []),
  ...(has(webkit.executablePath())
    ? [{ name: 'webkit', use: { ...devices['Desktop Safari'] } }]
    : []),
].filter((p) => !only || only.includes(p.name))

export default defineConfig({
  ...base,
  testDir: 'tests/bench',
  // Mỗi ca: nạp worker (tới 2 phút dưới tải) + BENCH_SECONDS × tối đa 2 lượt đo.
  timeout: 240_000 + 2 * seconds * 1000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'reports/bench.json' }]],
  projects,
})
