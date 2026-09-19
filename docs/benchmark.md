# Benchmark hiệu năng và ma trận thiết bị (PERF-01, QA-02)

Số đo hiệu năng của PoC với mục tiêu ở WORK-BREAKDOWN mục 3 ("Tần suất mục tiêu": output ≥ 30 FPS, hand ≥ 20 Hz, face 10 đến 15 Hz, classifier 3 đến 5 Hz). Mục 4 "Kết quả soak" do `npm run bench:report` sinh từ `reports/soak-samples.json` (soak 15 phút, `npm run test:soak`, PERF-01). Mục 5 "Ma trận thiết bị và trình duyệt" (QA-02) do cùng lệnh sinh từ `docs/benchmark-matrix.json`, nơi gộp kết quả của `npm run test:bench` trên từng máy và trình duyệt. Mục 6 ghi tham số chốt trong `src/core/config.ts` và lý do theo số đo (D-045).

## 1. Cách đo

- **Sampler** (`src/debug/stats.ts`): mỗi 250 ms ghi bộ đếm frame của vòng lặp, kết quả mặt, kết quả tay, kết quả phân loại; tần suất là Δđếm / Δt trên cửa sổ 2 s. p50 và p95 inferMs lấy từ cửa sổ 20 mẫu của `FaceClient`, `HandClient` và `ClassifierClient` (`src/core/latency.ts`); thời gian vẽ và tick của vòng lặp từ cửa sổ 120 frame. Dòng overlay "hiệu năng" trên sân khấu và `window.__wct.stats.snapshot()` đọc cùng sampler.
- **Rate control**: worker mặt một tác vụ tại một thời điểm, nhịp gửi `max(1000 / face.targetHz, p50 inferMs)` (targetHz 12) nên tần suất mặt không vượt 12 Hz và tự giảm khi suy luận chậm; worker tay nhận frame mới ngay khi rảnh (không xếp hàng); classifier `max(1000 / classifier.targetHz, p50)` (targetHz 4) trên bitmap thứ hai của cùng crop.
- **Cấp phát và bitmap**: mỗi buffer suy luận là một `ImageBitmap` (`transferToImageBitmap`) chuyển quyền sở hữu cho worker và được đóng ở worker sau `detect` (kể cả khi lỗi), hoặc đóng ngay ở client khi không gửi được; canvas crop và canvas letterbox tái sử dụng (`restrictedFrame.ts`); frame gốc cho worker tay là `createImageBitmap` duy nhất ở `handClient.ts`, đóng ở worker. Cửa sổ trễ ghi vòng trên mảng cố định. Còn lại mỗi frame chỉ cấp phát các object nhỏ (`FrameOutput`, mask của tứ giác) và không giữ tham chiếu; soak đo heap sau GC để xác nhận không tăng dần.
- **React**: mọi dòng trạng thái đọc qua `useSyncExternalStore` với nhịp 250 ms (`subscribeTick`, sampler), không `setState` theo frame; vòng lặp vẽ nằm ngoài React.
- **Soak** (`tests/soak/soak.spec.ts`, cấu hình `playwright.soak.config.ts`, `SOAK_MINUTES` mặc định 15, `SOAK_SAMPLE_S` mặc định 30): Chromium headless của Playwright, nguồn tổng hợp, vùng mở theo tay (worker tay thật với `hands.jpg` cục bộ, hoặc tay giả lập chạy quỹ đạo khi thiếu ảnh), worker mặt nhận buffer liên tục, gate audit chạy suốt. Mỗi mẫu: stats, heap JS sau khi ép GC (`HeapProfiler.collectGarbage` rồi `Performance.getMetrics` qua CDP; `performance.measureUserAgentSpecificMemory` cần COOP/COEP nên không dùng), số node DOM và listener, tác vụ chờ, trạng thái vùng, lỗi trang. Khẳng định trong test: không lỗi trang, chờ ≤ 1 ở mọi mẫu, heap phần ba cuối không vượt phần ba đầu quá 15 % hay 8 MB, node và listener không tăng dần, fps phần ba cuối ≥ 60 % phần ba đầu, mặt vẫn có kết quả, vùng mở hơn 90 % thời gian, gate cứng sạch.
- **Bench nhiều trình duyệt** (QA-02, `tests/bench/bench.spec.ts`, cấu hình `playwright.bench.config.ts`, `npm run test:bench`): mỗi project là một trình duyệt có sẵn trên máy: Chromium headless shell của Playwright (SwiftShader), Chrome và Edge đã cài (qua `channel`, không tải gì; ở chế độ headless mới vẫn dùng GPU thật qua ANGLE), Firefox và WebKit của Playwright khi đã `npx playwright install firefox webkit`. Bốn ca, `BENCH_SECONDS` giây mỗi số đo (mặc định 20): (1) môi trường: trình duyệt, số luồng, WebGL renderer, adapter WebGPU, các API app dựa vào (`window.__wct.env`, dòng `env-stat` của panel debug), worker mặt sẵn sàng với delegate nào; (2) cửa sổ chuột trên `face.png` (cục bộ) hay nền tổng hợp: stats mỗi giây và bộ thu theo rAF trong trang ghi mốc của từng kết quả (khoảng cách p50/p95/max giữa hai kết quả liên tiếp) và tuổi lúc gate nhận của mặt và phân loại, số kết quả bị loại vì quá tuổi; (3) phân loại ép wasm (`ep=wasm`) để so với EP mặc định; (4) tay thật trên `hands.jpg` (cục bộ) với `hands=CPU` rồi `hands=GPU`: Hz, p50/p95, khoảng cách kết quả, tỉ lệ vùng mở, độ rung đầu ngón cái và trỏ trên ảnh tĩnh (σ px camera và ô). Kết quả thô `reports/bench-<project>.json`; `bench:report` gộp vào `docs/benchmark-matrix.json` (một dòng cho mỗi máy + GPU + trình duyệt + headless, lần đo mới thay lần cũ) và sinh mục 5.
- **Canvas 2D hay WebGL** (PERF-01 bước 6): giữ Canvas 2D khi thời gian vẽ p95 nằm dưới ngân sách một frame 60 fps (16,7 ms); số đo ở bảng dưới.

