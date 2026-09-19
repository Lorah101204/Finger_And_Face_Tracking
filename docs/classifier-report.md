# Báo cáo phân loại người và hình nộm (CLS-02)

Tài liệu của gói CLS-02 (WORK-BREAKDOWN mục 6, quyết định D-044): đường ống phân loại trong app, model, cách đánh giá theo mục 7.3 và kết quả. Trạng thái: **chưa có model huấn luyện** vì chưa có dataset thật (CLS-01 mục 8); đường ống chạy với model stub và được kiểm thử tự động; script huấn luyện, export, kiểm export và đánh giá đã có nhưng chưa chạy được trên máy phát triển (không có PyTorch).

## 1. Đường ống trong app (bước 4, 5, 6)

- `src/classify/classifier.worker.ts`: ONNX Runtime Web trong module worker, EP `webgpu` khi `navigator.gpu.requestAdapter()` trả adapter (headless shell có `navigator.gpu` nhưng không có adapter) (bundle `onnxruntime-web/webgpu`), không thì `wasm` (D-013); loader wasm theo môi trường (`/node_modules/onnxruntime-web/dist/` khi dev, `/models/ort/` khi build, copy bởi `npm run models:fetch`). Chỉ nhận `RestrictedFrame` qua `detect` (I1): bitmap letterbox 256 được vẽ về cạnh input 128 trên canvas riêng của worker, chuẩn hóa `(x / 255 − 0,45) / 0,225`, chạy session, softmax → `probs [person, mannequin]`; `input.close()` trong `finally`. Warm-up một tensor 0 sau init.
- `src/classify/classifierClient.ts`: cùng khung với `FaceClient`; worker khởi tạo lười khi vùng mở lần đầu (vòng lặp gọi `start()`): một tác vụ tại một thời điểm, `rejectAll` khi đóng hay đổi epoch, nhịp `max(1000 / 4, p50 inferMs)` (3 đến 5 Hz), p50/p95, `window.__wct.classifier`.
- Vòng lặp (`src/loop/frameLoop.ts`): khi classifier rảnh, đến nhịp và cạnh ngắn `cameraRect` ≥ 96 px, builder tạo bitmap thứ hai của **cùng crop** (`copies = 2`, không tạo crop khác); kết quả về qua gate epoch, `taskId` đã loại, tuổi ≤ 600 ms, vùng còn mở; nhãn giữ tối đa 1,5 s và gắn vào từng mặt đã validate bằng quy tắc unknown (`src/classify/subjectRule.ts`); đóng vùng thì xóa nhãn, tác vụ đang chạy bị loại khi về.
- Quy tắc unknown (bước 2, không dùng chuyển động): chưa có kết quả; `max(prob) < 0,7`; cạnh ngắn ROI < 96 px; mặt `partial` mà phần landmark còn trong vùng mở dưới 60 %. `ValidatedFace.subjectType` và `confidence` nằm trong `FrameOutput.faces`.
- UI (UC-07): nhãn "Người", "Hình nộm", "Khuôn mặt chưa phân loại" kèm phần trăm vẽ trên bbox mặt (compositor, chỉ `fillRect` và `fillText`, trong clip vùng mở), lớp hướng dẫn (UX-01) nêu nhãn ở bước 3, dòng `classifier-stat` trong panel debug, `stats` (PERF-01) có Hz phân loại.

## 2. Model

| Mục | Hiện tại (stub, D-044) | Kế hoạch (model thật) |
|---|---|---|
| File | `public/models/classifier-stub.onnx` (360 byte, sinh bởi `tools/make-stub-classifier.mjs` trong `models:fetch`) | `public/models/classifier.onnx` (export từ checkpoint, sha256 ghi vào `public/models/models.json`) |
| Kiến trúc | GlobalAveragePool → Flatten → Gemm(3 → 2): person = G − (R + B) / 2 trên màu trung bình đã chuẩn hóa | MobileNetV3-small (hoặc EfficientNet-B0) của torchvision, đầu ra 2 lớp |
| Input, output | `input` float32 [1, 3, 128, 128], `logits` [1, 2], opset 17 | như stub (cố định, không dynamic axes) |
| Ý nghĩa | Kiểm đường ống: cảnh tổng hợp xanh lá → person, magenta → mannequin, xám đệm → 0,5/0,5 (unknown) | Phân loại thật theo dataset CLS-01 |

