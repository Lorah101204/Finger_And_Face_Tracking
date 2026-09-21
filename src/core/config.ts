// Tham số mặc định (docs/WORK-BREAKDOWN.md mục 3 và phụ lục 9.1). Tuổi điểm, tuổi kết quả, tuổi nhãn, hysteresis và
// delegate tay chốt ở QA-02 (D-045) theo số đo trong docs/benchmark.md mục 6.
// Các hằng có ghi D-xxx đến từ docs/decisions.md sau SPIKE-00.
import type { FingerTip } from './types'

export const DEFAULTS = {
  camera: {
    width: 1280,
    height: 720,
    /** D-011: không có FrameStamp quá ngưỡng này thì vùng mở đóng với lý do no-camera. */
    noFrameWatchdogMs: 500,
  },
  /** D-021: phạm vi đồng ý. device = localStorage (giữ qua các lần mở); tab = sessionStorage (hết khi đóng tab, kiosk). */
  consent: { scope: 'device' as 'device' | 'tab' },
  grid: {
    cols: 64,
    rows: 36,
    showLines: true,
    mirror: true,
    presets: [
      { cols: 32, rows: 18 },
      { cols: 64, rows: 36 },
      { cols: 128, rows: 72 },
    ],
    custom: { minCols: 4, maxCols: 256, minRows: 4, maxRows: 144 },
  },
  reveal: {
    nMin: 3,
    /** ROI-03 (D-047): số đầu ngón hợp lệ tối thiểu để có đa giác (bao lồi cần ba điểm không thẳng hàng). */
    minPoints: 3,
    hysteresisCells: 0.25,
    oneEuro: { minCutoff: 1.0, beta: 0.02, dCutoff: 1.0 },
    /** ROI-00: cạnh cửa sổ (ô) khi mở bằng chuột hoặc phím Space. */
    mouseInitialN: 8,
  },
  /** D-008: MediaPipe tasks-vision. Module worker cần useModuleLoader; wasm base khác nhau giữa dev và build. */
  mediapipe: {
    wasmBaseDev: '/node_modules/@mediapipe/tasks-vision/wasm',
    wasmBaseProd: '/models/wasm',
    useModuleLoader: true,
    handModel: '/models/hand_landmarker.task',
    faceModel: '/models/face_landmarker.task',
  },
  hands: {
    numHands: 2,
    /** ROI-03 (D-047): đầu ngón dùng cho mọi tay (cái 4, trỏ 8, giữa 12, áp út 16, út 20); UI chọn được. */
    fingers: [4, 8, 12, 16, 20] as FingerTip[],
    /** ROI-03: số tay tối thiểu có điểm hợp lệ (2: cửa sổ do hai tay đóng khung; 1 cho chế độ một tay). */
    minHands: 2,
    matchCostMax: 0.15,
    ambiguityDelta: 0.03,
    trackDropMs: 150,
    /**
     * HAND-01: track chỉ bị xóa khi không thấy quá trackDropMs VÀ vắng trong ít nhất chừng này lần cập nhật liên
     * tiếp: với pipeline 20 Hz bằng đúng quy tắc 150 ms, với pipeline chậm hơn 150 ms mỗi frame một lần bỏ lỡ không
     * xóa track.
     */
    trackDropFrames: 2,
    /** HAND-01: phạt khi nhãn tay khác (< matchCostMax để một frame nhãn nhấp nháy không tách track). */
    handednessPenalty: 0.1,
    /** HAND-01: số frame liên tiếp model gán nhãn ngược trước khi track đổi handedness (giữ id). */
    relabelFrames: 3,
    /** Cạnh ảnh xám warm-up của hand.worker ngay sau init. */
    warmupSize: 256,
    /** HAND-02, ROI-03: điểm nhãn tay tối thiểu để đầu ngón của track hợp lệ (track score theo tay đã gán). */
    minTrackScore: 0.5,
    /** ROI-04 (D-055): chỉ đầu ngón đang giơ (theo hình học landmark) tham gia vùng mở; tắt thì như ROI-03. */
    raisedOnly: true,
    /**
     * ROI-04 (D-055): ngưỡng duỗi/gập (tools/probe-fingers.mjs, 2026-09-21, ảnh spike: duỗi tỉ lệ 1,19–1,34 và góc PIP
     * 144–175°, gập 0,61–0,83 và 74–104°; ngón cái dang 0,92–1,18 duỗi, 0,75 gập). Dải giữa hai ngưỡng giữ trạng thái
     * cũ; đổi trạng thái cần debounceFrames HandFrame liên tiếp. Tạm thời tới khi hiệu chỉnh với webcam (R-02).
     */
    pose: {
      ratioRaised: 1.05,
      ratioFolded: 0.9,
      angleRaised: 135,
      angleFolded: 120,
      abductionRaised: 1.0,
      abductionFolded: 0.85,
      debounceFrames: 3,
    },
    /**
     * D-045 (QA-02): `auto` = GPU khi WebGL chạy trên phần cứng (RTX 3050: 29 Hz so với CPU 11 Hz), CPU khi renderer
     * là phần mềm như SwiftShader của headless (GPU 2 Hz so với CPU 9,5 Hz) hay thiếu WebGL; `hands/handDelegate.ts`
     * quyết định, tham số URL `hands=GPU|CPU` ghi đè; worker vẫn tự đổi delegate nếu tạo landmarker lỗi. Thay D-009.
     */
    delegate: 'auto' as 'auto' | 'CPU' | 'GPU',
    /** D-010: nhãn MediaPipe 1.0.1 trùng tay giải phẫu với frame chưa mirror; đảo nếu webcam thật cho ngược. */
    handednessSwap: false,
  },
  freshness: {
    /**
     * D-045: tuổi điểm tay tối đa với GPU delegate (đo: khoảng cách kết quả p95 58 ms + inferMs p95 ổn định dưới 50 ms
     * trên máy mục tiêu); với CPU delegate (10 đến 11 Hz: 98 + 90 ms) dùng pointMaxAgeMsCpu, đặt vào độ nhạy lúc mở app.
     */
    pointMaxAgeMs: 150,
    pointMaxAgeMsCpu: 250,
    /** D-045: tuổi kết quả mặt lúc gate nhận p95 68 ms trên GPU thật, 145 ms trên headless: giữ 250. */
    faceResultMaxAgeMs: 250,
  },
  face: {
    minRoiPx: 64,
    inputSize: 256,
    padGray: 128,
    numFaces: 2,
    targetHz: 12,
    fullFaceMarginRatio: 0.04,
    /** D-008: GPU 14 ms so với CPU 39 ms mỗi ảnh. */
    delegate: 'GPU' as 'CPU' | 'GPU',
  },
  /** CLS-01 (I8): dataset mode chỉ lưu crop vùng mở; nhịp lưu và số mẫu tối đa mỗi phiên; ngưỡng cỡ theo cạnh ngắn px. */
  dataset: {
    rateHz: 2,
    maxSamples: 300,
    sizeSmallPx: 160,
    sizeLargePx: 320,
  },
  classifier: {
    targetHz: 4,
    unknownThreshold: 0.7,
    minRoiPx: 96,
    /**
     * D-013: webgpu trước, wasm dự phòng; model export input cố định. QA-02: với model stub, wasm 4,7 ms nhanh hơn
     * webgpu 19,6 ms (chi phí điều phối GPU trội) nhưng cả hai xa dưới nhịp 250 ms; S6 với MobileNetV2 thì webgpu
     * nhanh gấp ba, nên giữ thứ tự và đo lại khi có model thật (`ep=wasm` để so).
     */
    executionProviders: ['webgpu', 'wasm'] as ('webgpu' | 'wasm')[],
    inputSize: 128,
    /** Thứ tự đầu ra của model (softmax trên logits). */
    labels: ['person', 'mannequin'] as ('person' | 'mannequin')[],
    /**
     * CLS-02 (D-044): model stub sinh bởi tools/make-stub-classifier.mjs cho tới khi có model huấn luyện
     * (tools/train, export ra /models/classifier.onnx rồi đổi đường dẫn ở đây).
     */
    modelPath: '/models/classifier-stub.onnx',
    /** D-013: loader ORT theo môi trường như MediaPipe; build tĩnh copy bằng models:fetch. */
    ortPathsDev: '/node_modules/onnxruntime-web/dist/',
    ortPathsProd: '/models/ort/',
    /** Chuẩn hóa (x / 255 − mean) / std, cùng giá trị trong script huấn luyện. */
    norm: { mean: 0.45, std: 0.225 },
    /** Tuổi tối đa của kết quả phân loại lúc về (đo p95 37 đến 59 ms; giữ 600 để dư cho máy chậm, D-045). */
    resultMaxAgeMs: 600,
    /** Nhãn giữ trên mặt tối đa chừng này kể từ kết quả gần nhất cùng epoch (≥ 2 × khoảng cách p95 272 ms, D-045). */
    labelMaxAgeMs: 1500,
    /** Mặt partial mà phần landmark còn trong vùng mở dưới mức này thì unknown. */
    partialMinVisible: 0.6,
  },
  /**
   * BRAND-01 (D-056, D-057, D-058): logo chiến dịch (ảnh gốc) khảm vào màn che (core/brandLogo.ts, mask/logoLayer.ts).
   * Logo đặt lên lưới bảng theo module k ô (21 k × 8 k ô, viền ba khung trùng vạch ô) với k cho bề rộng gần widthRatio ×
   * stage nhất; lưới quá thô (21 k ô vượt snapMaxWidthRatio × stage) thì cỡ cố định theo stage, không khớp ô. Ô đang mở
   * hiện camera thay cho phần logo ở ô đó. `enabled` là mặc định của công tắc "Logo trên màn che" (ui.logo, ?logo=0|1).
   */
  brand: {
    logo: {
      enabled: true,
      widthRatio: 0.3,
      maxHeightRatio: 0.6,
      marginRatio: 0.025,
      anchor: 'top-left' as 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center',
      snapMaxWidthRatio: 0.5,
      /** Dòng "AI ETHIC CAMPAIGN" trong SVG gốc là chữ sống font Heavitas; máy không có font thì dùng dự phòng. */
      fonts: "Heavitas, 'Arial Black', 'Segoe UI Black', sans-serif",
      /** Bề rộng dòng chữ trong đơn vị viewBox (bản xuất raster: x 330 → 598); font dự phòng bị ép vào bề rộng này. */
      textLength: 268,
    },
  },
} as const

