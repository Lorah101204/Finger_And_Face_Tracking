# Spike kỹ thuật (SPIKE-00)

Mỗi spike là một câu hỏi có cách đo rõ; kết quả ghi số đo, không ghi cảm nhận. Câu hỏi và cách đo lấy từ gói SPIKE-00 trong [WORK-BREAKDOWN.md](./WORK-BREAKDOWN.md). Quyết định rút ra ghi ở [decisions.md](./decisions.md) (D-008 đến D-014). Số liệu thô: [spikes/raw/](./spikes/raw/). Mã spike: `tools/spikes/` (ngoài đường chạy chính).

Ngày đo: 2026-09-17. Mỗi số là p50 (ms) trừ khi ghi khác; p95 trong ngoặc.

## Cấu hình đo

| Mục | Giá trị |
|---|---|
| CPU | Intel Core i5-12500H (12 nhân, 16 luồng) |
| GPU dùng bởi trình duyệt | NVIDIA GeForce RTX 3050 Laptop 4 GB, qua ANGLE Direct3D11 (máy còn có Intel Iris Xe và Parsec Virtual Display) |
| RAM | 15,7 GB |
| OS | Windows 11 Home 10.0.26200 |
| Trình duyệt chính (S1, S2, S3, S5, S6) | Trình duyệt tích hợp của Claude desktop, Chrome 152.0.7977.76, WebGL2 trên RTX 3050 |
| Trình duyệt phụ (S4 pha 1, S5 phụ) | Playwright Chromium headless shell, HeadlessChrome 153.0.8010.12, GPU phần mềm SwiftShader |
| Thư viện | `@mediapipe/tasks-vision` 1.0.1, `onnxruntime-web` 1.30.0, Vite 8.3.0, Playwright 1.63 |
| Model | hand_landmarker float16/1, face_landmarker float16/1 (sha256 trong `public/models/models.json`), mobilenetv2-12.onnx (ONNX model zoo) |
| Ảnh mẫu | Ảnh tĩnh mẫu của MediaPipe (business-person.png, woman_hands.jpg, thumbs_up.jpg, pointing_up.jpg), không có webcam thật |

Ràng buộc môi trường ảnh hưởng cách đo:

- Pane trình duyệt tích hợp bị ẩn trong lúc đo: `document.visibilityState = hidden`, rAF không chạy, video element không phát. Không ảnh hưởng worker, wasm, WebGL, WebGPU (S1, S2, S3, S6) nhưng chặn các phép đo cần rAF hoặc video phát (S4 pha 2, nguồn video của S5).
- Từ môi trường chạy tool không spawn được `chrome.exe` (kể cả `--headless=new`); chỉ headless shell chạy được. Playwright luôn thêm cờ tắt throttling nền nên không dùng để đo tab nền.
- Vite dev từ chối `import()` file trong `public/`; cả MediaPipe (loader wasm trong module worker) lẫn ORT (loader `.mjs`) đều nạp bằng `import()` nên khi dev phải trỏ vào `node_modules` (xem D-008, D-013).

## Kết quả

### S1. Face Landmarker trong Worker: init và infer theo kích thước ảnh

Ảnh vào: crop vuông 392 px quanh mặt, letterbox xám về 64, 128, 256 px (giống `restrictedFrame`). 40 lần mỗi cỡ. `detect` đo trong worker; round trip đo ở main thread.

| Cấu hình | init | warm-up | 64 px | 128 px | 256 px | mặt tìm thấy |
|---|---|---|---|---|---|---|
| Worker module, GPU (`useModule = true`, wasm qua Vite) | 513 | 355 | 14,5 (22,9) | 14,4 (18,1) | 14,6 (16,1) | 1/1/1 |
| Worker module, CPU | 251 | 132 | 39,3 (46,1) | 38,6 (44,3) | 41,7 (46,2) | 1/1/1 |
| Worker classic + `import()`, GPU | 162 | 203 | 15,2 (22,1) | 14,3 (17,0) | 14,4 (16,1) | 1/1/1 |
| Worker classic, CPU | 145 | 71 | 40,0 (44,5) | 39,1 (44,2) | 38,9 (43,6) | 1/1/1 |
| Main thread, GPU | 136 | | 14,8 (19,5) | 14,4 (16,0) | 13,8 (16,3) | 1/1/1 |
| Main thread, CPU | 136 | | 39,6 (45,0) | 38,5 (45,0) | 38,9 (44,0) | 1/1/1 |

