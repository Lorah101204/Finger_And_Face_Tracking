import { existsSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'
import { resolveBase } from './vite.config'

// REL-01 (D-050, mục 7.27): kiểm bản build production (dist/) qua `vite preview`: service worker chỉ chạy ở build,
// và đây là bộ test duy nhất chạy trên chính artefact sẽ deploy (đường dẫn theo VITE_BASE, loader ORT copy đúng cặp,
// không có yêu cầu nào rời origin). Chạy: `npm run build` rồi `npm run test:deploy`; đặt VITE_BASE giống lúc build
// (CI: /<repo>/). Project `chromium` (headless shell, không WebGPU: ORT wasm, loader jsep) luôn có; `chrome` thêm khi
// Chrome cài trên máy (GPU thật, WebGPU: loader asyncify) để phủ cả hai cặp loader. Cổng 4174, một worker, không
// song song với `test:e2e`. Kết quả JSON reports/deploy.json cho tools/test-report.mjs.
export const BASE = resolveBase(process.env.VITE_BASE)
const ORIGIN = 'http://127.0.0.1:4174'
const has = (p: string) => {
  try {
    return existsSync(p)
  } catch {
    return false
  }
}
const env = (k: string) => process.env[k] ?? ''
const CHROME_PATHS = [
  `${env('ProgramFiles')}\\Google\\Chrome\\Application\\chrome.exe`,
  `${env('ProgramFiles(x86)')}\\Google\\Chrome\\Application\\chrome.exe`,
  `${env('LOCALAPPDATA')}\\Google\\Chrome\\Application\\chrome.exe`,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/opt/google/chrome/chrome',
]
const only = process.env.DEPLOY_BROWSERS?.split(',')
  .map((s) => s.trim())
  .filter(Boolean)

export default defineConfig({
  testDir: 'tests/deploy',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ...(process.env.GITHUB_ACTIONS ? [['github'] as const] : []),
    ['json', { outputFile: 'reports/deploy.json' }],
  ],
  use: {
    baseURL: `${ORIGIN}${BASE}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ...(CHROME_PATHS.some(has)
      ? [{ name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }]
      : []),
  ].filter((p) => !only || only.includes(p.name)),
  webServer: {
    command: 'npx vite preview --host 127.0.0.1 --port 4174 --strictPort',
    url: `${ORIGIN}${BASE}`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