## 2. Giới hạn của số đo headless

Chromium headless shell của Playwright chạy WebGL qua SwiftShader (CPU) và không có adapter WebGPU, nên GPU delegate của MediaPipe và EP webgpu của ONNX Runtime không đại diện cho máy mục tiêu: worker mặt (GPU delegate) p50 30 ms trên GPU thật so với 110 ms headless khi có mặt; worker tay GPU delegate 2 Hz headless so với 29 Hz trên GPU thật. Chrome và Edge chạy qua `channel` của Playwright (kể cả headless) dùng GPU thật của máy, nên ma trận mục 5 có cả cận dưới (shell) lẫn số đo thật của máy đó; `requestAnimationFrame` của shell chạy 60 Hz, của Chrome và Edge headless theo tần số màn hình (144 Hz trên máy phát triển). CI (Linux, không GPU) chỉ có dòng shell.

## 3. Đo một lần trong trình duyệt có GPU (PERF-01, thủ công, đã được mục 5 thay thế)

Cùng máy (i5-12500H, RTX 3050 Laptop, Windows 11), Chromium 152 của pane trình duyệt trong ứng dụng Claude, WebGL qua ANGLE D3D11; nguồn tổng hợp với `hands.jpg`, nguồn cửa sổ "Tay", tuổi điểm 1000 ms; đọc `window.__wct.stats.snapshot()` bốn lần cách 2,5 s sau 30 s chạy (2026-09-18). Giữ lại để đối chiếu; QA-02 đo lại tự động trong mục 5.

