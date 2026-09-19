# Backend đã bỏ (D-019)

Lưu trữ mã của các gói API-00, WEB-00 (bản có backend), LOG-01, ADM-01 làm ngày 17/09/2026 theo D-015..D-018, bị thay bởi D-019: dự án quay về ứng dụng tĩnh thuần client như kế hoạch gốc. Thư mục này nằm ngoài build, lint, test và prettier (`eslint.config.js` bỏ qua `archive`, `tsconfig.*.json` không include, `.prettierignore` có `archive/`).

Nội dung, đường dẫn gốc trước khi chuyển:

- `server/` — Fastify + `node:sqlite`: config, db, migration, repo, auth, routes/session, routes/admin, health, seed, index.
- `shared/events.ts` — loại sự kiện và giới hạn payload dùng chung client/server.
- `src/app/api.ts`, `session.ts`, `telemetry.ts`, `pages/AdminPage.tsx` — client gọi API, phiên cookie, gom sự kiện, trang admin. `LandingPage.tsx`, `StagePage.tsx`, `gate.ts`, `AppRouter.tsx`, `main.tsx` là bản sao trước khi sửa.
- `tests/unit/server/app.test.ts`, `tests/e2e/admin.spec.ts`, bản cũ của `tests/e2e/landing.spec.ts`.
- `tsconfig.server.json`, `.env.example`, bản cũ của `package.json`, `vite.config.ts`, `playwright.config.ts`.
- `data/app.db*` — DB SQLite dev; `dist-server/` — build cũ. Cả hai vẫn nằm trong `.gitignore`.

Khôi phục nếu sau này cần thống kê người dùng: đưa các file về đường dẫn gốc, thêm lại dependency và script trong `package.json` cũ (fastify, @fastify/cookie, @fastify/rate-limit, @fastify/static, zod; dev: tsx, concurrently; scripts dev:server, dev:all, build:server, start), reference `tsconfig.server.json`, proxy `/api` trong `vite.config.ts`, webServer backend trong `playwright.config.ts`. Tài liệu thiết kế của bản này: `docs/WORK-BREAKDOWN.md` mục 4.7 và 5.14 trong lịch sử git trước D-019.

Có thể xóa cả thư mục này sau khi đã commit, nếu không cần.