Nhận xét:

- Chi phí infer không phụ thuộc kích thước crop (model tự resize về đầu vào cố định). GPU ≈ 14 ms, CPU ≈ 39 ms. Round trip qua worker chỉ cộng 0,3 đến 0,5 ms.
- Worker module chỉ chạy khi gọi `FilesetResolver.forVisionTasks(base, true)`: tham số thứ hai chọn loader ES module `vision_wasm_module_internal.js`; loader mặc định bị `import()` như module nên `ModuleFactory` không lên global và lỗi "ModuleFactory not set". Bundle 1.0.1 tự fallback từ `importScripts` sang `import()` trong module worker.
- Trong Vite dev, `base` phải là `/node_modules/@mediapipe/tasks-vision/wasm` (Vite biến đổi và phục vụ như module); `public/models/wasm` bị Vite từ chối `import()`. Khi build tĩnh, `/models/wasm` dùng được vì trình duyệt `import()` file tĩnh trực tiếp.
- Mặt vẫn được tìm thấy ở crop 64 px (mặt khoảng 45 px) trên ảnh studio; ngưỡng `minRoiPx = 64` là hợp lý để bắt đầu, cần đo lại với webcam thật.

### S2. Hand Landmarker VIDEO mode 720p: main thread so với worker

Nguồn: canvas 1280 × 720, ảnh hai tay tĩnh letterbox cộng một ô đỏ chuyển động; 300 frame có tay, 100 frame trống. Không có webcam thật nên tracking dễ hơn thực tế.

| Cấu hình | init | 2 tay, detect | 2 tay, round trip | `createImageBitmap` + transfer | frame trống |
|---|---|---|---|---|---|
| Main thread, GPU | 229 | 69,5 (76,5) | | | 20,8 (21,5) |
| Main thread, CPU | 130 | 53,9 (59,3) | | | 34,8 (38,9) |
| Worker classic, GPU | 132 | 62,2 (69,5) | 62,4 (69,6) | 0,1 | 20,3 (21,3) |
| Worker classic, CPU | 163 | 48,9 (56,7) | 49,1 (56,9) | 0,1 | 27,5 (29,8) |

Nhận xét:

- Chuyển frame gốc 720p sang worker gần như miễn phí (0,1 ms tạo bitmap, 0,2 ms round trip thêm). Mọi chi phí detect 50 đến 70 ms rời khỏi main thread.
- Trên máy này, với hai tay, CPU delegate nhanh hơn GPU (49 so với 62 ms trong worker); frame trống (chỉ palm detection) GPU nhanh hơn (20 so với 27 ms). Hai tay cho khoảng 16 Hz (GPU) đến 20 Hz (CPU); một tay sẽ nhanh hơn.
- Worker module lỗi khi chạy S2 vì lúc đó chưa bật `useModule`; S1 cho thấy module và classic tương đương về tốc độ.

### S3. Nhãn handedness với ảnh chưa mirror

Ảnh chưa mirror tương đương frame webcam thô. Đối chiếu nhãn với giải phẫu bằng mắt (vị trí cánh tay, lòng bàn tay, ngón cái so với ngón út). Lật ngang bằng canvas rồi đo lại.

| Ảnh | Tay theo giải phẫu | Nhãn ảnh gốc (điểm) | Nhãn ảnh lật (điểm) |
|---|---|---|---|
| pointing_up.jpg | tay trái (giơ bên phải khung, lòng bàn tay về camera) | Left (0,99) | Right (0,99) |
| thumbs_up.jpg | tay phải (người quay nghiêng) | Right (0,98) | Left (0,91) |
| woman_hands.jpg, tay trên bên phải khung | tay phải (cánh tay từ vai phải vắt qua trán) | Right (0,96) | Left (0,95) |
| woman_hands.jpg, tay dưới bên trái khung | tay trái | Left (0,94) | Right (0,99) |

Nhận xét: với tasks-vision 1.0.1, nhãn trên ảnh chưa mirror trùng tay giải phẫu; ảnh mirror thì nhãn đảo. Điều này ngược với ghi chú cũ trong tài liệu MediaPipe ("giả định ảnh đã mirror"), nên kết luận chỉ áp dụng cho phiên bản model này và phải xác nhận 10 giây với webcam thật khi bắt đầu HAND-01: giơ tay phải trước camera, nhãn phải là Right.