| Chỉ số | Đo được | So với mục tiêu |
|---|---|---|
| Output FPS | 59,7 đến 60,0 | đạt (≥ 30) |
| Hand Hz (CPU delegate, D-009) | 14,9 đến 15,0 (p50 53 đến 59 ms, p95 59 đến 66 ms) | không đạt (≥ 20); QA-02 chuyển sang GPU delegate trên máy có GPU (D-045, mục 6) |
| Face Hz (GPU delegate) | 11,0 đến 11,5 (p50 5 đến 6 ms, p95 7 đến 8 ms) | đạt (10 đến 15, giới hạn bởi targetHz 12) |
| Thời gian vẽ | p50 0,1 ms, p95 0,2 ms | đạt (< 16,7 ms) |
| Tick vòng lặp p95 | 0,6 ms | ghi nhận |
| Tác vụ mặt chờ | 0 ở cả bốn lần đọc | đạt |

## 4. Kết quả soak

<!-- bench:begin -->
Sinh bởi `npm run bench:report` (`tools/benchmark-report.mjs`) từ `reports/soak-samples.json`. Không sửa tay phần này.

### Môi trường và kịch bản

| Mục | Giá trị |
|---|---|
| Máy | 12th Gen Intel(R) Core(TM) i5-12500H, 16 luồng, 16 GB; Windows_NT 10.0.26200 (x64) |
| Trình duyệt | Chrome Headless Shell 153.0.8010.12 (Playwright build 1243), headless, 1 worker |
| Node.js | v24.11.0 |
| Kịch bản | nguồn tổng hợp 1280 × 720, worker tay thật trên `hands.jpg` tĩnh (tuổi điểm 1000 ms), worker mặt GPU/CPU theo D-008 nhận buffer liên tục, gate audit 2 Hz |
| Thời lượng | 15 phút, 31 mẫu cách 30 s, bắt đầu 2026-09-18T07:15:56.928Z |

### Mục tiêu và kết quả

| Chỉ số | Mục tiêu | Đo được | Kết luận |
|---|---|---|---|
| Output FPS (trung vị) | ≥ 30 | 60,0 | đạt |
| Output FPS ổn định (phần ba cuối so với phần ba đầu) | ≥ 60 % | 60,0 → 59,8 fps | đạt |
| Hand Hz (trung vị) | ≥ 20 | 10,1 (p50 85 ms, p95 tối đa 146 ms) | không đạt |
| Face Hz (trung vị) | 10 đến 15 (targetHz 12) | 10,5 (p50 36 ms, p95 tối đa 46 ms) | đạt |
| Classifier Hz | 3 đến 5 | không đo (mẫu soak trước CLS-02) | không áp dụng |
| Thời gian vẽ p95 tối đa | < 16,7 ms (một frame 60 fps) | 0,40 ms | đạt |
| Tick vòng lặp p95 tối đa | ghi nhận | 1,60 ms |  |
| Tác vụ mặt chờ | ≤ 1 ở mọi mẫu | 1 | đạt |
| Heap JS sau GC (phần ba đầu → cuối) | tăng ≤ 15 % hoặc ≤ 8 MB | 10,5 → 10,7 MB (1,8 %), tối đa 10,7 MB | đạt |
| Node DOM, listener (đầu → cuối) | không tăng dần | +0 node, +0 listener | đạt |
| Vùng mở | > 90 % mẫu | 100 % | đạt |
| Buffer rớt (worker mặt bận), frame tay bỏ | ghi nhận | 0 buffer, 39720 frame |  |
| Gate cứng (ảnh tham chiếu) | 0 buffer lệch | 1590 buffer, 0 lệch | đạt |
| Lỗi trang, crash | 0 | 0 lỗi trang, 0 console.error (trừ dòng INFO của MediaPipe) | đạt |

### Mẫu theo thời gian

