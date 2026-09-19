# Technical spikes (SPIKE-00)

Each spike is a question with a clear measurement method; results record measurements, not impressions. The questions and methods come from package SPIKE-00 in [WORK-BREAKDOWN.md](./WORK-BREAKDOWN.md). The decisions drawn from them are recorded in [decisions.md](./decisions.md) (D-008 to D-014). Raw data: [spikes/raw/](./spikes/raw/). Spike code: `tools/spikes/` (outside the main code path).

Measurement date: 2026-09-17. Each number is p50 (ms) unless stated otherwise; p95 in parentheses.

## Measurement setup

| Item | Value |
|---|---|
| CPU | Intel Core i5-12500H (12 cores, 16 threads) |
| GPU used by the browser | NVIDIA GeForce RTX 3050 Laptop 4 GB, via ANGLE Direct3D11 (the machine also has Intel Iris Xe and Parsec Virtual Display) |
| RAM | 15.7 GB |
| OS | Windows 11 Home 10.0.26200 |
| Main browser (S1, S2, S3, S5, S6) | Claude desktop's built-in browser, Chrome 152.0.7977.76, WebGL2 on RTX 3050 |
| Secondary browser (S4 phase 1, S5 secondary) | Playwright Chromium headless shell, HeadlessChrome 153.0.8010.12, SwiftShader software GPU |
| Libraries | `@mediapipe/tasks-vision` 1.0.1, `onnxruntime-web` 1.30.0, Vite 8.3.0, Playwright 1.63 |
| Models | hand_landmarker float16/1, face_landmarker float16/1 (sha256 in `public/models/models.json`), mobilenetv2-12.onnx (ONNX model zoo) |
| Sample images | MediaPipe static sample images (business-person.png, woman_hands.jpg, thumbs_up.jpg, pointing_up.jpg), no real webcam |

Environment constraints that affect the measurements:

- The built-in browser pane is hidden during measurement: `document.visibilityState = hidden`, rAF does not run, video elements do not play. This does not affect workers, wasm, WebGL, WebGPU (S1, S2, S3, S6) but blocks measurements that need rAF or a playing video (S4 phase 2, the video source of S5).
- The tool environment cannot spawn `chrome.exe` (even with `--headless=new`); only the headless shell runs. Playwright always adds flags that disable background throttling, so it cannot be used to measure background tabs.
- Vite dev refuses `import()` of files in `public/`; both MediaPipe (wasm loader in a module worker) and ORT (`.mjs` loader) load via `import()`, so in dev they must point at `node_modules` (see D-008, D-013).

## Results

### S1. Face Landmarker in a Worker: init and infer by image size

Input: a 392 px square crop around the face, gray letterboxed to 64, 128, 256 px (like `restrictedFrame`). 40 runs per size. `detect` measured in the worker; round trip measured on the main thread.

| Setup | init | warm-up | 64 px | 128 px | 256 px | faces found |
|---|---|---|---|---|---|---|
| Module worker, GPU (`useModule = true`, wasm via Vite) | 513 | 355 | 14.5 (22.9) | 14.4 (18.1) | 14.6 (16.1) | 1/1/1 |
| Module worker, CPU | 251 | 132 | 39.3 (46.1) | 38.6 (44.3) | 41.7 (46.2) | 1/1/1 |
| Classic worker + `import()`, GPU | 162 | 203 | 15.2 (22.1) | 14.3 (17.0) | 14.4 (16.1) | 1/1/1 |
| Classic worker, CPU | 145 | 71 | 40.0 (44.5) | 39.1 (44.2) | 38.9 (43.6) | 1/1/1 |
| Main thread, GPU | 136 | | 14.8 (19.5) | 14.4 (16.0) | 13.8 (16.3) | 1/1/1 |
| Main thread, CPU | 136 | | 39.6 (45.0) | 38.5 (45.0) | 38.9 (44.0) | 1/1/1 |

Notes:

- Inference cost does not depend on crop size (the model resizes to a fixed input itself). GPU ≈ 14 ms, CPU ≈ 39 ms. The worker round trip adds only 0.3 to 0.5 ms.
- The module worker only runs when calling `FilesetResolver.forVisionTasks(base, true)`: the second argument selects the ES module loader `vision_wasm_module_internal.js`; the default loader gets `import()`ed as a module, so `ModuleFactory` never reaches the global scope and fails with "ModuleFactory not set". Bundle 1.0.1 falls back from `importScripts` to `import()` in a module worker on its own.
- In Vite dev, `base` must be `/node_modules/@mediapipe/tasks-vision/wasm` (Vite transforms and serves it as a module); Vite refuses `import()` of `public/models/wasm`. In the static build, `/models/wasm` works because the browser `import()`s the static file directly.
- The face is still found at a 64 px crop (face about 45 px) on a studio image; the `minRoiPx = 64` threshold is reasonable to start with and needs remeasuring with a real webcam.

### S2. Hand Landmarker VIDEO mode 720p: main thread versus worker

Source: a 1280 × 720 canvas, a letterboxed static two-hand image plus a moving red square; 300 frames with hands, 100 empty frames. No real webcam, so tracking is easier than in practice.

| Setup | init | 2 hands, detect | 2 hands, round trip | `createImageBitmap` + transfer | empty frame |
|---|---|---|---|---|---|
| Main thread, GPU | 229 | 69.5 (76.5) | | | 20.8 (21.5) |
| Main thread, CPU | 130 | 53.9 (59.3) | | | 34.8 (38.9) |
| Classic worker, GPU | 132 | 62.2 (69.5) | 62.4 (69.6) | 0.1 | 20.3 (21.3) |
| Classic worker, CPU | 163 | 48.9 (56.7) | 49.1 (56.9) | 0.1 | 27.5 (29.8) |

