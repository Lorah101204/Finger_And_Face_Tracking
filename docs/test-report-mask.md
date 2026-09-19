# Báo cáo kiểm thử mask, tác vụ trễ và thời điểm đóng (QA-01)

Tài liệu này ghi cách đo và kết quả của bộ kiểm thử mục 7 trong [WORK-BREAKDOWN.md](WORK-BREAKDOWN.md), tập trung vào ba câu hỏi của gói QA-01: (1) buffer đưa vào worker mặt có bao giờ chứa pixel camera ngoài vùng mở không (gate cứng, mục 7.2); (2) kết quả tác vụ về muộn hoặc thuộc cấu hình cũ được xử lý ra sao; (3) vùng mở đóng đúng lúc nào. Mọi ca đều là test tự động có khẳng định bằng số; không có ca nào kết luận bằng quan sát mắt thường. Phần "Kết quả lần chạy" (mục 7) do `npm run test:report` sinh từ JSON của Vitest và Playwright, kèm số đo mà từng ca ghi lại.

## 1. Cách đọc

- "Ca" là một test (Vitest hoặc Playwright); tên ca là tiêu đề trong mã. Cột "Mục 7" là bảng trong WORK-BREAKDOWN mà file test phủ.
- "Số đo" là những gì test ghi bằng `note()` (annotation `đo`) và `expectGateClean()` (annotation `gate cứng`) trong `tests/e2e/helpers.ts`. Test vẫn tự khẳng định các giá trị này bằng `expect`; phần ghi chỉ để đối chiếu và để báo cáo tái tạo được.
- Ca "bỏ qua" là ca cần asset cục bộ không commit (`public/spike-assets/face.png`, `hands.jpg`): chạy trên máy phát triển, tự bỏ qua trong CI. Lần chạy ở mục 7 có cả hai asset.
- Thời gian từng ca phụ thuộc máy và mức song song; CI chạy 2 worker nên chậm hơn.
- Bench QA-02 (`tests/bench`, `npm run test:bench`) chạy với cấu hình Playwright riêng và không nằm trong báo cáo này; số đo của nó (nhiều trình duyệt, tham số chốt) ở [benchmark.md](benchmark.md) mục 5 và 6.

## 2. Gate cứng (mục 7.2)

Điều kiện chặn merge: ở mọi ca, buffer gửi cho worker mặt (và sau này worker phân loại) không chứa pixel camera ngoài `cameraRect` của mask lúc gửi; với mask tứ giác (ROI-02, D-038) các ô trong hộp bao mà không mở phải là xám đệm. Đo tại probe `onRestrictedFrame` (bản sao `ImageData` của ảnh letterbox ngay trước `transferToImageBitmap`, mục 5.9), không đo trên màn hình. Hai cách đo độc lập:

1. **Màu đánh dấu** (`tests/e2e/restricted.spec.ts`): cảnh tổng hợp có nền magenta (255, 0, 255) ngoài cửa sổ và vùng xanh dương (0, 0, 255) phủ đúng `cameraRect`. Mọi pixel hợp lệ trong buffer có r = g (xanh, xám đệm và mức pha giữa hai màu đó); pixel có r ≠ g là dấu vết magenta. Số pixel r ≠ g phải bằng 0 ở cửa sổ nhỏ nhất tại góc trên trái và góc dưới phải, cửa sổ vừa, cửa sổ lớn (scale < 1), khi tắt mirror, và ở tứ giác lệch có lỗ (tay giả lập). Đối chứng ở từng vị trí: thu vùng xanh vào 1 px mỗi phía thì viền magenta 1 px nằm trong `cameraRect` phải xuất hiện trong buffer (bad > 0), chứng tỏ phép đo thấy được sai lệch 1 px.
2. **Ảnh tham chiếu** (`installGateAudit` trong `tests/e2e/helpers.ts`, cài ở mọi ca dùng nguồn tổng hợp): với mỗi buffer qua probe, test dựng lại trong trang một ảnh tham chiếu từ định nghĩa cảnh (`window.__scenario.scene()`: nền, vùng người, ảnh tĩnh) chỉ trong `roiCam` của buffer, crop 1:1, tô xám các lỗ của mask hiện tại rồi letterbox cùng công thức với `src/core/letterbox.ts`, và so từng pixel với buffer. Lệch quá 2 mức ở bất kỳ pixel nào là lỗi (pixel ngoài ROI, crop lệch hay lỗ không tô). Cách này phủ cả cảnh có ảnh mặt thật và cửa sổ theo tay giả lập; buffer khi cảnh đang chuyển động hoặc ảnh chưa nạp được bỏ qua và đếm riêng.

Kết quả của cách 2 nằm ở dòng "Gate cứng đo bằng ảnh tham chiếu" trong mục 7; số pixel ngoài ROI của cách 1 nằm ở cột "Số đo" của `restricted.spec.ts`.

Ngoài hai cách đo, các bất biến sau được kiểm bằng script và lint ở mọi lần chạy: `drawImage(` chỉ ở compositor, `restrictedFrame.ts` và nguồn tổng hợp, luôn có rect nguồn (I2, I4); `restrictedFrame.ts` không đụng DOM và crop từ `source.drawable` (I1, I3); `src/face/` và `src/classify/` chỉ import `src/core/` (I1); `createImageBitmap(` chỉ ở `handClient.ts` (`npm run check:invariants`, `npm run lint:boundaries`).

## 3. Tác vụ trễ (mục 7.12 và bảng 7.1)