| t (s) | fps | tay Hz | mặt Hz | mặt p50 / p95 ms | vẽ p50 / p95 ms | heap MB | node | listener | chờ | vùng |
|---|---|---|---|---|---|---|---|---|---|---|
| 10 | 59,9 | 8,5 | 11,0 | 39 / 41 | 0,20 / 0,40 | 10,0 | 696 | 219 | 0 | mở |
| 40 | 60,5 | 9,1 | 10,6 | 37 / 46 | 0,20 / 0,30 | 10,4 | 696 | 219 | 0 | mở |
| 70 | 60,0 | 8,0 | 10,5 | 39 / 41 | 0,20 / 0,30 | 10,6 | 696 | 219 | 0 | mở |
| 100 | 60,1 | 10,0 | 10,5 | 36 / 39 | 0,20 / 0,30 | 10,6 | 696 | 219 | 1 | mở |
| 130 | 60,2 | 11,0 | 10,5 | 36 / 40 | 0,20 / 0,30 | 10,6 | 696 | 219 | 0 | mở |
| 160 | 59,4 | 10,5 | 10,5 | 36 / 39 | 0,20 / 0,20 | 10,6 | 696 | 219 | 0 | mở |
| 190 | 59,9 | 10,0 | 10,5 | 35 / 38 | 0,20 / 0,30 | 10,6 | 696 | 219 | 0 | mở |
| 221 | 60,1 | 10,5 | 10,5 | 37 / 38 | 0,20 / 0,30 | 10,6 | 696 | 219 | 1 | mở |
| 251 | 60,0 | 10,4 | 10,4 | 36 / 39 | 0,20 / 0,30 | 10,5 | 696 | 219 | 1 | mở |
| 281 | 59,8 | 10,0 | 11,0 | 36 / 38 | 0,20 / 0,30 | 10,5 | 696 | 219 | 0 | mở |
| 311 | 60,2 | 10,6 | 10,6 | 36 / 38 | 0,20 / 0,30 | 10,5 | 696 | 219 | 0 | mở |
| 341 | 59,9 | 10,1 | 10,6 | 37 / 40 | 0,20 / 0,30 | 10,5 | 696 | 219 | 0 | mở |
| 371 | 60,3 | 10,5 | 10,5 | 36 / 38 | 0,20 / 0,30 | 10,6 | 696 | 219 | 1 | mở |
| 401 | 59,8 | 10,0 | 10,5 | 36 / 37 | 0,20 / 0,30 | 10,6 | 696 | 219 | 0 | mở |
| 431 | 60,0 | 10,0 | 10,5 | 36 / 38 | 0,20 / 0,30 | 10,6 | 696 | 219 | 0 | mở |
| 461 | 59,9 | 10,5 | 10,5 | 35 / 39 | 0,20 / 0,30 | 10,6 | 696 | 219 | 1 | mở |
| 491 | 60,3 | 10,5 | 11,0 | 35 / 39 | 0,20 / 0,30 | 10,6 | 696 | 219 | 1 | mở |
| 521 | 60,0 | 10,5 | 10,5 | 37 / 39 | 0,20 / 0,30 | 10,6 | 696 | 219 | 0 | mở |
| 551 | 59,9 | 10,0 | 10,5 | 36 / 39 | 0,20 / 0,30 | 10,6 | 696 | 219 | 1 | mở |
| 581 | 59,9 | 10,5 | 10,5 | 36 / 39 | 0,20 / 0,30 | 10,6 | 696 | 219 | 0 | mở |
| 611 | 60,0 | 10,5 | 10,5 | 35 / 37 | 0,20 / 0,30 | 10,6 | 696 | 219 | 0 | mở |
| 641 | 59,8 | 9,0 | 10,5 | 38 / 43 | 0,20 / 0,30 | 10,7 | 696 | 219 | 0 | mở |
| 671 | 59,8 | 10,4 | 10,4 | 35 / 38 | 0,20 / 0,30 | 10,7 | 696 | 219 | 1 | mở |
| 702 | 60,0 | 10,0 | 10,5 | 35 / 38 | 0,20 / 0,30 | 10,7 | 696 | 219 | 0 | mở |
| 732 | 60,0 | 10,5 | 10,5 | 36 / 38 | 0,20 / 0,20 | 10,7 | 696 | 219 | 1 | mở |
| 762 | 60,1 | 10,0 | 10,5 | 37 / 39 | 0,20 / 0,30 | 10,7 | 696 | 219 | 1 | mở |
| 792 | 59,2 | 9,9 | 10,4 | 36 / 39 | 0,20 / 0,30 | 10,7 | 696 | 219 | 0 | mở |
| 822 | 60,1 | 11,0 | 10,5 | 36 / 38 | 0,20 / 0,30 | 10,7 | 696 | 219 | 1 | mở |
| 852 | 59,5 | 9,9 | 9,9 | 36 / 38 | 0,20 / 0,30 | 10,7 | 696 | 219 | 0 | mở |
| 882 | 60,0 | 10,5 | 10,5 | 37 / 39 | 0,20 / 0,30 | 10,7 | 696 | 219 | 0 | mở |
| 900 | 59,9 | 10,0 | 10,5 | 35 / 39 | 0,20 / 0,30 | 10,7 | 696 | 219 | 1 | mở |
<!-- bench:end -->