export type Defaults = typeof DEFAULTS

/**
 * CLS-02 (D-044), rà soát 2026-09-20: model phân loại đang là stub theo màu (tools/make-stub-classifier.mjs) chứ chưa
 * phải model huấn luyện; nhãn trên trang public phải nói rõ điều đó. Suy từ đường dẫn model để không cần cờ riêng phải
 * nhớ đổi: trỏ modelPath tới classifier.onnx thật là hết chữ "demo".
 */
export function isDemoClassifier(modelPath: string = DEFAULTS.classifier.modelPath): boolean {
  return /classifier-stub\.onnx$/.test(modelPath)
}

/**
 * REL-01 (D-050): ghép gốc đường dẫn của trang (Vite `base`, biến build `VITE_BASE`) vào một đường dẫn tuyệt đối từ
 * gốc site. `DEFAULTS` giữ dạng `/models/...` (phụ lục 9.1); chỉ nơi tiêu thụ mới ghép base, nên unit test và dev
 * (base `/`) không đổi. Không nhân đôi dấu gạch: withBase('/models/x', '/repo/') = '/repo/models/x'.
 */
export function withBase(path: string, base: string = import.meta.env.BASE_URL): string {
  const b = base.endsWith('/') ? base : base + '/'
  return b + path.replace(/^\/+/, '')
}