| Tình huống | Ca | Cách đo |
|---|---|---|
| Kết quả về muộn hơn 250 ms khi vùng vẫn mở | `faceGate.spec.ts` "delayWorker(500) rồi đóng…" (cục bộ) | `delayWorker(500)`: `faceGate.rejected.stale` tăng, mặt cũ hết hạn, trạng thái `searching` |
| Đóng khi tác vụ đang chạy | cùng ca trên | `delayWorker(500)` rồi `coverAll`: mặt rỗng ngay và sau 900 ms, canvas trắng, 0 pixel overlay; mở lại thì mặt về với epoch mới |
| Đổi lưới hoặc mirror khi tác vụ đang chạy | `face.spec.ts` "đổi lưới hoặc mirror khi tác vụ đang chạy…" | trễ 3 s, poll theo rAF trong trang bắt đúng lúc một tác vụ vừa gửi rồi đổi cấu hình: tới lúc `FaceClient.stats.discarded` tăng 1, `faceGate.accepted` và số kết quả bị loại vì epoch hay `rejected-task` đứng yên (đọc trong cùng một lượt); sau đó chỉ tác vụ epoch mới được nhận (`faceGate.lastAccepted.epoch` bằng epoch hiện tại) |
| Dời cửa sổ khi tác vụ đang chạy | `faceGate.spec.ts` "kéo cửa sổ khi tác vụ đang chạy…" (cục bộ) | `faceMaxAge(4000)` nới tuổi tối đa (kịch bản debug), trễ 1 s để tác vụ còn chạy lúc dời 3 ô: kết quả đầu tiên gate nhận sau khi dời là của ROI cũ (`lastAccepted.roiCam`, tuổi > 250 ms) và mặt vẫn ở đúng chỗ (tâm lệch ≤ 12 px so với trước khi dời), landmark chỉ trong stageRect mới; kết quả kế của ROI mới cũng đặt mặt đúng chỗ đó. Snapshot sau khi dời đọc ngay trong trang theo rAF vì mặt của một kết quả chỉ được giữ 1 s (4 × tuổi tối đa) và vòng poll từ Node có thể đọc trễ khi cả bộ chạy song song (sửa ở UX-02 sau một lần fail dưới tải). Tương tự, ca "worker mặt sẵn sàng…" của `face.spec.ts` chờ `faceGate.accepted > 0` thay vì chỉ chờ client có kết quả, vì vài kết quả đầu có thể bị loại quá tuổi khi worker chậm lúc khởi động dưới tải (sửa ở CLS-01). Ca "nhãn gắn vào mặt" của `classify.spec.ts` (CLS-02) cũng đọc mặt và nhãn trong cùng một snapshot theo rAF trong trang |
| Kết quả epoch cũ, taskId đã loại, quá tuổi, không còn mask | `faceValidate.test.ts` | unit: từng lý do loại, đúng 250 ms vẫn nhận |
| `rejectAll` giữ busy tới khi kết quả về rồi bỏ | `faceClient.test.ts` | unit với worker giả |

## 4. Thời điểm đóng (mục 7.7, 7.14, 7.16, 7.17)

| Sự kiện | Ca | Khẳng định |
|---|---|---|
| Thiếu một tay (chỉ còn điểm của một tay) | `integration.spec.ts` "tay giả lập mở cửa sổ…"; `hands.spec.ts` một tay rời khung (cục bộ) | đóng `few-points` cùng frame; mặt rỗng; `accepting` tắt; không gửi thêm buffer trong 700 ms; thông điệp nêu slot thiếu |
| Hai tay chéo nhau (frame uncertain) | `solver.spec.ts` "hai tay chéo nhau…" | đóng `ambiguous-hands`, bốn slot không hợp lệ, epoch giữ nguyên; hết chéo thì mở lại cùng ô với epoch mới |
| Bốn đầu ngón quá gần | `solver.spec.ts` "too-small…" | đóng `too-small` dù bốn slot hợp lệ; N min và tuổi điểm áp dụng ngay, không đổi epoch |
| Điểm quá tuổi | cùng ca trên | điểm cũ 300 ms → `stale-point`; nâng tuổi lên 500 → mở; đặt lại → đóng |
| Tab ẩn | `integration.spec.ts` "đổi nguồn cửa sổ…" | đóng `tab-hidden` ngay trong sự kiện (trước rAF), epoch + 1, `accepting` tắt, canvas trắng; hiện lại thì mở lại (chuột và tay) |
| Camera dừng, watchdog không có frame | `integration.spec.ts` "camera thật… dừng" | `no-camera`, canvas trắng, `accepting` tắt; chạy lại thì mở lại |
| Đổi cấu hình (lưới, mirror, nguồn cửa sổ) | `roi.spec.ts`, `mask.spec.ts`, `integration.spec.ts` | `config-changed` rồi mở lại với epoch mới; pixel trong cửa sổ khớp layout mới, ngoài cửa sổ trắng |
| Người dùng (Esc, rời nguồn tay) | `roi.spec.ts`, `solver.spec.ts` | `user`, canvas trắng, không còn slot |
| Máy trạng thái vùng mở, gate camera và tab | `revealState.test.ts`, `closeGate.test.ts` | unit: quy tắc epoch theo lý do đóng; `cameraGate`, `visibilityGate` |

## 5. Ca chưa tự động

- Chạy toàn bộ mục 7 bằng tay thật với webcam trên máy phát triển (INT-01 bước 4) và kiểm nhãn tay phải 10 giây (D-010): cần webcam, không nằm trong bộ tự động; ghi nhận ở WORK-BREAKDOWN mục 7.16. Các ca tay thật trong bộ tự động dùng ảnh tĩnh `hands.jpg` với worker thật.
- Clip y4m cho camera giả (TEST-00): cần ffmpeg; không có thì Chromium dùng nguồn giả mặc định (các ca camera vẫn chạy và pass).
- Metric người và hình nộm (mục 7.3, CLS-02): cần model huấn luyện trên dataset thật; `tools/train/eval.py --doc docs/classifier-report.md`. Bộ tự động hiện kiểm đường ống với model stub (`classify.spec.ts`, mục 7.23). Soak 15 phút: `npm run test:soak`, kết quả ở `docs/benchmark.md` (PERF-01).
- Lighthouse cho màn hình bắt đầu (UX-02, mục 7.21): chạy tay bằng `npx lighthouse http://localhost:5173/#/ --only-categories=accessibility,best-practices` trên dev server; lần 2026-09-18 với Lighthouse 13.4.1, Chrome 153: accessibility 100, best-practices 96 (trừ dòng INFO của MediaPipe qua console.error). Không thêm phụ thuộc, không trong CI.
- Thu dataset thật (CLS-01, mục 7.22): cần người tham gia đã ký văn bản đồng ý và hình nộm; bộ tự động kiểm dataset mode với nguồn tổng hợp (mẫu là crop đúng `cameraRect`, không frame gốc) và công cụ Python với dataset tạm.
- Người mới với webcam thật (UX-01, mục 7.20): một người chưa được giải thích mở được cửa sổ chỉ theo hướng dẫn trên màn hình; bộ tự động kiểm từng thông điệp với camera giả và tay giả lập, không thay được lần thử này.

## 6. Tái tạo

```bash
npm run test:report
```

Lệnh trên chạy unit với reporter JSON (`reports/unit.json`), e2e (`reports/e2e.json`, cấu hình trong `playwright.config.ts`) rồi ghi lại mục 7 bằng `tools/test-report.mjs`. Chỉ sinh lại từ JSON đã có: `npm run test:report:write`. CI (`.github/workflows/ci.yml`) chạy cùng chuỗi kiểm tra trên Linux, sinh lại mục 7 và lưu `reports/`, `test-results/` cùng tài liệu này làm artefact; các ca cục bộ bỏ qua ở đó.

