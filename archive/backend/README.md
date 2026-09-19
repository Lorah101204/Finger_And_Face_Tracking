# Dropped backend (D-019)

Archive of the code of packages API-00, WEB-00 (the backend variant), LOG-01 and ADM-01, written on 2026-09-17 under D-015 to D-018 and superseded by D-019: the project went back to a static client-only app as in the original plan. This folder is outside build, lint, tests and Prettier (`eslint.config.js` ignores `archive`, no `tsconfig.*.json` includes it, `.prettierignore` lists `archive/`).

Contents, with their original paths before the move:

- `server/`: Fastify + `node:sqlite`: config, db, migrations, repo, auth, routes/session, routes/admin, health, seed, index.
- `shared/events.ts`: event types and payload limits shared by client and server.
- `src/app/api.ts`, `session.ts`, `telemetry.ts`, `pages/AdminPage.tsx`: API client, cookie session, event batching, admin page. `LandingPage.tsx`, `StagePage.tsx`, `gate.ts`, `AppRouter.tsx`, `main.tsx` are copies from before the change.
- `tests/unit/server/app.test.ts`, `tests/e2e/admin.spec.ts`, the old `tests/e2e/landing.spec.ts`.
- `tsconfig.server.json`, `.env.example`, the old `package.json`, `vite.config.ts`, `playwright.config.ts`.
- `data/app.db*`: the dev SQLite database; `dist-server/`: the old build. Both stay in `.gitignore`.

To restore it if user statistics are ever needed again: move the files back to their original paths, add the dependencies and scripts of the old `package.json` (fastify, @fastify/cookie, @fastify/rate-limit, @fastify/static, zod; dev: tsx, concurrently; scripts dev:server, dev:all, build:server, start), reference `tsconfig.server.json`, the `/api` proxy in `vite.config.ts` and the backend webServer in `playwright.config.ts`. The design documentation of this variant is in `docs/WORK-BREAKDOWN.md` sections 4.7 and 5.14 in the git history before D-019.

This branch (`archive/backend`, orphan per D-024) can be deleted once it is no longer needed.
