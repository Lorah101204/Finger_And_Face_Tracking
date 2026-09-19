import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

// SETUP-00. Chromium với camera giả; clip y4m (TEST-00) chỉ được thêm khi file fixture tồn tại.
const clip = resolve('tests/e2e/fixtures/camera.y4m')
const fakeCameraArgs = [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  ...(existsSync(clip) ? [`--use-file-for-fake-video-capture=${clip}`] : []),
]

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5174',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], launchOptions: { args: fakeCameraArgs } },
    },
  ],
  // Cổng riêng (API 3100, web 5174) để không đụng dev server đang chạy. API dùng DB :memory: và admin cố định cho e2e.
  webServer: [
    {
      command: 'node --disable-warning=ExperimentalWarning --import tsx server/src/index.ts',
      url: 'http://127.0.0.1:3100/api/health',
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: 'test',
        PORT: '3100',
        HOST: '127.0.0.1',
        DATABASE_PATH: ':memory:',
        SESSION_SECRET: 'e2e-secret',
        ADMIN_USERNAME: 'admin',
        ADMIN_PASSWORD: 'e2e-password-123',
        RATE_LIMIT: '0',
      },
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 5174 --strictPort',
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_API_TARGET: 'http://127.0.0.1:3100' },
    },
  ],
})