## 7. Kết quả lần chạy

<!-- report:begin -->
Sinh bởi `npm run test:report` (`tools/test-report.mjs`) từ lần chạy lúc 2026-09-19T18:09:43.059Z trên máy phát triển. Không sửa tay phần này.

### Môi trường

| Mục | Giá trị |
|---|---|
| Hệ điều hành | Windows_NT 10.0.26200 (x64) |
| CPU, RAM | 12th Gen Intel(R) Core(TM) i5-12500H, 16 luồng, 16 GB |
| Node.js | v24.11.0 |
| Vite / Vitest / Playwright | 8.3.0 / 5.0.1 / 1.63.0 |
| Trình duyệt e2e | Chrome Headless Shell 153.0.8010.12 (Playwright build 1243), camera giả của Chromium (`--use-fake-device-for-media-stream`), 6 worker song song |
| Model | hand_landmarker float16/1 (sha256 fbc2a30080c3…); face_landmarker float16/1 (sha256 64184e229b26…); @mediapipe/tasks-vision 1.0.1 |
| Asset cục bộ | face.png: có; hands.jpg: có; camera.y4m: không |

### Unit (Vitest)

47 file, 267 test: 267 pass, 0 fail, 0 bỏ qua; tổng thời gian test 2,4 s.

| File | Mục 7 | Test | Pass | Fail | Bỏ qua | ms |
|---|---|---|---|---|---|---|
| basePath.test.ts | 7.27 | 10 | 10 | 0 | 0 | 39 |
| buildMask.test.ts | 7.7, 7.17 | 5 | 5 | 0 | 0 | 25 |
| cameraState.test.ts | 7.5 | 10 | 10 | 0 | 0 | 12 |
| cells.test.ts | 7.17, 7.26 | 8 | 8 | 0 | 0 | 21 |
| classifierClient.test.ts | 7.23 | 5 | 5 | 0 | 0 | 19 |
| closeGate.test.ts | 7.16 | 2 | 2 | 0 | 0 | 6 |
| compositor.test.ts | 7.8, 7.12, 7.13, 7.14, 7.17 | 13 | 13 | 0 | 0 | 35 |
| config.test.ts | 7.6, 7.24 | 4 | 4 | 0 | 0 | 8 |
| coords.test.ts | 7.6 | 15 | 15 | 0 | 0 | 27 |
| envText.test.ts | 7.24 | 4 | 4 | 0 | 0 | 11 |
| epoch.test.ts | 7.7 | 2 | 2 | 0 | 0 | 3 |
| faceBoundary.test.ts | 7.11 | 3 | 3 | 0 | 0 | 13 |
| faceClient.test.ts | 7.11, 7.12 | 10 | 10 | 0 | 0 | 27 |
| faceMapping.test.ts | 7.12 | 2 | 2 | 0 | 0 | 8 |
| faceValidate.test.ts | 7.12, 7.17, 7.23 | 7 | 7 | 0 | 0 | 20 |
| fakeHands.test.ts | 7.15 | 3 | 3 | 0 | 0 | 17 |
| fingertips.test.ts | 7.14, 7.26 | 7 | 7 | 0 | 0 | 18 |
| grid.test.ts | 7.6 | 6 | 6 | 0 | 0 | 12 |
| guidance.test.ts | 7.20 | 10 | 10 | 0 | 0 | 15 |
| handBoundary.test.ts | 7.13 | 3 | 3 | 0 | 0 | 49 |
| handClient.test.ts | 7.13 | 5 | 5 | 0 | 0 | 38 |
| handDelegate.test.ts |  | 3 | 3 | 0 | 0 | 7 |
| handLandmarker.test.ts | 7.13 | 5 | 5 | 0 | 0 | 15 |
| handPipeline.test.ts | 7.13 | 3 | 3 | 0 | 0 | 56 |
| handTracker.test.ts | 7.13 | 9 | 9 | 0 | 0 | 26 |
| handWindowSource.test.ts | 7.15, 7.17, 7.26 | 9 | 9 | 0 | 0 | 30 |
| hullSolver.test.ts | 7.17, 7.26 | 8 | 8 | 0 | 0 | 18 |
| landingScene.test.ts | 7.28 | 3 | 3 | 0 | 0 | 102 |
| latency.test.ts | 7.19 | 3 | 3 | 0 | 0 | 11 |
| letterbox.test.ts | 7.10 | 6 | 6 | 0 | 0 | 11 |
| localLog.test.ts | 7.25 | 11 | 11 | 0 | 0 | 28 |
| networkGuard.test.ts | 7.27 | 5 | 5 | 0 | 0 | 77 |
| oneEuro.test.ts | 7.15 | 5 | 5 | 0 | 0 | 11 |
| recorder.test.ts | 7.22 | 6 | 6 | 0 | 0 | 118 |
| rect.test.ts | 7.12 | 5 | 5 | 0 | 0 | 8 |
| registerSw.test.ts | 7.27 | 5 | 5 | 0 | 0 | 11 |
| restrictedFrame.test.ts | 7.10, 7.17, 7.22 | 9 | 9 | 0 | 0 | 36 |
| revealState.test.ts | 7.7 | 6 | 6 | 0 | 0 | 13 |
| sensitivity.test.ts | 7.15 | 2 | 2 | 0 | 0 | 9 |
| session.test.ts | 7.21 | 2 | 2 | 0 | 0 | 4 |
| stats.test.ts | 7.19 | 4 | 4 | 0 | 0 | 14 |
| store.test.ts | 7.6, 7.14, 7.16 | 4 | 4 | 0 | 0 | 14 |
| stubModel.test.ts | 7.23 | 1 | 1 | 0 | 0 | 1222 |
| subjectRule.test.ts | 7.23 | 7 | 7 | 0 | 0 | 12 |
| sw.test.ts | 7.27 | 6 | 6 | 0 | 0 | 95 |
| uiState.test.ts | 7.20, 7.28 | 3 | 3 | 0 | 0 | 9 |
| zip.test.ts | 7.22 | 3 | 3 | 0 | 0 | 12 |

### E2E (Playwright)

19 spec, 65 ca: 65 pass, 0 pass sau thử lại, 0 fail, 0 bỏ qua (thiếu asset cục bộ); tổng thời gian các ca 1314,5 s (chạy song song).

Gate cứng đo bằng ảnh tham chiếu (`installGateAudit`, cách đo thứ hai của mục 7.2): 2161 buffer trong 32 ca, 2161 khớp, 0 lệch, sai khác lớn nhất 0/255.