### S4. requestVideoFrameCallback khi video ẩn và khi tab nền

Pha 1 (video element ẩn, document visible): Chromium headless shell 153 với camera giả 20 fps của Chromium, 4 giây mỗi điều kiện.

| Điều kiện video element | rVFC (Hz) | rAF (Hz) |
|---|---|---|
| visible 320 px | 20,2 | 60,3 |
| opacity: 0 | 20,2 | 60,1 |
| position fixed, left -10000 px | 20,0 | 60,3 |
| width và height 1 px | 20,0 | 60,1 |
| visibility: hidden | 20,0 | 59,9 |
| display: none | 20,0 | 60,0 |

`MediaStreamTrackProcessor` có trên Chromium và đọc được 20,1 frame/s từ track camera.

Pha 2 (tab nền): không đo tự động được ở môi trường này. Trong pane ẩn của trình duyệt tích hợp, `visibilityState = hidden` nhưng host tạm dừng media (video nạp xong, `play()` không resolve), khác Chrome thường; Playwright tắt throttling nền. Theo đặc tả, callback rVFC chạy trong bước render của document nên không bắn khi tab ẩn. Kiểm tra thủ công 10 giây trên Chrome với webcam (mở app, chuyển tab, đọc bộ đếm debug) là bước đầu của CAM-01.

### S5. Cắt 1:1 vào OffscreenCanvas rồi transferToImageBitmap

300 lần mỗi phép đo. Trình duyệt tích hợp, GPU thật, nguồn canvas 1280 × 720 (nguồn video không phát được vì pane ẩn). Cột phụ: headless shell, GPU phần mềm, nguồn video WebM 720p, chỉ để so tương đối.

| Phép đo | canvas 256 px (GPU thật) | canvas 720 px (GPU thật) | video 256 px (headless) | video 720 px (headless) |
|---|---|---|---|---|
| `drawImage` 1:1 + `transferToImageBitmap` | 0,1 (0,2) | 0,1 (0,2) | 0,0 (0,1) | 1,4 (1,8) |
| `createImageBitmap(src, sx, sy, sw, sh)` | 0,0 (0,2) | 0,0 (0,1) | 1,8 | 4,1 |
| crop + letterbox 256 + transfer | 0,1 (0,2) | 0,1 (0,2) | 0,1 | 1,0 |
| `drawImage` + `getImageData` (đọc ngược cho probe) | 8,6 (14,4) | 13,6 (29,1) | 0,3 | 3,2 |

Nhận xét: đường cắt, letterbox và transfer gần như không tốn main thread trên GPU thật (lệnh được đẩy xuống GPU). Đọc ngược `getImageData` mới đắt (9 đến 14 ms, p95 tới 29 ms) nên probe và dataset mode không được chạy mỗi frame trên main thread.

### S6. ONNX Runtime Web với MobileNetV2 mẫu

30 lần mỗi cấu hình, input ngẫu nhiên. Model zoo cố định input 224 nên 128 px lỗi "invalid dimensions"; model tự huấn luyện ở CLS-02 sẽ export đúng cỡ. `crossOriginIsolated = false` nên wasm chạy đơn luồng.

| EP | init | lần chạy đầu | run 224 px | 128 px |
|---|---|---|---|---|
| wasm | 238 | 139 | 59,3 (66,1) | model không hỗ trợ |
| webgpu (`onnxruntime-web/webgpu`) | 385 | 428 | 19,0 (27,2) | model không hỗ trợ |

Nhận xét: cả hai EP chạy được trên Chrome 152 với RTX 3050. Ở 3 đến 5 Hz, wasm đơn luồng tốn khoảng 20 đến 30% một nhân; webgpu rẻ hơn ba lần nhưng có chi phí khởi động. Loader ORT cũng cần đường dẫn theo môi trường như MediaPipe.

## Chạy lại

```bash
npm run dev
# mở http://localhost:5173/tools/spikes/s1.html ... s6.html (S1, S2 hỗ trợ ?wasm=nm&only=module|classic|main)
node tools/spikes/make-webm.mjs             # tạo public/spike-assets/test.webm cho S4, S5
node tools/spikes/run-spike.mjs s4 "?phase=fg" -fg   # chạy một trang trong headless shell, ghi docs/spikes/raw/
```

Asset trong `public/spike-assets/` (ảnh mẫu, model ONNX, wasm ORT, WebM) tải bằng Node fetch, không commit.
