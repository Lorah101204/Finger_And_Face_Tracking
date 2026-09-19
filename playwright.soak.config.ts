import { defineConfig } from '@playwright/test'
import base from './playwright.config'

// PERF-01 bước 5: soak dài (mặc định 15 phút, SOAK_MINUTES) chạy riêng: `npm run test:soak`. Một worker, không thử
// lại, cùng dev server cổng 5174 và camera giả như bộ e2e (không chạy song song với `test:e2e`). Kết quả thô ghi
// reports/soak.json (Playwright) và reports/soak-samples.json (test tự ghi, tools/benchmark-report.mjs đọc).
const minutes = Number(process.env.SOAK_MINUTES ?? 15)

export default defineConfig({
  ...base,
  testDir: 'tests/soak',
  timeout: (minutes + 6) * 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'reports/soak.json' }]],
})