#### camera.spec.ts (mục 7.5)

| Ca | Kết quả | Thời gian | Số đo |
|---|---|---|---|
| bật camera giả: getUserMedia một lần sau khi bấm, video ẩn, canvas vẫn trắng, frameId liên tục | pass | 13,2 s |  |
| từ chối quyền: báo lỗi, canvas trắng, bấm lại thì thử lại | pass | 7,9 s |  |
| track kết thúc (rút camera): về ended, canvas trắng, bật lại được | pass | 8,1 s |  |
| watchdog báo khi video ngừng cấp frame; đổi camera tăng epoch và frameId không trùng | pass | 12,5 s |  |

#### classify.spec.ts (mục 7.23, 7.2)

| Ca | Kết quả | Thời gian | Số đo |
|---|---|---|---|
| worker phân loại: sẵn sàng (webgpu hoặc wasm), đóng thì không gửi; mở trên nửa xanh lá → person, dời sang magenta → mannequin, nhịp ≤ 5 Hz; cửa sổ nhỏ hơn 96 px không gửi; đóng xóa nhãn | pass | 98,9 s | EP wasm, init 66335 ms, warm-up 77 ms, infer p50 1.8 / p95 4.9 ms, nhịp 250 ms; 8 kết quả trong 2 s; gửi 46, loại 0, gate nhận 45, loại {"epoch":0,"rejected-task":0,"stale":1,"no-mask":0}<br>469 buffer so tham chiếu: 469 khớp, 0 lệch, maxDiff 0 (bỏ qua 30 cảnh động, 0 chờ ảnh) |
| nhãn gắn vào mặt đã validate (face.png cục bộ): cùng epoch, subjectType theo quy tắc, xóa khi đóng | pass | 90,6 s | mặt full (nhìn thấy 100 %), subjectType unknown, độ tin cậy 0.533, probs 0.467/0.533<br>411 buffer so tham chiếu: 411 khớp, 0 lệch, maxDiff 0 (bỏ qua 0 cảnh động, 0 chờ ảnh) |

#### dataset.spec.ts (mục 7.22, 7.2)

| Ca | Kết quả | Thời gian | Số đo |
|---|---|---|---|
| dataset mode: cần đồng ý người tham gia; chỉ báo khi thu; mẫu là crop đúng cameraRect với pixel khớp cảnh; 2 Hz; đóng vùng hay dừng thì không thu; zip đúng cấu trúc; không gọi mạng | pass | 90,5 s | 26 mẫu 160×160 px (cameraRect (560, 200)), khoảng cách ts nhỏ nhất 503 ms, zip 55833 byte với 53 mục, ranh giới xanh lá/magenta tại x = 80<br>271 buffer so tham chiếu: 271 khớp, 0 lệch, maxDiff 0 (bỏ qua 0 cảnh động, 0 chờ ảnh) |
| cửa sổ chạm mép camera ghi position edge (mirror: cột 0 của bảng là mép phải camera); nhịp thu chỉnh được | pass | 48,5 s | cửa sổ (0, 0) trên lưới 64 × 36, mirror true: cameraRect (1120, 0) 160×160, edges top, right; 6 mẫu ở 10 Hz, khoảng cách ts nhỏ nhất 198 ms<br>34 buffer so tham chiếu: 34 khớp, 0 lệch, maxDiff 0 (bỏ qua 0 cảnh động, 0 chờ ảnh) |

#### face.spec.ts (mục 7.11, 7.12, 7.1, 7.2)

| Ca | Kết quả | Thời gian | Số đo |
|---|---|---|---|
| worker mặt sẵn sàng; đóng 5 s không gửi tác vụ; mở vào vùng nền thì gửi và kết quả 0 mặt; đóng thì ngừng nhận | pass | 85,4 s | worker GPU, init 31253 ms; đóng 5 s: 0 tác vụ; mở vào nền: 102 tác vụ, 101 kết quả 0 mặt, p50 infer 42.4 ms; đóng: không gửi thêm<br>67 buffer so tham chiếu: 67 khớp, 0 lệch, maxDiff 0 (bỏ qua 0 cảnh động, 0 chờ ảnh) |
| đổi lưới hoặc mirror khi tác vụ đang chạy: kết quả epoch cũ bị bỏ trước gate, gate không nhận thêm; tác vụ epoch mới mới được nhận | pass | 82,5 s | grid: epoch 3 → 5; tác vụ cũ bị bỏ trước gate (discarded 0 → 1), gate không nhận thêm tới lúc đó (21); sau đó nhận 33, chỉ epoch mới; loại vì epoch: 0<br>mirror: epoch 5 → 7; tác vụ cũ bị bỏ trước gate (discarded 1 → 2), gate không nhận thêm tới lúc đó (37); sau đó nhận 52, chỉ epoch mới; loại vì epoch: 0<br>181 buffer so tham chiếu: 181 khớp, 0 lệch, maxDiff 0 (bỏ qua 0 cảnh động, 0 chờ ảnh) |

#### faceGate.spec.ts (mục 7.12, 7.1, 7.2)

| Ca | Kết quả | Thời gian | Số đo |
|---|---|---|---|
| mặt trọn trong cửa sổ: full, landmark và overlay chỉ trong stageRect, bbox camera nằm trong ảnh | pass | 51,8 s | full: 478 landmark trong stageRect, bbox 89×103 px; overlay trong 2209 px, ngoài 0 px; gate nhận 2, loại cũ 1<br>88 buffer so tham chiếu: 88 khớp, 0 lệch, maxDiff 0 (bỏ qua 0 cảnh động, 0 chờ ảnh) |
| cửa sổ cắt mặt: partial, không landmark ngoài vùng, overlay không ra ngoài, gợi ý mở rộng | pass | 43,0 s | partial (mặt hở 65 %): 404 landmark, tất cả trong stageRect; overlay trong 1486 px, ngoài 0 px<br>70 buffer so tham chiếu: 70 khớp, 0 lệch, maxDiff 0 (bỏ qua 0 cảnh động, 0 chờ ảnh) |
| delayWorker(500) rồi đóng: mặt biến mất ngay và không hiện lại; mở lại thì có mặt; kết quả quá tuổi bị loại | pass | 34,7 s | delayWorker(500) rồi đóng: mặt rỗng ngay và sau 900 ms, overlay 0 px; mở lại epoch 2 → 5; kết quả muộn > 250 ms bị loại: stale 2 → 5<br>29 buffer so tham chiếu: 29 khớp, 0 lệch, maxDiff 0 (bỏ qua 0 cảnh động, 0 chờ ảnh) |
| kéo cửa sổ khi tác vụ đang chạy: kết quả cũ ánh xạ theo ROI của tác vụ (mặt không dời theo cửa sổ), landmark chỉ trong stageRect mới | pass | 46,9 s | dời 3 ô khi tác vụ đang chạy: kết quả ROI cũ (tuổi 1218 ms, 478 landmark) đặt mặt lệch (0.0, 0.0) px so với trước khi dời; kết quả ROI mới lệch (0.1, 0.4) px; landmark đều trong stageRect mới<br>122 buffer so tham chiếu: 122 khớp, 0 lệch, maxDiff 0 (bỏ qua 0 cảnh động, 0 chờ ảnh) |