## 5. Ma trận thiết bị và trình duyệt (QA-02)

<!-- matrix:begin -->
Sinh bởi `npm run bench:report` từ `docs/benchmark-matrix.json` (gộp `reports/bench-<project>.json` của `npm run test:bench`, mỗi máy + GPU + trình duyệt một dòng, lần đo mới thay lần cũ). Không sửa tay phần này.

### Máy, trình duyệt và API

| Máy | Trình duyệt | GPU (WebGL) | Adapter WebGPU | Worker mặt | Thiếu API | Ngày |
|---|---|---|---|---|---|---|
| 12th Gen Intel(R) Core(TM) i5-12500H, 16 luồng, 16 GB, Windows_NT 10.0.26200 (x64) | Chrome 153 (headless) | NVIDIA GeForce RTX 3050 Laptop GPU | nvidia | GPU, init 377 ms | SharedArrayBuffer | 2026-09-18 |
| 12th Gen Intel(R) Core(TM) i5-12500H, 16 luồng, 16 GB, Windows_NT 10.0.26200 (x64) | Chrome 153 (headless), Playwright shell | SwiftShader (CPU) | không | GPU, init 424 ms | SharedArrayBuffer | 2026-09-18 |
| 12th Gen Intel(R) Core(TM) i5-12500H, 16 luồng, 16 GB, Windows_NT 10.0.26200 (x64) | Edge 153 (headless) | NVIDIA GeForce RTX 3050 Laptop GPU | nvidia | GPU, init 389 ms | SharedArrayBuffer | 2026-09-18 |

### Số đo (cửa sổ chuột trên `face.png` hay nền tổng hợp; tay thật trên `hands.jpg`)

| Trình duyệt | Output fps | Mặt | Phân loại (EP mặc định) | Phân loại wasm | Tay CPU | Tay GPU | Rung đầu ngón (ảnh tĩnh) | Vẽ / tick p95 |
|---|---|---|---|---|---|---|---|---|
| Chrome 153 (headless) | 143,9 (tối thiểu 139,5) | 11,5 Hz (p50 32 / p95 73 ms; k/c p95 104 ms; quá tuổi 0) | webgpu (init 931 ms; p50 18,7 / p95 29,0 ms; 4,0 Hz; quá tuổi 0) | init 707 ms; p50 4,9 ms; 4,0 Hz | 11,5 Hz (CPU; init 676 ms; p50 83 / p95 88 ms; k/c p95 97 ms) | 28,9 Hz (GPU; init 691 ms; p50 26 / p95 39 ms; k/c p95 49 ms) | σ 0,12 px = 0,006 ô (GPU); vùng mở 100 % | 0,40 / 0,90 ms |
| Chrome 153 (headless), Playwright shell | 60,0 (tối thiểu 58,4) | 7,5 Hz (p50 112 / p95 142 ms; k/c p95 234 ms; quá tuổi 0) | wasm (init 1765 ms; p50 1,0 / p95 1,6 ms; 3,0 Hz; quá tuổi 0) | init 973 ms; p50 0,9 ms; 3,5 Hz | 9,5 Hz (CPU; init 2501 ms; p50 95 / p95 110 ms; k/c p95 131 ms) | 2,0 Hz (GPU; init 2114 ms; p50 458 / p95 484 ms; k/c p95 500 ms) | σ 0,08 px = 0,004 ô (GPU); vùng mở 100 % | 1,70 / 2,80 ms |
| Edge 153 (headless) | 143,9 (tối thiểu 139,8) | 11,5 Hz (p50 30 / p95 43 ms; k/c p95 97 ms; quá tuổi 0) | webgpu (init 982 ms; p50 19,5 / p95 29,0 ms; 4,0 Hz; quá tuổi 0) | init 646 ms; p50 4,3 ms; 4,0 Hz | 11,5 Hz (CPU; init 727 ms; p50 83 / p95 88 ms; k/c p95 97 ms) | 30,4 Hz (GPU; init 701 ms; p50 24 / p95 34 ms; k/c p95 49 ms) | σ 0,12 px = 0,006 ô (GPU); vùng mở 100 % | 0,40 / 0,70 ms |