/** Đường dẫn model, wasm và loader theo môi trường (dev: node_modules; build: public/models) đã ghép base. */
export function modelUrls(
  base: string = import.meta.env.BASE_URL,
  dev: boolean = import.meta.env.DEV,
) {
  const mp = DEFAULTS.mediapipe
  const c = DEFAULTS.classifier
  return {
    wasmBase: withBase(dev ? mp.wasmBaseDev : mp.wasmBaseProd, base),
    handModel: withBase(mp.handModel, base),
    faceModel: withBase(mp.faceModel, base),
    classifierModel: withBase(c.modelPath, base),
    ortPaths: withBase(dev ? c.ortPathsDev : c.ortPathsProd, base),
  }
}

/**
 * Danh sách file mà mọi phiên đều nạp, để service worker (public/sw.js) cache ngay lần mở đầu sau khi nó kích hoạt
 * (D-050: không precache lúc install; app nạp thật rồi mới báo). Loader MediaPipe theo FilesetResolver với
 * useModuleLoader và SIMD: `vision_wasm_module_internal.{js,wasm}`. Loader ORT không nằm đây vì tùy máy (asyncify khi
 * có WebGPU, jsep khi wasm) và được cache khi worker phân loại nạp thật.
 */
export function modelWarmList(base: string = import.meta.env.BASE_URL): string[] {
  const u = modelUrls(base, false)
  return [
    `${u.wasmBase}/vision_wasm_module_internal.js`,
    `${u.wasmBase}/vision_wasm_module_internal.wasm`,
    u.handModel,
    u.faceModel,
    u.classifierModel,
  ]
}