#### grid.spec.ts (mục 7.6)

| Ca | Kết quả | Thời gian | Số đo |
|---|---|---|---|
| lưới mặc định 64 × 36: canvas theo DPR, c và bảng đúng công thức, vạch lưới xám; tắt vạch thì toàn trắng | pass | 12,0 s |  |
| preset, custom có giới hạn và mirror: layout tính lại, epoch tăng | pass | 12,2 s |  |
| đổi kích thước cửa sổ: canvas và layout tính lại, epoch tăng | pass | 10,7 s |  |

#### hands.spec.ts (mục 7.13, 7.14, 7.15, 7.17, 7.26)

| Ca | Kết quả | Thời gian | Số đo |
|---|---|---|---|
| worker tay chỉ khởi tạo khi chọn nguồn "Tay"; nền không có tay thì HandFrame rỗng; rời nguồn tay thì dừng và xóa | pass | 38,1 s |  |
| nhãn theo S3 (D-010), overlay hai màu, cửa sổ đóng; id giữ khi đứng yên và khi ảnh di chuyển; đảo trái/phải thì nhãn đảo và id mới | pass | 54,3 s | 1 buffer so tham chiếu: 1 khớp, 0 lệch, maxDiff 0 (bỏ qua 1 cảnh động, 0 chờ ảnh) |
| mười đầu ngón (ROI-03): đủ điểm khi hai tay trong khung, đúng tay và đúng ngón; cửa sổ bao lồi theo tay thật; bỏ ngón út thì epoch tăng và còn 8 điểm; tay phải rời khung thì đóng few-points, điểm tay trái giữ | pass | 55,6 s | 20 buffer so tham chiếu: 20 khớp, 0 lệch, maxDiff 0 (bỏ qua 15 cảnh động, 0 chờ ảnh) |

#### integration.spec.ts (mục 7.16, 7.2)

| Ca | Kết quả | Thời gian | Số đo |
|---|---|---|---|
| đổi nguồn cửa sổ là đổi cấu hình (epoch++); tab ẩn đóng ngay với tab-hidden và epoch++, accepting tắt, canvas trắng; hiện lại thì mở lại (chuột và tay) | pass | 15,5 s | epoch: mở 3 → tay 4 → chuột 6 → tab ẩn 7 → hiện 8; tay giả lập: ẩn/hiện 11 → 13, cùng hộp (26, 14) 12×8<br>18 buffer so tham chiếu: 18 khớp, 0 lệch, maxDiff 0 (bỏ qua 0 cảnh động, 0 chờ ảnh) |
| camera thật (giả của Chromium) dừng hay ngừng cấp frame thì vùng đóng no-camera và canvas trắng; chạy lại thì mở lại | pass | 14,8 s |  |
| tay giả lập mở cửa sổ thì worker mặt nhận buffer; bỏ một tay thì vùng đóng cùng frame, mặt xóa, accepting tắt, không gửi thêm | pass | 19,2 s | bỏ tay phải: đóng few-points, buffer gửi 3 rồi đứng yên 700 ms, accepting tắt<br>73 buffer so tham chiếu: 73 khớp, 0 lệch, maxDiff 0 (bỏ qua 0 cảnh động, 0 chờ ảnh) |
| tay giả lập bao quanh mặt: face-candidate với overlay trong cửa sổ; bỏ một tay thì đóng và mặt biến mất ngay | pass | 29,7 s | 12 buffer so tham chiếu: 12 khớp, 0 lệch, maxDiff 0 (bỏ qua 0 cảnh động, 0 chờ ảnh) |

#### landing.spec.ts (mục 7.4, 7.21)

| Ca | Kết quả | Thời gian | Số đo |
|---|---|---|---|
| trang chào không gọi getUserMedia; sau đồng ý mới vào #/app với canvas trắng; không gọi mạng | pass | 7,4 s |  |
| chưa đồng ý mà mở #/app thì về trang chào | pass | 5,9 s |  |
| đồng ý phiên bản cũ không còn hiệu lực | pass | 7,4 s |  |
| thu hồi đồng ý thì về trang chào và không vào lại được #/app | pass | 12,0 s |  |

#### log.spec.ts (mục 7.25)

| Ca | Kết quả | Thời gian | Số đo |
|---|---|---|---|
| mặc định tắt; bật thì ghi consent; phiên camera giả, cửa sổ chuột, đổi lưới, dừng camera → đúng loại sự kiện, chỉ metadata, CSV tải về, bảng lọc, giữ qua tải lại, xóa; không gọi mạng | pass | 21,6 s | 6 sự kiện trong phiên: consent, camera-start, reveal-open, reveal-close, config-change, camera-stop; CSV 6 dòng, 709 ký tự; payload lớn nhất 110 byte; yêu cầu ngoài tài nguyên tĩnh: 0 |
| giới hạn: bản ghi quá 30 ngày bị xóa, quá 10 000 bản ghi xóa cũ trước; xóa về 0 | pass | 16,5 s | ghi thẳng 10 008 bản ghi (3 quá 30 ngày) → còn 10000 sau khi dọn; xóa → 0 |

#### mask.spec.ts (mục 7.8, 7.1)

| Ca | Kết quả | Thời gian | Số đo |
|---|---|---|---|
| camera chạy, mở cửa sổ: pixel camera chỉ trong stageRect và khớp ánh xạ cameraRect → stageRect; tắt mirror thì lật | pass | 13,5 s | mirror bật: maxDiff 0/255 trên 25 điểm, 25 điểm có video; mirror tắt: maxDiff 0; lưới 32 × 18: maxDiff 0, epoch 6 → 8; 4 điểm ngoài trắng |
| dời cửa sổ thì vị trí cũ trắng ngay; đóng thì toàn bộ trắng | pass | 11,5 s |  |

#### present.spec.ts (mục 7.28, 7.2)