### Tham số chốt so với số đo (`core/config.ts`)

Tuổi điểm tay (150 ms với GPU delegate, 250 ms với CPU) phải lớn hơn khoảng cách p95 giữa hai kết quả tay cộng inferMs p95 ở trạng thái ổn định (tuổi lớn nhất của điểm mới nhất ngay trước khi kết quả kế về, với delegate app tự chọn trên máy đó); tuổi kết quả mặt và phân loại: p95 tuổi lúc gate nhận không quá 80 % tuổi tối đa và không kết quả nào bị loại vì quá tuổi; tuổi nhãn chứa ít nhất hai khoảng cách p95 giữa hai kết quả phân loại; hysteresis theo ô lớn hơn ba lần độ rung đầu ngón trên ảnh tĩnh (tay giữ yên không đổi ô).

| Trình duyệt | Tuổi điểm tay | Tuổi kết quả mặt | Tuổi kết quả phân loại | Tuổi nhãn | Hysteresis |
|---|---|---|---|---|---|
| Chrome 153 (headless) | 150 (GPU) so với k/c p95 49 + infer p95 39 = 88 ms: đạt | p95 73 / max 113 ms so với 250 ms, quá tuổi 0: đạt | p95 61 / max 69 ms so với 600 ms, quá tuổi 0: đạt | 1500 ≥ 2 × k/c p95 272 = 544 ms: đạt | 0,25 ≥ 3 × 0,006 = 0,018 ô: đạt |
| Chrome 153 (headless), Playwright shell | 250 (CPU) so với k/c p95 131 + infer p95 110 = 241 ms: đạt | p95 155 / max 165 ms so với 250 ms, quá tuổi 0: đạt | p95 36 / max 42 ms so với 600 ms, quá tuổi 0: đạt | 1500 ≥ 2 × k/c p95 352 = 704 ms: đạt | 0,25 ≥ 3 × 0,002 = 0,007 ô: đạt |
| Edge 153 (headless) | 150 (GPU) so với k/c p95 49 + infer p95 34 = 83 ms: đạt | p95 67 / max 78 ms so với 250 ms, quá tuổi 0: đạt | p95 56 / max 66 ms so với 600 ms, quá tuổi 0: đạt | 1500 ≥ 2 × k/c p95 271 = 542 ms: đạt | 0,25 ≥ 3 × 0,006 = 0,018 ô: đạt |
<!-- matrix:end -->

### Đọc ma trận

