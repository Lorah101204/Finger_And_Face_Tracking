import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

// SETUP-00. Chromium với camera giả; clip y4m (TEST-00) chỉ được thêm khi file fixture tồn tại.
const clip = resolve('tests/e2e/fixtures/camera.y4m')
const fakeCameraArgs = [
  '--use-fake-ui-for-media-stream',
  // device-count=2 cho hai camera giả để e2e thử đổi camera (CAM-01).
  '--use-fake-device-for-media-stream=device-count=2',
  ...(existsSync(clip) ? [`--use-file-for-fake-video-capture=${clip}`] : []),
]

export default defineConfig({
  testDir: 'tests/e2e',
  // FACE-01: mọi trang đều khởi tạo worker mặt (wasm, model, warm-up) nên ca nặng chậm gấp ba khi 8 trang chạy song song.
  timeout: 60_000,
  fullyParallel: true,
  // HAND-01: các ca tay chạy worker CPU liên tục; 8 trang song song trên máy 16 luồng làm khởi tạo worker mặt và suy
  // luận chậm gấp nhiều lần (kết quả mặt quá tuổi, khởi tạo hơn một phút); HAND-01 chọn 6 worker, QA-03 hạ xuống 2. QA-01: runner
  // CI (4 vCPU) chạy 2 worker và thử lại một lần; JSON reporter ghi reports/e2e.json cho tools/test-report.mjs (kèm annotations "đo"; không để trong test-results/ vì
  // Playwright xóa thư mục đó đầu mỗi lần chạy).
  // QA-03 (D-067): 2 worker cả khi chạy cục bộ. Đo 2026-10-03 trên máy 16 luồng (81 ca): 4 worker 195 đến 200 s và
  // mỗi lượt một ca chập chờn, 3 worker 189 đến 202 s và một lượt hai ca chập chờn, 2 worker 210 đến 222 s và luôn đạt;
  // các worker MediaPipe đã chiếm CPU nên thêm trang song song chỉ nhanh hơn khoảng 10 % mà làm kết quả quá tuổi.
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  // REL-01: trong GitHub Actions thêm reporter github để ca đỏ thành annotation của check run (đọc được không cần log).
  reporter: [
    ['list'],
    ...(process.env.GITHUB_ACTIONS ? [['github'] as const] : []),
    ['json', { outputFile: 'reports/e2e.json' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:5174',
    permissions: ['camera'],
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], launchOptions: { args: fakeCameraArgs } },
    },
  ],
  // Cổng riêng 5174 để không đụng dev server đang chạy. Không có backend (D-019).
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5174 --strictPort',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