| Ca | Kết quả | Thời gian | Số đo |
|---|---|---|---|
| thanh trên một dòng ở 1280 px kể cả khi câu trạng thái dài và nhật ký bật; bậc nút: chỉ Bật camera là primary, Xóa nhật ký là danger; pill trạng thái có chấm theo pha | pass | 6,0 s | thanh trên cao 48 px (có nhật ký: 48 px), 0 nút đen, primary = rgb(25, 103, 210) |
| cột cài đặt 320 px bên phải: thu gọn trả lại chiều rộng; chọn nguồn Tay không đổi cỡ canvas; ngăn kéo debug dưới canvas có giới hạn chiều cao; thanh trượt và chip | pass | 6,7 s | cột cài đặt 320 px; canvas 960×672 (chuột) = 960×672 (tay); mở hết 960×522, ô 14 px, ngăn kéo 150 px; thu gọn cột 1280×522 |
| chế độ trình diễn: panel thành lớp nổi không đổi cỡ canvas (epoch giữ nguyên), tự ẩn sau 2,5 s rồi hiện lại khi di chuột, giữ qua tải lại; ?mode=present mở sẵn với cột cài đặt đóng | pass | 13,8 s | trình diễn: canvas 1280×720 = .stage; mở cột cài đặt và debug giữ 1280×720, epoch 3; lớp nổi ẩn sau 2,5 s<br>35 buffer so tham chiếu: 35 khớp, 0 lệch, maxDiff 0 (bỏ qua 0 cảnh động, 0 chờ ảnh) |
| màn hình bắt đầu kiosk (?mode=present): minh họa canvas phủ cả màn, thẻ đồng ý nổi, không ảnh, không tài nguyên ngoài; đồng ý thì vào #/app?mode=present ở chế độ trình diễn | pass | 4,1 s | kiosk: nền canvas 1280×720, không cuộn; tương phản h1 16.1:1 · .lead 10.47:1 · label.consent span 10.47:1 · .steps li 6.05:1 |

#### restricted.spec.ts (mục 7.2, 7.10, 7.17)

| Ca | Kết quả | Thời gian | Số đo |
|---|---|---|---|
| gate cứng: buffer 256 × 256 không có pixel ngoài cameraRect ở nhiều vị trí và cỡ cửa sổ, kể cả sát mép và nhỏ nhất; đối chứng 1 px | pass | 9,5 s | (0, 0) n=4: cameraRect 80×80, pixel ngoài ROI 0/65536, xanh 65536, xám 0; đối chứng viền 1 px lọt 5020 pixel<br>(60, 32) n=4: cameraRect 80×80, pixel ngoài ROI 0/65536, xanh 65536, xám 0; đối chứng viền 1 px lọt 5020 pixel<br>(10, 5) n=12: cameraRect 240×240, pixel ngoài ROI 0/65536, xanh 65536, xám 0; đối chứng viền 1 px lọt 2032 pixel<br>(20, 2) n=20: cameraRect 400×400, pixel ngoài ROI 0/65536, xanh 65536, xám 0; đối chứng viền 1 px lọt 1020 pixel<br>mirror tắt (2, 2) n=8: pixel ngoài ROI 0; 50 buffer qua probe<br>50 buffer so tham chiếu: 50 khớp, 0 lệch, maxDiff 0 (bỏ qua 0 cảnh động, 0 chờ ảnh) |
| chỉ đổi nội dung ngoài cửa sổ: hash buffer không đổi; đổi nội dung trong cửa sổ: hash đổi | pass | 7,6 s | hash fe959dc5 giữ nguyên khi chỉ đổi nền (frame 37 → 47); đổi màu trong cửa sổ → 990f9dc5<br>18 buffer so tham chiếu: 18 khớp, 0 lệch, maxDiff 0 (bỏ qua 0 cảnh động, 0 chờ ảnh) |
| đổi n: crop đúng cỡ cameraRect, letterbox đúng công thức, góc crop ánh xạ ngược về đúng góc cameraRect | pass | 6,9 s | n=4: crop 80×80, letterbox scale 3.2000, dx 0, dy 0<br>n=9: crop 180×180, letterbox scale 1.4222, dx 0, dy 0<br>n=16: crop 320×320, letterbox scale 0.8000, dx 0, dy 0<br>24 buffer so tham chiếu: 24 khớp, 0 lệch, maxDiff 0 (bỏ qua 0 cảnh động, 0 chờ ảnh) |
| đóng thì không tạo tác vụ; cửa sổ quá nhỏ thì too-small, không tiêu taskId; mở rộng thì taskId từ 1 | pass | 6,6 s | đóng 15 frame: tác vụ 4 → 4, too-small 6 → 6<br>4 buffer so tham chiếu: 4 khớp, 0 lệch, maxDiff 0 (bỏ qua 0 cảnh động, 0 chờ ảnh) |
| gate cứng với tứ giác lệch (tay giả lập): lỗ trong hộp bao là xám, không có pixel ngoài ô mở; đối chứng 1 px | pass | 7,5 s | hộp 15×10 ô, 98 ô mở, 52 lỗ: pixel ngoài ô mở 0, xanh 28338 (tỉ lệ mở 0.653 → 28545), xám 36788; đối chứng 479<br>8 buffer so tham chiếu: 8 khớp, 0 lệch, maxDiff 0 (bỏ qua 0 cảnh động, 0 chờ ảnh) |

#### roi.spec.ts (mục 7.7)

| Ca | Kết quả | Thời gian | Số đo |
|---|---|---|---|
| Space mở cửa sổ n = 8 giữa bảng với viền xanh trong stageRect; Esc đóng; epoch tăng khi mở và khi đóng | pass | 3,9 s |  |
| bấm mở tại con trỏ, kéo dời, kéo ra mép thì kẹp với viền đỏ, lăn chuột đổi n | pass | 5,1 s |  |
| đổi lưới khi đang mở: đóng với config-changed rồi mở lại giữ chỗ trên màn hình với epoch mới | pass | 4,1 s |  |
| nguồn cửa sổ mặc định là chuột; chọn tay được (HAND-01) và đóng cửa sổ đang mở | pass | 4,0 s |  |

#### solver.spec.ts (mục 7.15, 7.17, 7.26, 7.1, 7.2)