- **Chromium headless shell** là cận dưới (SwiftShader, không WebGPU): mặt 8,5 Hz với `face.png` (p50 110 ms), tay CPU 9,5 Hz, phân loại wasm; đây cũng là môi trường của e2e và CI.
- **Chrome và Edge 153 trên RTX 3050**: output theo tần số màn hình, mặt 11,5 Hz do rate control (p50 30 ms, tuổi lúc nhận p95 68 ms), tay GPU delegate 28,5 đến 29,5 Hz (p50 25 đến 27 ms) so với CPU 10,5 đến 11 Hz, phân loại 4 Hz với cả hai EP: với model stub 360 byte, wasm 4,7 ms nhanh hơn webgpu 17 đến 20 ms vì chi phí điều phối GPU trội; S6 với MobileNetV2 cho kết quả ngược lại (webgpu 19 ms, wasm 59 ms), nên thứ tự EP giữ theo D-013 và đo lại bằng `ep=wasm` khi có model thật.
- **Rung đầu ngón trên ảnh tĩnh** là nhiễu của chính model (σ ≈ 0,05 px với CPU, 0,12 px với GPU delegate, tức dưới 0,01 ô ở lưới 64 × 36): hysteresis 0,25 ô dư hơn hai bậc; rung của tay người thật (run tay, hơi thở) chưa đo vì không có webcam trong môi trường công cụ.
- **Vùng mở 100 %** ở mọi lần đo tay với tuổi điểm 1000 ms (bench đặt như e2e để đo Hz không bị gián đoạn); tuổi điểm mặc định được chốt ở mục 6 theo khoảng cách kết quả và inferMs đo được.

### Firefox và Safari

Chưa đo trên máy phát triển: Firefox không cài, Safari không có trên Windows, và binary Firefox, WebKit của Playwright chưa tải (`npx playwright install firefox webkit`, khoảng 150 MB, cần người dùng chấp thuận; sau đó `npm run test:bench` tự thêm hai project). Cách kiểm thủ công: mở `#/app?debug=1&source=synthetic`, đọc dòng `env-stat` (API thiếu), `face-stat`, `hands-stat` (chọn nguồn "Tay"), `classifier-stat` (mở cửa sổ) trong panel Debug rồi ghi vào bảng dưới. Các API app dựa vào và fallback trong mã (theo tài liệu MDN, chưa kiểm ở đây):

| API | Dùng ở | Chromium | Firefox | Safari | Khi thiếu |
|---|---|---|---|---|---|
| `getUserMedia` | CAM-01 | có | có | có | không có camera thật; nguồn tổng hợp vẫn chạy |
| `requestVideoFrameCallback` | CAM-01 | có | có từ 132 | có từ 15.4 | `CameraSource` dùng rAF (đã có trong mã) |
| Module worker (`type: 'module'`) | D-008, mọi worker | có | có từ 114 | có từ 15 | không có fallback: app không chạy được |
| `OffscreenCanvas` + 2d trong worker | warm-up, letterbox, classifier, PNG dataset | có | có từ 105 | có từ 16.4 | không có fallback |
| `createImageBitmap`, transfer `ImageBitmap` | I1 | có | có | có | không có fallback |
| WebGL2 trong worker (GPU delegate MediaPipe) | face.worker, hand.worker | có | có | có | worker tự tạo lại với CPU delegate |
| WebGPU (`navigator.gpu` có adapter) | classifier (D-013) | có | Windows từ 141 | từ Safari 26 | ORT dùng EP wasm |
| wasm SIMD | MediaPipe, ORT | có | có | có từ 16.4 | không có fallback |
| `SharedArrayBuffer` | không cần (wasm đơn luồng, D-013) | cần COOP/COEP | cần COOP/COEP | cần COOP/COEP | không ảnh hưởng |
| Fullscreen API | UX-01 | có | có | có (không ẩn UI điều hướng) | nút Toàn màn hình ẩn |
| `showDirectoryPicker` | dataset mode (CLS-01) | có | không | không | tải zip |

| Trình duyệt | Kết quả | Ngày |
|---|---|---|
| Firefox (bản mới nhất, Windows) | chưa đo | |
| Safari (bản mới nhất, macOS) | chưa đo | |

## 6. Tham số chốt (D-045)

Bảng "Tham số chốt so với số đo" trong mục 5 đối chiếu từng dòng của ma trận với các quy tắc dưới; giá trị chốt nằm trong `src/core/config.ts` và bài kiểm `tests/unit/config.test.ts` giữ các quan hệ với nhịp mục tiêu.