Đổi sang model thật: `python tools/train/train.py data/dataset --out data/train/run1`, `python tools/train/export_onnx.py data/train/run1/classifier.pt --out public/models/classifier.onnx`, `python tools/train/check_onnx.py data/train/run1/classifier.pt public/models/classifier.onnx --root data/dataset`, ghi sha256 vào `models.json` (mục `classifier`), đổi `DEFAULTS.classifier.modelPath` sang `/models/classifier.onnx`. Augment trong `tools/train/dataset.py` mô phỏng đường chạy: crop lệch biên, letterbox xám 128, giảm độ phân giải, lật, jitter sáng; chuẩn hóa cùng giá trị với app. Môi trường: `tools/train/requirements.txt`.

## 3. Cách đánh giá (mục 7.3)

`python tools/train/eval.py public/models/classifier.onnx data/dataset --split test --doc docs/classifier-report.md` chạy model bằng onnxruntime Python trên tập test (chia theo `subjectId`), áp cùng quy tắc unknown (ngưỡng 0,7, ROI < 96 px), rồi ghi mục 4: precision và recall từng lớp (unknown và miss tính vào thiếu recall của lớp thật; mẫu nền hay chưa rõ được gán nhãn tính vào FP), tỉ lệ hình nộm bị gán người, tỉ lệ unknown, theo cỡ cửa sổ, theo vị trí cắt biên, hình nộm silicone báo riêng. Phần tính metric thuần Python ở `tools/train/metrics.py` có unittest (`python -m unittest discover -s tools/train`). Mục tiêu: precision và recall ≥ 0,90 cả hai lớp.

## 4. Kết quả

<!-- classifier:begin -->
Chưa có model huấn luyện và dataset thật: bảng sinh sau khi chạy `tools/train/eval.py --doc docs/classifier-report.md`. Với model stub, e2e `tests/e2e/classify.spec.ts` ghi số đo đường ống (EP, init, warm-up, inferMs, nhịp) vào `docs/test-report-mask.md`.
<!-- classifier:end -->

## 5. Đường ống trên máy mục tiêu (QA-02, model stub)

Đo bằng `npm run test:bench` (ca 2 và 3 của `tests/bench/bench.spec.ts`, ma trận đầy đủ ở [benchmark.md](benchmark.md) mục 5), cửa sổ chuột 16 ô quanh mặt của `face.png`, 20 s, nhịp 4 Hz:

| Trình duyệt | EP mặc định | init | infer p50 / p95 | Hz | Khoảng cách kết quả p95 | Tuổi lúc gate nhận p95 | wasm (ép `ep=wasm`) |
|---|---|---|---|---|---|---|---|
| Chrome 153, RTX 3050 | webgpu (adapter nvidia) | 982 ms | 19,6 / 30,9 ms | 4,0 | 272 ms | 54 ms | init 658 ms, p50 4,7 ms, 4,0 Hz |
| Edge 153, RTX 3050 | webgpu | 1105 ms | 17,0 / 28,8 ms | 4,0 | 271 ms | 59 ms | init 680 ms, p50 4,8 ms, 4,0 Hz |
| Chromium headless shell (SwiftShader) | wasm (không có adapter) | 1554 ms | 1,0 / 1,2 ms | 3,0 | 351 ms | 37 ms | init 935 ms, p50 1,0 ms, 3,5 Hz |

Nhận xét: với stub 360 byte, wasm nhanh hơn webgpu vì chi phí điều phối GPU trội (khoảng 15 đến 20 ms mỗi lần chạy); S6 với MobileNetV2 224 px cho webgpu 19 ms so với wasm 59 ms, nên thứ tự EP giữ theo D-013 và đo lại bằng `ep=wasm` khi có model thật (nếu wasm vẫn nhanh hơn với model 128 px thì đổi thứ tự trong `core/config.ts`). Cả hai EP xa dưới nhịp 250 ms nên Hz phân loại do rate control và nhịp buffer mặt quyết định (khoảng cách kết quả là bội của khoảng cách buffer mặt: 3 × 86 ms trên GPU thật, 3 × 117 ms headless). Tuổi kết quả và tuổi nhãn chốt theo số đo này ở benchmark.md mục 6 (D-045); ngưỡng unknown 0,7 chỉ chốt được khi có model thật và tập test.

## 6. Còn lại

- Thu dataset (CLS-01 mục 8), huấn luyện, export, kiểm export, ghi sha256, đổi `modelPath`, chạy `eval.py --doc` (metric mục 7.3, gồm theo cỡ cửa sổ, cắt biên, hình nộm silicone).
- Với model thật: đo lại EP bằng `npm run test:bench` (ca 3) và chốt ngưỡng unknown theo tập test.
