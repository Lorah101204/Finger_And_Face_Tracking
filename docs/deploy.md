# Triển khai web công khai (REL-01)

Tài liệu vận hành của bản công khai: địa chỉ, cách deploy và rollback, cách gắn tên miền, số đo tải, giới hạn host, kiểm sau triển khai và backlog từ pilot. Thiết kế ở mục REL-01 của [WORK-BREAKDOWN.md](WORK-BREAKDOWN.md), quyết định D-048 và D-050 trong [decisions.md](decisions.md). Số đo tự động của bản build (service worker, gốc đường dẫn, I9) nằm ở mục "E2E trên bản build" của [test-report-mask.md](test-report-mask.md).

## 1. Địa chỉ

| Mục | Giá trị |
|---|---|
| Địa chỉ tạm (GitHub Pages) | https://lorah101204.github.io/Finger_And_Face_Tracking/ (repo `Lorah101204/Finger_And_Face_Tracking`, `VITE_BASE=/Finger_And_Face_Tracking/`) |
| Tên miền riêng | chưa mua |
| Ứng dụng | `<địa chỉ>/#/app` (định tuyến hash, D-020); thêm `?mode=present` cho kiosk |
| Lần deploy đầu | 2026-09-20, commit đầu của `main` (xem tab Actions, workflow CI, job `deploy`) |

## 2. Cách deploy

Mỗi push lên `main` chạy workflow `CI` ([.github/workflows/ci.yml](../.github/workflows/ci.yml)):

1. Job `check`: lint, boundaries, invariants, Prettier, Mermaid, unit, unittest Python, e2e (camera giả), `npm run build` với `VITE_BASE` (biến repo `PAGES_BASE`, mặc định `/<repo>/`), kiểm build sạch (`dist/spike-assets` không có, `dist/sw.js` đã thay khóa, in dung lượng), `npm run test:deploy` trên chính `dist/` (service worker, gốc đường dẫn, không yêu cầu khác origin), rồi tải `dist/` lên làm artefact Pages.
2. Job `deploy` (chỉ push `main`, sau `check`): `actions/configure-pages` rồi `actions/deploy-pages`; địa chỉ in ở summary của lần chạy và ở environment `github-pages`.

Điều kiện một lần ở repo: Settings → Pages → Build and deployment → Source: **GitHub Actions**. Không cần `.nojekyll` hay `CNAME` trong `public/`.

Deploy tại chỗ để kiểm trước: `npm run build` rồi `npm run test:deploy` (đặt `VITE_BASE` giống CI nếu muốn thử gốc đường dẫn khác `/`; Git Bash trên Windows cần `MSYS_NO_PATHCONV=1`). `npx vite preview` mở bản build ở `http://localhost:4173`.

## 3. Rollback

- Tab Actions → lần chạy của commit tốt gần nhất → Re-run job `deploy`: artefact Pages của lần chạy đó được đưa lên lại (artefact giữ 90 ngày mặc định).
- Hoặc `git revert` commit lỗi rồi push `main`: CI build và deploy lại.
- Service worker: khóa cache theo build và theo `models.json`, nên bản rollback có khóa khác và cache của bản lỗi bị xóa ở lần mở kế; người dùng đang mở trang nhận bản mới khi tải lại (worker `skipWaiting` + `clients.claim`).

## 4. Tên miền riêng

Khi có tên miền (bước 7 của REL-01):

1. DNS ở nhà đăng ký: bốn bản ghi A cho apex tới `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`; AAAA `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153`; `www` CNAME `<user>.github.io`.
2. Settings → Pages → Custom domain: nhập tên miền, chờ kiểm DNS xanh (`dig <tên miền> +noall +answer -t A` trả bốn IP trên), bật **Enforce HTTPS** (chứng chỉ có thể tới 24 giờ).
3. Settings → Secrets and variables → Actions → Variables: `PAGES_BASE` = `/`. Push `main` để build lại với gốc `/` (trang ở `https://<user>.github.io/<repo>/` không còn đúng đường dẫn asset sau bước này; GitHub tự chuyển hướng về tên miền).
4. Ghi tên miền vào mục 1 và README.

## 5. Số đo

### 5.1 Bản build (đo tại chỗ 2026-09-20, `npm run test:deploy`, Windows 11, Chrome 153)

| Số đo | Chromium headless shell (EP wasm) | Chrome 153, GPU (EP webgpu) |
|---|---|---|
| `dist/` | 80,0 MB (`models/` 76 MB, `assets/` 1 MB); file lớn nhất `models/ort/ort-wasm-simd-threaded.jsep.wasm` 28,3 MB | như trên |
| Lần mở đầu, phản hồi `models/` + `assets/` | 12 phản hồi, 40,1 MB (loader jsep 28,3 MB) | 12 phản hồi, 38,5 MB (loader asyncify 26,8 MB) |
| Cache sau lần mở đầu | `wct-models-*` 7 file, `wct-app-*` 7 file | như trên |
| Lần mở hai | 12/12 phản hồi từ service worker; worker chỉ ra mạng 1 lần (trang, network-first) | như trên |
| Lần mở ba, offline | worker mặt và phân loại sẵn sàng, vùng mở | như trên |
| Yêu cầu khác origin trong ba lần mở | 0 trên 64 yêu cầu (27 tới `models/`) | 0 trên 64 |

Cùng kết quả với `VITE_BASE=/repo/` (trang và model dưới `/repo/`).

### 5.2 Trang công khai (chờ deploy thật)

Ghi sau lần deploy đầu theo bước 8 của REL-01: ngày, commit, trình duyệt; DevTools Network: tổng tải lần đầu và lần hai, mọi yêu cầu cùng origin; Application → Cache Storage có `wct-models-*` và `wct-app-*`; Lighthouse accessibility; thời gian tới khi worker mặt và tay sẵn sàng; thử tay thật với webcam (còn nợ từ INT-01, ROI-03).

| Mục | Chrome | Edge | Firefox (tay) | Safari (tay) |
|---|---|---|---|---|
| Ngày, commit | | | | |
| Tải lần đầu (MB, s) | | | | |
| Tải lần hai (MB) | | | | |
| Yêu cầu khác origin | | | | |
| Cache Storage | | | | |
| Camera, worker mặt, tay sẵn sàng | | | | |
| Lighthouse accessibility | | | | |

## 6. Giới hạn host (GitHub Pages)

- Site ≤ 1 GB (hiện 80 MB); băng thông mềm 100 GB/tháng: lần mở đầu khoảng 40 MB → khoảng 2 500 lượt mở lần đầu mỗi tháng; lần mở sau gần 0 nhờ service worker.
- Artefact deploy ≤ 10 GB, deploy quá 10 phút thì hủy.
- Không đặt được header HTTP: không COOP/COEP (wasm đơn luồng, D-013), không CSP header (I9 chốt bằng `networkGuard` và service worker).
- GitHub ghi IP người truy cập theo chính sách của GitHub; ứng dụng không gửi gì thêm (không telemetry, không API).
- `Cache-Control` của GitHub Pages là `max-age=600`; service worker không phụ thuộc vào nó.

## 7. Backlog từ pilot

Ghi sau buổi pilot (bước 10): ngày, cấu hình, phản hồi, việc cần làm.
