// QA-02: phần thuần của probe môi trường (không đụng DOM, không khai báo global): kiểu snapshot, tên trình duyệt từ UA,
// rút gọn tên GPU, tính năng thiếu và dòng mô tả. envProbe.ts đọc trình duyệt và cài window.__wct.env; bench
// (tests/bench) và unit test dùng file này.
export type EnvFeatures = {
  /** HTMLVideoElement.requestVideoFrameCallback; thiếu thì CameraSource dùng rAF (CAM-01). */
  rvfc: boolean
  /** OffscreenCanvas + 2d (worker warm-up, letterbox, classifier, PNG dataset). Bắt buộc. */
  offscreenCanvas: boolean
  /** new Worker(url, { type: 'module' }) (D-008). Bắt buộc. */
  moduleWorker: boolean
  /** createImageBitmap và transfer ImageBitmap (I1). Bắt buộc. */
  imageBitmap: boolean
  /** navigator.gpu (secure context); có adapter hay không hỏi bằng gpuAdapter(). Thiếu thì ORT dùng wasm (D-013). */
  webgpu: boolean
  /** wasm SIMD (MediaPipe và ORT cần). Bắt buộc. */
  wasmSimd: boolean
  /** Không cần (wasm đơn luồng, D-013), ghi để biết COOP/COEP. */
  sharedArrayBuffer: boolean
  /** document.fullscreenEnabled; thiếu thì nút Toàn màn hình ẩn (UX-01). */
  fullscreen: boolean
  /** showDirectoryPicker (Chromium); thiếu thì dataset mode tải zip (CLS-01). */
  directoryPicker: boolean
  /** navigator.mediaDevices.getUserMedia. Bắt buộc với camera thật. */
  getUserMedia: boolean
}

export type EnvSnapshot = {
  ua: string
  browser: { name: string; version: string }
  platform: string
  threads: number
  deviceMemoryGB: number | null
  dpr: number
  secureContext: boolean
  crossOriginIsolated: boolean
  /** UNMASKED_RENDERER_WEBGL (hay RENDERER) của WebGL2/WebGL; null khi không tạo được context. */
  webgl: string | null
  features: EnvFeatures
}

export type GpuAdapterInfo = {
  vendor: string
  architecture: string
  description: string
} | null

/** Tên và phiên bản chính từ UA (Edge trước Chrome vì UA của Edge chứa cả hai). */
export function browserFromUa(ua: string): { name: string; version: string } {
  const pick = (re: RegExp) => re.exec(ua)?.[1] ?? ''
  if (/Edg\//.test(ua)) return { name: 'Edge', version: pick(/Edg\/(\d+)/) }
  if (/OPR\//.test(ua)) return { name: 'Opera', version: pick(/OPR\/(\d+)/) }
  if (/Firefox\//.test(ua)) return { name: 'Firefox', version: pick(/Firefox\/(\d+)/) }
  if (/HeadlessChrome\//.test(ua))
    return { name: 'Chrome headless', version: pick(/HeadlessChrome\/(\d+)/) }
  if (/Chrome\//.test(ua)) return { name: 'Chrome', version: pick(/Chrome\/(\d+)/) }
  if (/Safari\//.test(ua) && /Version\//.test(ua))
    return { name: 'Safari', version: pick(/Version\/(\d+)/) }
  return { name: 'khác', version: '' }
}

/** Rút gọn chuỗi renderer của ANGLE: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 (0x…) Direct3D11 …)" → tên GPU. */
export function shortGpu(renderer: string | null): string {
  if (!renderer) return 'không có WebGL'
  if (/SwiftShader/i.test(renderer)) return 'SwiftShader (CPU)'
  let s = renderer
  const m = /^ANGLE \(([^,]+), (.*)\)$/.exec(s)
  if (m) s = m[2]
  s = s
    .replace(/ \(0x[0-9A-Fa-f]+\)/g, '')
    .replace(/ Direct3D\d+.*$/, '')
    .trim()
  return s.length > 60 ? `${s.slice(0, 57)}…` : s
}

const FEATURE_TEXT: Record<keyof EnvFeatures, string> = {
  rvfc: 'rVFC',
  offscreenCanvas: 'OffscreenCanvas',
  moduleWorker: 'module worker',
  imageBitmap: 'ImageBitmap',
  webgpu: 'WebGPU',
  wasmSimd: 'wasm SIMD',
  sharedArrayBuffer: 'SharedArrayBuffer',
  fullscreen: 'toàn màn hình',
  directoryPicker: 'chọn thư mục',
  getUserMedia: 'getUserMedia',
}

/** Bắt buộc với app (không có fallback trong mã). */
export const REQUIRED_FEATURES: (keyof EnvFeatures)[] = [
  'moduleWorker',
  'offscreenCanvas',
  'imageBitmap',
  'wasmSimd',
]

/** Các tính năng thiếu, theo thứ tự khai báo (rỗng khi đủ). */
export function missingFeatures(f: EnvFeatures): string[] {
  return (Object.keys(FEATURE_TEXT) as (keyof EnvFeatures)[])
    .filter((k) => !f[k])
    .map((k) => FEATURE_TEXT[k])
}

/** Dòng debug: trình duyệt, luồng, GPU WebGL, tính năng thiếu. */
export function describeEnv(s: EnvSnapshot): string {
  const missing = missingFeatures(s.features)
  return (
    `môi trường: ${s.browser.name} ${s.browser.version} · ${s.platform || '?'} · ${s.threads} luồng` +
    ` · WebGL ${shortGpu(s.webgl)}` +
    (missing.length ? ` · thiếu: ${missing.join(', ')}` : ' · đủ API')
  )
}