| Ca | Kết quả | Thời gian | Số đo |
|---|---|---|---|
| tay giả lập mở đúng tập ô; đứng yên và rung ±3 px không đổi ô; dời và phóng theo tay không đổi epoch; rời nguồn tay thì đóng | pass | 8,4 s | chữ nhật 12,3 × 8,2 ô → hộp (26, 14) 12×8, 96 ô, 0 lỗ; đứng yên và rung ±3 px: cùng hộp, epoch 5 giữ nguyên; dời 4 ô → hộp (29, 14) 13×8; phóng → (28, 13) 16×10; cùng epoch<br>21 buffer so tham chiếu: 21 khớp, 0 lệch, maxDiff 0 (bỏ qua 0 cảnh động, 0 chờ ảnh) |
| đa giác lệch: ô bị cạnh cắt qua mở, ô ngoài đa giác trong hộp bao là lỗ (không vẽ video, không gửi worker); đa giác nét đứt | pass | 5,5 s | hình thang lệch → hộp (26, 14) 12×9: 79 ô mở, 29 lỗ; (37,14) (37,17) (32,15) tắt, (37,22) (26,14) (26,21) (32,16) mở; lỗ trên canvas trắng, ô mở có video<br>7 buffer so tham chiếu: 7 khớp, 0 lệch, maxDiff 0 (bỏ qua 0 cảnh động, 0 chờ ảnh) |
| too-small khi các đầu ngón quá gần; tuổi điểm và độ nhạy (UC-09) áp dụng ngay | pass | 6,9 s | cạnh 2,5 ô → too-small; điểm cũ 300 ms → stale-point, tuổi 500 → mở, đặt lại → đóng; N min 9 → too-small, 3 → mở; epoch 6 → 7 (chỉ khi mở lại); hysteresis 0 → hộp (25, 13) 14×10<br>9 buffer so tham chiếu: 9 khớp, 0 lệch, maxDiff 0 (bỏ qua 0 cảnh động, 0 chờ ảnh) |
| hai tay chéo nhau (frame uncertain): đóng ambiguous-hands với mọi đầu ngón không hợp lệ, canvas trắng, epoch giữ; hết chéo thì mở lại cùng ô | pass | 6,7 s | uncertain → đóng ambiguous-hands, epoch 5 giữ; hết chéo → mở lại hộp (26, 14), epoch 6<br>4 buffer so tham chiếu: 4 khớp, 0 lệch, maxDiff 0 (bỏ qua 0 cảnh động, 0 chờ ảnh) |
| năm đầu ngón mỗi tay (mặc định): vùng mở là bao lồi của mười điểm, tập ô khớp tính lại trong Node; chọn lại hai ngón thì về hình chữ nhật với epoch mới | pass | 6,6 s | mười đầu ngón → bao lồi 7 đỉnh, hộp (22, 13) 16×9, 130 ô khớp tính lại trong Node, 14 lỗ; hai ngón → hộp (26, 14) 12×8, 96 ô, epoch 4 → 10<br>9 buffer so tham chiếu: 9 khớp, 0 lệch, maxDiff 0 (bỏ qua 0 cảnh động, 0 chờ ảnh) |

#### start.spec.ts (mục 7.21, 7.28)

| Ca | Kết quả | Thời gian | Số đo |
|---|---|---|---|
| một màn ở 1280 × 720 và 1920 × 1080 (không cuộn), không tài nguyên ngoài, minh họa canvas vẽ tại chỗ trang trí, không ảnh | pass | 5,1 s | 1280 × 720: scrollHeight 720 ≤ clientHeight 720, không cuộn<br>1920 × 1080: scrollHeight 1080 ≤ clientHeight 1080, không cuộn<br>minh họa canvas 517 × 291 CSS px, 517 × 291 px |
| điện thoại 390 × 844: một cột, không cuộn ngang, nút Bắt đầu vẫn tới được | pass | 3,6 s | 390 × 844: scrollWidth 390 ≤ clientWidth 390, 1 cột, scrollHeight 930 |
| bàn phím: Tab tới hộp đồng ý (nút chưa bật bị bỏ qua), Space tích, Tab tới Bắt đầu, Enter vào #/app; nhãn hộp đồng ý đọc được | pass | 2,1 s | thứ tự Tab: body → hộp đồng ý → Bắt đầu (sau khi tích) → Enter vào #/app |
| khối "đã đồng ý trước đó" có đường dẫn vào thẳng và đi trước nút trong thứ tự Tab sau nút Bắt đầu | pass | 2,2 s |  |
| tương phản AA: chữ, cam kết, nhãn đồng ý, chữ mờ, nút Bắt đầu, liên kết đều ≥ 4,5:1 (tiêu đề lớn ≥ 3:1) | pass | 2,2 s | tiêu đề 16.1:1 (40.96px) · giới thiệu 10.47:1 (17px) · cam kết 16.1:1 (15px) · nhãn đồng ý 16.1:1 (15px) · chữ mờ 6.05:1 (14px) · liên kết 5.37:1 (14px) · nút Bắt đầu 5.37:1 (16px) · ba bước 6.05:1 (13px) · chú thích minh họa 6.05:1 (13px) |

#### stats.spec.ts (mục 7.19, 7.2)

| Ca | Kết quả | Thời gian | Số đo |
|---|---|---|---|
| overlay hiệu năng: fps output > 0, mặt ≤ 12 Hz với tác vụ chờ ≤ 1, p95 ≥ p50, dòng stats-stat đúng dạng; đóng vùng thì mặt 0 Hz | pass | 20,1 s | mở vùng: output 55.6 fps, mặt 9.8 Hz (p50 40.2 / p95 48.6 ms, nhịp 83 ms, rớt 0, chờ 1), vẽ p50 0.20 / p95 0.40 ms, tick p95 6.80 ms<br>đóng vùng: mặt 0.0 Hz, chờ 0, output 57.7 fps<br>21 buffer so tham chiếu: 21 khớp, 0 lệch, maxDiff 0 (bỏ qua 0 cảnh động, 0 chờ ảnh) |
| tay giả lập theo quỹ đạo: cửa sổ đổi ô liên tục mà epoch giữ nguyên, fps output ổn định, tác vụ chờ ≤ 1 | pass | 7,9 s | quỹ đạo 3 ô / 4 s: 16 vị trí hộp trong 4,5 s, epoch 4 giữ nguyên; output 60.0 fps, mặt 0.0 Hz, vẽ p95 0.70 ms, tick p95 6.20 ms<br>33 buffer so tham chiếu: 33 khớp, 0 lệch, maxDiff 0 (bỏ qua 0 cảnh động, 0 chờ ảnh) |

#### synthetic.spec.ts (mục 7.9, 7.2)

