// QA-02: đọc môi trường trình duyệt cho ma trận thiết bị (docs/benchmark.md): trình duyệt, số luồng, WebGL renderer,
// và các API app dựa vào kèm fallback của từng cái (envText.ts ghi fallback ở từng trường). Chỉ đọc trong trang,
// không gửi đi đâu (I9). window.__wct.env cho bench (tests/bench) và dòng env-stat của panel debug; người kiểm
// Firefox hay Safari thủ công đọc cùng dòng này.
import { browserFromUa, type EnvSnapshot, type GpuAdapterInfo } from './envText'
import { wct } from './wctGlobal'

export { describeEnv, missingFeatures, shortGpu } from './envText'
export type { EnvFeatures, EnvSnapshot, GpuAdapterInfo } from './envText'

// wasm-feature-detect: module SIMD tối thiểu (i8x16.splat + v128.any_true... dạng byte chuẩn của bộ kiểm).
const WASM_SIMD = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15,
  253, 98, 11,
])

function detectModuleWorker(): boolean {
  let supports = false
  try {
    const url = URL.createObjectURL(new Blob([''], { type: 'text/javascript' }))
    const opts = {
      get type() {
        supports = true
        return 'module' as const
      },
    }
    try {
      new Worker(url, opts).terminate()
    } finally {
      URL.revokeObjectURL(url)
    }
  } catch {
    // Không tạo được worker (CSP, môi trường lạ): supports vẫn đúng nếu options đã được đọc.
  }
  return supports
}

/** Renderer WebGL (UNMASKED_RENDERER_WEBGL); StagePage dùng để quyết delegate tay (D-045). */
export function readWebgl(): string | null {
  try {
    const c = document.createElement('canvas')
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null
    if (!gl) return null
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    const v = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
    return typeof v === 'string' ? v : null
  } catch {
    return null
  }
}

type NavExtra = Navigator & {
  deviceMemory?: number
  gpu?: {
    requestAdapter(): Promise<{
      info?: { vendor?: string; architecture?: string; description?: string }
    } | null>
  }
}
type WindowExtra = Window & { showDirectoryPicker?: unknown }

export function readEnv(): EnvSnapshot {
  const nav = navigator as NavExtra
  const win = window as WindowExtra
  const ua = nav.userAgent
  return {
    ua,
    browser: browserFromUa(ua),
    platform: nav.platform,
    threads: nav.hardwareConcurrency ?? 0,
    deviceMemoryGB: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    dpr: window.devicePixelRatio,
    secureContext: window.isSecureContext,
    crossOriginIsolated: window.crossOriginIsolated,
    webgl: readWebgl(),
    features: {
      rvfc: typeof HTMLVideoElement.prototype.requestVideoFrameCallback === 'function',
      offscreenCanvas: (() => {
        try {
          return (
            typeof OffscreenCanvas === 'function' && !!new OffscreenCanvas(1, 1).getContext('2d')
          )
        } catch {
          return false
        }
      })(),
      moduleWorker: detectModuleWorker(),
      imageBitmap: typeof createImageBitmap === 'function' && typeof ImageBitmap === 'function',
      webgpu: !!nav.gpu,
      wasmSimd: (() => {
        try {
          return WebAssembly.validate(WASM_SIMD)
        } catch {
          return false
        }
      })(),
      sharedArrayBuffer: typeof SharedArrayBuffer === 'function',
      fullscreen: !!document.fullscreenEnabled,
      directoryPicker: typeof win.showDirectoryPicker === 'function',
      getUserMedia: typeof nav.mediaDevices?.getUserMedia === 'function',
    },
  }
}

/** Adapter WebGPU (null khi không có navigator.gpu hoặc requestAdapter trả null, như headless shell). */
export async function gpuAdapter(): Promise<GpuAdapterInfo> {
  const nav = navigator as NavExtra
  if (!nav.gpu) return null
  try {
    const a = await nav.gpu.requestAdapter()
    if (!a) return null
    return {
      vendor: a.info?.vendor ?? '',
      architecture: a.info?.architecture ?? '',
      description: a.info?.description ?? '',
    }
  } catch {
    return null
  }
}

export function installEnvProbe(): () => void {
  const g = wct()
  const probe = { snapshot: readEnv, gpuAdapter }
  g.env = probe
  return () => {
    if (g.env === probe) delete g.env
  }
}