Notes:

- Transferring the raw 720p frame to the worker is nearly free (0.1 ms to create the bitmap, 0.2 ms extra round trip). The whole 50 to 70 ms detect cost leaves the main thread.
- On this machine, with two hands, the CPU delegate is faster than GPU (49 versus 62 ms in the worker); on empty frames (palm detection only) GPU is faster (20 versus 27 ms). Two hands give about 16 Hz (GPU) to 20 Hz (CPU); one hand will be faster.
- The module worker failed when S2 ran because `useModule` was not yet enabled; S1 shows module and classic are equivalent in speed.

### S3. Handedness label on unmirrored images

An unmirrored image is equivalent to a raw webcam frame. Labels were checked against anatomy by eye (arm position, palm, thumb relative to the little finger). Flipped horizontally with a canvas and measured again.

| Image | Anatomical hand | Label on the original (score) | Label on the flipped image (score) |
|---|---|---|---|
| pointing_up.jpg | left hand (raised on the right of the frame, palm toward the camera) | Left (0.99) | Right (0.99) |
| thumbs_up.jpg | right hand (person turned sideways) | Right (0.98) | Left (0.91) |
| woman_hands.jpg, upper hand on the right of the frame | right hand (arm from the right shoulder across the forehead) | Right (0.96) | Left (0.95) |
| woman_hands.jpg, lower hand on the left of the frame | left hand | Left (0.94) | Right (0.99) |

Notes: with tasks-vision 1.0.1, the label on an unmirrored image matches the anatomical hand; on a mirrored image the label is reversed. This contradicts the old note in the MediaPipe documentation ("assumes a mirrored image"), so the conclusion applies only to this model version and must be confirmed in 10 seconds with a real webcam at the start of HAND-01: raise the right hand in front of the camera, the label must be Right.

### S4. requestVideoFrameCallback with a hidden video and in a background tab

Phase 1 (hidden video element, visible document): Chromium headless shell 153 with Chromium's 20 fps fake camera, 4 seconds per condition.

| Video element condition | rVFC (Hz) | rAF (Hz) |
|---|---|---|
| visible 320 px | 20.2 | 60.3 |
| opacity: 0 | 20.2 | 60.1 |
| position fixed, left -10000 px | 20.0 | 60.3 |
| width and height 1 px | 20.0 | 60.1 |
| visibility: hidden | 20.0 | 59.9 |
| display: none | 20.0 | 60.0 |

`MediaStreamTrackProcessor` is available on Chromium and reads 20.1 frames/s from the camera track.

Phase 2 (background tab): cannot be measured automatically in this environment. In the hidden pane of the built-in browser, `visibilityState = hidden` but the host pauses media (the video loads, `play()` never resolves), unlike regular Chrome; Playwright disables background throttling. Per the spec, the rVFC callback runs in the document's render step, so it does not fire while the tab is hidden. A 10 second manual check on Chrome with a webcam (open the app, switch tabs, read the debug counter) is the first step of CAM-01.

### S5. 1:1 crop into an OffscreenCanvas then transferToImageBitmap

300 runs per measurement. Built-in browser, real GPU, 1280 × 720 canvas source (the video source cannot play because the pane is hidden). Secondary columns: headless shell, software GPU, 720p WebM video source, for relative comparison only.

| Measurement | canvas 256 px (real GPU) | canvas 720 px (real GPU) | video 256 px (headless) | video 720 px (headless) |
|---|---|---|---|---|
| `drawImage` 1:1 + `transferToImageBitmap` | 0.1 (0.2) | 0.1 (0.2) | 0.0 (0.1) | 1.4 (1.8) |
| `createImageBitmap(src, sx, sy, sw, sh)` | 0.0 (0.2) | 0.0 (0.1) | 1.8 | 4.1 |
| crop + letterbox 256 + transfer | 0.1 (0.2) | 0.1 (0.2) | 0.1 | 1.0 |
| `drawImage` + `getImageData` (readback for the probe) | 8.6 (14.4) | 13.6 (29.1) | 0.3 | 3.2 |

Notes: the crop, letterbox and transfer path costs almost no main thread time on a real GPU (the commands are pushed to the GPU). Only the `getImageData` readback is expensive (9 to 14 ms, p95 up to 29 ms), so the probe and dataset mode must not run every frame on the main thread.

### S6. ONNX Runtime Web with a sample MobileNetV2

30 runs per setup, random input. The model zoo model fixes the input at 224, so 128 px fails with "invalid dimensions"; the model trained in CLS-02 will be exported at the right size. `crossOriginIsolated = false`, so wasm runs single-threaded.

| EP | init | first run | run 224 px | 128 px |
|---|---|---|---|---|
| wasm | 238 | 139 | 59.3 (66.1) | not supported by the model |
| webgpu (`onnxruntime-web/webgpu`) | 385 | 428 | 19.0 (27.2) | not supported by the model |

Notes: both EPs run on Chrome 152 with the RTX 3050. At 3 to 5 Hz, single-threaded wasm costs about 20 to 30% of one core; webgpu is three times cheaper but has a startup cost. The ORT loader also needs an environment-dependent path, like MediaPipe.

## Rerun

```bash
npm run dev
# open http://localhost:5173/tools/spikes/s1.html ... s6.html (S1, S2 support ?wasm=nm&only=module|classic|main)
node tools/spikes/make-webm.mjs             # creates public/spike-assets/test.webm for S4, S5
node tools/spikes/run-spike.mjs s4 "?phase=fg" -fg   # runs one page in the headless shell, writes docs/spikes/raw/
```

Assets in `public/spike-assets/` (sample images, ONNX model, ORT wasm, WebM) are downloaded with Node fetch and not committed.