| Ca | Kết quả | Thời gian | Số đo |
|---|---|---|---|
| nguồn tổng hợp: không gọi camera thật; cửa sổ bên phải xanh lá, bên trái magenta; tắt mirror thì đảo; đóng thì trắng | pass | 4,3 s | 12 buffer so tham chiếu: 12 khớp, 0 lệch, maxDiff 0 (bỏ qua 0 cảnh động, 0 chờ ảnh) |
| probe onOutputFrame nhận ImageData toàn canvas theo nhịp; delayWorker ghi vào probes; cảnh đổi được | pass | 5,1 s | 5 buffer so tham chiếu: 5 khớp, 0 lệch, maxDiff 0 (bỏ qua 0 cảnh động, 0 chờ ảnh) |
| ?debug=1 không có source: camera thật vẫn là nguồn, probe bật, kịch bản có sẵn | pass | 5,0 s |  |
| không có ?debug=1: không có probe, không có kịch bản | pass | 4,8 s |  |

#### ux.spec.ts (mục 7.20, 7.28, 7.2)

| Ca | Kết quả | Thời gian | Số đo |
|---|---|---|---|
| hướng dẫn ba bước với camera giả và cửa sổ chuột: bật camera → mở cửa sổ → tìm mặt; Esc và dừng camera đưa về bước trước, canvas trắng | pass | 17,4 s | chuỗi thông điệp: Bật camera để bắt đầu → Mở cửa sổ bằng chuột → Đang tìm khuôn mặt trong cửa sổ → Mở cửa sổ bằng chuột → Bật camera để bắt đầu |
| hướng dẫn theo tay giả lập trên nguồn tổng hợp: mỗi lý do đóng có thông điệp riêng; tab ẩn về bước camera; mở thì sang bước khuôn mặt | pass | 17,5 s | chuỗi thông điệp: Đang nạp bộ nhận diện tay… → Còn thiếu đầu ngón → Đang tìm khuôn mặt trong cửa sổ → Hai tay chéo nhau → Mất dấu đầu ngón → Các đầu ngón quá gần nhau → Đầu ngón ra ngoài bảng → Tab đang ẩn<br>6 buffer so tham chiếu: 6 khớp, 0 lệch, maxDiff 0 (bỏ qua 0 cảnh động, 0 chờ ảnh) |
| panel cài đặt thu gọn được (canvas nhận lại chỗ theo chiều rộng, UX-03), panel debug tách riêng và mặc định đóng khi không có ?debug=1; trạng thái giữ qua tải lại trong tab | pass | 12,0 s | canvas 960×672 px khi mở cột cài đặt, 1280×672 px khi thu gọn (epoch 1 → 2), 1280×522 px khi mở ngăn kéo debug |
| toàn màn hình: nút và phím F; thanh và panel thành lớp phủ (canvas không đổi cỡ khi lớp phủ ẩn), tự ẩn sau khi không tương tác, chuột hiện lại | pass | 12,6 s | toàn màn hình 1280×720 CSS px, canvas bằng đúng .stage; epoch 3 giữ nguyên khi lớp phủ ẩn và hiện<br>29 buffer so tham chiếu: 29 khớp, 0 lệch, maxDiff 0 (bỏ qua 0 cảnh động, 0 chờ ảnh) |

### E2E trên bản build (Playwright, `npm run test:deploy`, REL-01)

`dist/` qua `vite preview` (playwright.deploy.config.ts), project chromium, chrome: 12 ca: 12 pass, 0 fail, 0 bỏ qua; tổng thời gian 16,5 s (tuần tự).

#### tests/deploy/sw.spec.ts (mục 7.27)

| Ca | Kết quả | Thời gian | Số đo |
|---|---|---|---|
| [chromium] khóa cache trong dist/sw.js: MODELS_KEY là sha256 rút gọn của models.json, BUILD_ID theo dist/assets | pass | 0,0 s | khóa model 5c1bcc341da7, build 58155d7fa543, base / |
| [chromium] trang đầu (chặn đăng ký): đặt đồng ý và tạo hai cache wct-* cũ để ca sau kiểm activate xóa chúng | pass | 0,2 s |  |
| [chromium] lần mở 1 vào #/app: worker kích hoạt và điều khiển trang, xóa cache cũ, cache đủ model, wasm, loader ORT theo EP và asset của trang | pass | 3,4 s | EP wasm → loader jsep; cache model 7 file, cache app 7 file; lần 1 tải 12 phản hồi models/ + assets/, 40.1 MB theo Content-Length |
| [chromium] lần mở 2: trang được điều khiển từ đầu, mọi phản hồi models/ và assets/ đến từ service worker và worker không xin mạng cho chúng (cache hit) | pass | 2,7 s | EP wasm; 12/12 phản hồi models/ và assets/ từ service worker; worker chỉ ra mạng 1 lần (trang): / |
| [chromium] lần mở 3 offline: trang, asset, model và loader ORT từ cache; worker mặt và phân loại sẵn sàng, cửa sổ mở | pass | 2,5 s | offline: EP wasm, worker mặt và phân loại sẵn sàng, vùng mở |
| [chromium] không yêu cầu nào rời origin của trang trong cả ba lần mở (I9, đo ở context gồm cả service worker) | pass | 0,0 s | 64 yêu cầu, 27 tới models/, 0 khác origin |
| [chrome] khóa cache trong dist/sw.js: MODELS_KEY là sha256 rút gọn của models.json, BUILD_ID theo dist/assets | pass | 0,0 s | khóa model 5c1bcc341da7, build 58155d7fa543, base / |
| [chrome] trang đầu (chặn đăng ký): đặt đồng ý và tạo hai cache wct-* cũ để ca sau kiểm activate xóa chúng | pass | 0,3 s |  |
| [chrome] lần mở 1 vào #/app: worker kích hoạt và điều khiển trang, xóa cache cũ, cache đủ model, wasm, loader ORT theo EP và asset của trang | pass | 4,3 s | EP webgpu → loader asyncify; cache model 7 file, cache app 7 file; lần 1 tải 12 phản hồi models/ + assets/, 38.5 MB theo Content-Length |
| [chrome] lần mở 2: trang được điều khiển từ đầu, mọi phản hồi models/ và assets/ đến từ service worker và worker không xin mạng cho chúng (cache hit) | pass | 1,6 s | EP webgpu; 12/12 phản hồi models/ và assets/ từ service worker; worker chỉ ra mạng 1 lần (trang): / |
| [chrome] lần mở 3 offline: trang, asset, model và loader ORT từ cache; worker mặt và phân loại sẵn sàng, cửa sổ mở | pass | 1,4 s | offline: EP webgpu, worker mặt và phân loại sẵn sàng, vùng mở |
| [chrome] không yêu cầu nào rời origin của trang trong cả ba lần mở (I9, đo ở context gồm cả service worker) | pass | 0,0 s | 63 yêu cầu, 26 tới models/, 0 khác origin |

<!-- report:end -->
