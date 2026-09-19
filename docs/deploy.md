# Public web deployment (REL-01)

Operations document for the public release: address, how to deploy and roll back, how to attach a domain, load measurements, host limits, post-deployment checks and the backlog from the pilot. The design is in section REL-01 of [WORK-BREAKDOWN.md](WORK-BREAKDOWN.md), decisions D-048 and D-050 in [decisions.md](decisions.md). Automated measurements of the production build (service worker, base path, I9) are in the "E2E on the production build" section of [test-report-mask.md](test-report-mask.md).

## 1. Address

| Item | Value |
|---|---|
| Temporary address (GitHub Pages) | https://lorah101204.github.io/Finger_And_Face_Tracking/ (repo `Lorah101204/Finger_And_Face_Tracking`, `VITE_BASE=/Finger_And_Face_Tracking/`) |
| Custom domain | not yet purchased |
| Application | `<address>/#/app` (hash routing, D-020); add `?mode=present` for kiosk |
| First deploy | 2026-09-20, first commit of `main` (see the Actions tab, workflow CI, job `deploy`) |

## 2. How to deploy

Every push to `main` runs the `CI` workflow ([.github/workflows/ci.yml](../.github/workflows/ci.yml)):

1. Job `check`: lint, boundaries, invariants, Prettier, Mermaid, unit, Python unittest, e2e (fake camera), `npm run build` with `VITE_BASE` (repository variable `PAGES_BASE`, default `/<repo>/`), clean build check (`dist/spike-assets` absent, `dist/sw.js` has its key replaced, size printed), `npm run test:deploy` on that same `dist/` (service worker, base path, no cross-origin requests), then upload `dist/` as the Pages artifact.
2. Job `deploy` (only on push to `main`, after `check`): `actions/configure-pages` then `actions/deploy-pages`; the address is printed in the run summary and in the `github-pages` environment.

One-time repo prerequisite: Settings → Pages → Build and deployment → Source: **GitHub Actions**. No `.nojekyll` or `CNAME` is needed in `public/`.

Local deploy for a pre-check: `npm run build` then `npm run test:deploy` (set `VITE_BASE` like CI to try a base path other than `/`; Git Bash on Windows needs `MSYS_NO_PATHCONV=1`). `npx vite preview` serves the production build at `http://localhost:4173`.

## 3. Rollback

- Actions tab → the run of the last good commit → Re-run job `deploy`: that run's Pages artifact is published again (artifacts are kept 90 days by default).
- Or `git revert` the bad commit and push `main`: CI builds and deploys again.
- Service worker: the cache key follows the build and `models.json`, so the rolled-back version has a different key and the bad version's cache is deleted on the next load; users with the page open get the new version on reload (the worker uses `skipWaiting` + `clients.claim`).

## 4. Custom domain

When a domain is available (REL-01 step 7):

1. DNS at the registrar: four A records for the apex to `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`; AAAA `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153`; `www` CNAME `<user>.github.io`.
2. Settings → Pages → Custom domain: enter the domain, wait for the DNS check to turn green (`dig <domain> +noall +answer -t A` returns the four IPs above), enable **Enforce HTTPS** (the certificate can take up to 24 hours).
3. Settings → Secrets and variables → Actions → Variables: `PAGES_BASE` = `/`. Push `main` to rebuild with base `/` (the page at `https://<user>.github.io/<repo>/` no longer has correct asset paths after this step; GitHub redirects to the domain automatically).
4. Record the domain in section 1 and the README.

## 5. Measurements

### 5.1 Production build (measured locally 2026-09-20, `npm run test:deploy`, Windows 11, Chrome 153)

| Measurement | Chromium headless shell (EP wasm) | Chrome 153, GPU (EP webgpu) |
|---|---|---|
| `dist/` | 80.0 MB (`models/` 76 MB, `assets/` 1 MB); largest file `models/ort/ort-wasm-simd-threaded.jsep.wasm` 28.3 MB | same |
| First load, `models/` + `assets/` responses | 12 responses, 40.1 MB (jsep loader 28.3 MB) | 12 responses, 38.5 MB (asyncify loader 26.8 MB) |
| Cache after the first load | `wct-models-*` 7 files, `wct-app-*` 7 files | same |
| Second load | 12/12 responses from the service worker; the worker goes to the network once (the page, network-first) | same |
| Third load, offline | face and classifier workers ready, region opens | same |
| Cross-origin requests over three loads | 0 of 64 requests (27 to `models/`) | 0 of 64 |

Same results with `VITE_BASE=/repo/` (page and models under `/repo/`).

### 5.2 Public site (pending the real deploy)

Record after the first deploy per REL-01 step 8: date, commit, browser; DevTools Network: total transfer on the first and second load, all requests same-origin; Application → Cache Storage has `wct-models-*` and `wct-app-*`; Lighthouse accessibility; time until the face and hand workers are ready; real hands with a webcam (still owed from INT-01, ROI-03).

| Item | Chrome | Edge | Firefox (manual) | Safari (manual) |
|---|---|---|---|---|
| Date, commit | | | | |
| First load (MB, s) | | | | |
| Second load (MB) | | | | |
| Cross-origin requests | | | | |
| Cache Storage | | | | |
| Camera, face and hand workers ready | | | | |
| Lighthouse accessibility | | | | |

## 6. Host limits (GitHub Pages)

- Site ≤ 1 GB (currently 80 MB); soft bandwidth limit 100 GB/month: a first load is about 40 MB → about 2 500 first loads per month; later loads are near 0 thanks to the service worker.
- Deploy artifact ≤ 10 GB; a deploy over 10 minutes is cancelled.
- HTTP headers cannot be set: no COOP/COEP (single-threaded wasm, D-013), no CSP header (I9 is enforced by `networkGuard` and the service worker).
- GitHub logs visitor IPs under GitHub's policy; the application sends nothing else (no telemetry, no API).
- GitHub Pages' `Cache-Control` is `max-age=600`; the service worker does not depend on it.

## 7. Backlog from the pilot

Record after the pilot session (step 10): date, setup, feedback, to-do items.