| Tham số | Chốt | Quy tắc | Số đo dùng để chốt |
|---|---|---|---|
| Delegate worker tay `hands.delegate` | `auto`: GPU khi WebGL chạy trên phần cứng, CPU khi renderer là phần mềm (SwiftShader, llvmpipe, Microsoft Basic Render) hay thiếu WebGL (`src/hands/handDelegate.ts`); `hands=GPU\|CPU` ghi đè; worker vẫn tự đổi delegate khi tạo landmarker lỗi | chọn delegate đạt ≥ 20 Hz trên máy mục tiêu, không làm CI chậm | GPU 28,5 đến 29,5 Hz so với CPU 10,5 đến 11 Hz trên RTX 3050; GPU 2 Hz so với CPU 9,5 Hz trên SwiftShader. Thay D-009 (CPU mặc định, đo với hai tay trong pane bị ẩn) |
| Tuổi điểm tay `freshness.pointMaxAgeMs` | 150 ms với GPU delegate; `pointMaxAgeMsCpu` 250 ms với CPU delegate (đặt vào độ nhạy mặc định lúc mở app, nút "Đặt lại độ nhạy" theo cùng delegate) | tuổi lớn nhất của điểm mới nhất ngay trước khi kết quả kế về = khoảng cách p95 giữa hai kết quả + inferMs p95 ổn định | GPU: 54 đến 58 + 25 đến 40 ≈ 80 đến 100 ms; CPU: 98 đến 104 + 90 đến 110 ≈ 190 đến 210 ms; headless CPU: 120 + 135 ≈ 255 ms (e2e vẫn đặt 1000 ms) |
| Tuổi kết quả mặt `freshness.faceResultMaxAgeMs` | 250 ms (giữ) | p95 tuổi lúc gate nhận ≤ 80 % tuổi tối đa và không kết quả nào bị loại vì quá tuổi | GPU thật: p95 67 đến 68 ms, max 77; headless: p95 145 ms, max 149; quá tuổi 0 ở mọi lần đo |
| Tuổi kết quả phân loại `classifier.resultMaxAgeMs` | 600 ms (giữ) | như trên | p95 37 ms (wasm) đến 59 ms (webgpu), quá tuổi 0; dư nhiều nhưng vô hại vì kết quả của ROI cũ đã bị loại theo epoch và taskId khi vùng đổi |
| Tuổi nhãn `classifier.labelMaxAgeMs` | 1500 ms (giữ) | ≥ 2 × khoảng cách p95 giữa hai kết quả phân loại | khoảng cách p95 271 đến 272 ms (GPU thật), 351 ms (headless) |
| Hysteresis `reveal.hysteresisCells` | 0,25 ô (giữ) | ≥ 3σ rung đầu ngón khi tay giữ yên | σ 0,002 đến 0,006 ô trên ảnh tĩnh (nhiễu model); run tay người thật chưa đo |
| EP phân loại `classifier.executionProviders` | `['webgpu', 'wasm']` (giữ D-013) | EP nhanh hơn với model thật | stub: wasm 4,7 ms < webgpu 19,6 ms (chi phí điều phối); S6 MobileNetV2: webgpu 19 ms < wasm 59 ms; cả hai xa dưới nhịp 250 ms |
| Delegate worker mặt `face.delegate` | GPU (giữ D-008) | | GPU thật p50 30 ms; headless (SwiftShader) 110 ms với mặt vẫn cho 8,5 Hz |

## 7. Kết luận

Trên máy mục tiêu (Chrome hoặc Edge desktop với GPU rời) mọi mục tiêu tần suất của mục 3 đều đạt sau khi chuyển worker tay sang GPU delegate: output theo tần số màn hình, tay 29 Hz, mặt 11,5 Hz (giới hạn bởi targetHz 12), phân loại 4 Hz, vẽ dưới 1 ms mỗi frame nên giữ Canvas 2D. Hand Landmarker trên CPU (máy không GPU, headless) là nút cổ chai duy nhất (10 đến 11 Hz) và được bù bằng tuổi điểm 250 ms. Còn chờ: số đo trên Firefox và Safari, Hz phân loại và EP với model thật, run tay người thật với webcam.
