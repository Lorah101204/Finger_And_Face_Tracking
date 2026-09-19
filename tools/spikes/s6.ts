// S6: ONNX Runtime Web với model MobileNetV2 mẫu (model zoo, mobilenetv2-12.onnx): wasm và webgpu, latency ảnh 128 và 224 px.
import * as ort from 'onnxruntime-web'
import { log, report, setStatus, stats } from './lib'

// Vite dev không cho import() file trong public/ (ORT nạp loader .mjs bằng import()), nên khi dev trỏ vào node_modules
// (được phục vụ qua pipeline module của Vite). Khi build tĩnh, file copy sẵn trong public/ dùng được trực tiếp.
const WASM_PATHS = import.meta.env.DEV ? '/node_modules/onnxruntime-web/dist/' : '/spike-assets/ort/'
ort.env.wasm.wasmPaths = WASM_PATHS
const MODEL = '/spike-assets/mobilenetv2-12.onnx'

const results: Record<string, unknown> = {
  spike: 'S6',
  ortVersions: (ort.env as unknown as { versions?: unknown }).versions ?? null,
  hardwareConcurrency: navigator.hardwareConcurrency,
  crossOriginIsolated: globalThis.crossOriginIsolated,
  hasWebGPU: 'gpu' in navigator,
}
report(results, false)

type Ort = typeof ort

async function bench(lib: Ort, ep: 'wasm' | 'webgpu', size: number, n = 30) {
  const out: Record<string, unknown> = {}
  try {
    const t0 = performance.now()
    const session = await lib.InferenceSession.create(MODEL, { executionProviders: [ep] })
    out.initMs = Math.round(performance.now() - t0)
    out.inputNames = session.inputNames
    const name = session.inputNames[0]
    const data = new Float32Array(3 * size * size)
    for (let i = 0; i < data.length; i++) data[i] = Math.random()
    const tensor = new lib.Tensor('float32', data, [1, 3, size, size])
    const tw = performance.now()
    await session.run({ [name]: tensor })
    out.firstRunMs = Math.round(performance.now() - tw)
    const ms: number[] = []
    for (let i = 0; i < n; i++) {
      const t = performance.now()
      await session.run({ [name]: tensor })
      ms.push(performance.now() - t)
    }
    out.run = stats(ms)
    await session.release()
    log(`${ep} ${size}px: init ${out.initMs} ms, first run ${out.firstRunMs} ms, run p50 ${stats(ms).p50} p95 ${stats(ms).p95} ms`)
  } catch (err) {
    out.error = String(err)
    log(`${ep} ${size}px: LỖI ${String(err)}`)
  }
  return out
}

for (const size of [128, 224]) {
  setStatus(`wasm ${size}`)
  results[`wasm_${size}`] = await bench(ort, 'wasm', size)
}
if ('gpu' in navigator) {
  let gpuLib: Ort = ort
  for (const size of [128, 224]) {
    setStatus(`webgpu ${size}`)
    let r = await bench(gpuLib, 'webgpu', size)
    if (r.error && gpuLib === ort) {
      try {
        gpuLib = (await import('onnxruntime-web/webgpu')) as unknown as Ort
        gpuLib.env.wasm.wasmPaths = WASM_PATHS
        results.webgpuEntry = 'onnxruntime-web/webgpu'
        r = await bench(gpuLib, 'webgpu', size)
      } catch (err) {
        r.fallbackError = String(err)
      }
    }
    results[`webgpu_${size}`] = r
  }
} else {
  results.webgpu = 'navigator.gpu không có'
}
setStatus('xong')
report(results)
