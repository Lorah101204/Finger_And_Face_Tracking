import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULTS, modelUrls, modelWarmList, withBase } from '../../src/core/config'
import { resolveBase } from '../../vite.config'

// REL-01 (mục 7.27, D-050): gốc đường dẫn của trang (VITE_BASE) và danh sách file mà build tĩnh phải chứa.
const manifest = JSON.parse(readFileSync(resolve('public/models/models.json'), 'utf8')) as {
  models: { file: string }[]
  wasm: { files: string[]; dest: string }
  ort: { files: string[]; dest: string; package: string }
  classifier: { stub: string }
}

describe('withBase', () => {
  it("base '/' giữ nguyên; base '/repo/' ghép trước; không nhân đôi dấu gạch; base thiếu gạch cuối vẫn đúng", () => {
    expect(withBase('/models/x.task', '/')).toBe('/models/x.task')
    expect(withBase('/models/x.task', '/repo/')).toBe('/repo/models/x.task')
    expect(withBase('models/x.task', '/repo/')).toBe('/repo/models/x.task')
    expect(withBase('//models/x.task', '/repo/')).toBe('/repo/models/x.task')
    expect(withBase('/models/x.task', '/repo')).toBe('/repo/models/x.task')
  })

  it('mặc định là import.meta.env.BASE_URL của Vite (unit và dev: /)', () => {
    expect(withBase('/models/x.task')).toBe('/models/x.task')
  })
})

describe('modelUrls', () => {
  it('build: mọi đường dẫn model, wasm và loader ORT của DEFAULTS đi qua withBase', () => {
    const u = modelUrls('/repo/', false)
    expect(u).toEqual({
      wasmBase: '/repo/models/wasm',
      handModel: '/repo/models/hand_landmarker.task',
      faceModel: '/repo/models/face_landmarker.task',
      classifierModel: '/repo/models/classifier-stub.onnx',
      ortPaths: '/repo/models/ort/',
    })
    expect(u.handModel).toBe(withBase(DEFAULTS.mediapipe.handModel, '/repo/'))
  })

  it('dev: wasm và loader từ node_modules (Vite từ chối import() từ public/), model vẫn từ public/models', () => {
    const u = modelUrls('/', true)
    expect(u.wasmBase).toBe('/node_modules/@mediapipe/tasks-vision/wasm')
    expect(u.ortPaths).toBe('/node_modules/onnxruntime-web/dist/')
    expect(u.handModel).toBe('/models/hand_landmarker.task')
  })

  it('danh sách warm: file MediaPipe module + SIMD, ba model; mọi tên có trong manifest (models:fetch tạo ra chúng)', () => {
    const list = modelWarmList('/repo/')
    expect(list).toEqual([
      '/repo/models/wasm/vision_wasm_module_internal.js',
      '/repo/models/wasm/vision_wasm_module_internal.wasm',
      '/repo/models/hand_landmarker.task',
      '/repo/models/face_landmarker.task',
      '/repo/models/classifier-stub.onnx',
    ])
    const shipped = new Set([
      ...manifest.models.map((m) => `models/${m.file}`),
      ...manifest.wasm.files.map((f) => `models/${manifest.wasm.dest}${f}`),
      `models/${manifest.classifier.stub}`,
    ])
    for (const url of list) expect(shipped.has(url.replace('/repo/', ''))).toBe(true)
  })
})

describe('resolveBase (vite.config.ts)', () => {
  it("trống hay thiếu → '/'; '/repo/' giữ; thiếu gạch đầu hoặc cuối thì lỗi rõ", () => {
    expect(resolveBase(undefined)).toBe('/')
    expect(resolveBase('')).toBe('/')
    expect(resolveBase(' / ')).toBe('/')
    expect(resolveBase('/repo/')).toBe('/repo/')
    expect(resolveBase('/a/b/')).toBe('/a/b/')
    expect(() => resolveBase('repo/')).toThrow(/VITE_BASE/)
    expect(() => resolveBase('/repo')).toThrow(/VITE_BASE/)
    expect(() => resolveBase('//')).toThrow(/VITE_BASE/)
  })
})

describe('loader ORT và wasm MediaPipe trong manifest (models:fetch) khớp với bundle', () => {
  const ortRoot = resolve('node_modules', manifest.ort.package)
  const ortDist = resolve(ortRoot, 'dist')
  const pkg = JSON.parse(readFileSync(resolve(ortRoot, 'package.json'), 'utf8'))
  const CONDITION = 'onnxruntime-web-use-extern-wasm'
  /** Bundle mà Vite chọn cho một entry với condition extern-wasm (vite.config.ts resolve.conditions), đường dẫn tuyệt đối. */
  const bundleFor = (entry: './wasm') =>
    resolve(ortRoot, pkg.exports[entry].import[CONDITION] as string)

  it('PERF-03 (D-062): classifier.worker chỉ nạp entry onnxruntime-web/wasm (không còn bundle mặc định jsep hay webgpu)', () => {
    const src = readFileSync(resolve('src/classify/classifier.worker.ts'), 'utf8')
    const entries = [
      ...new Set([...src.matchAll(/import\('(onnxruntime-web[^']*)'\)/g)].map((m) => m[1])),
    ].sort()
    expect(entries).toEqual(['onnxruntime-web/wasm'])
    // Mã (bỏ dòng chú thích) không còn nhánh WebGPU nào; session tạo với đúng một EP wasm.
    const code = src.replace(/^\s*\/\/.*$/gm, '')
    expect(code).not.toMatch(/webgpu|jsep|asyncify/i)
    expect(code).toContain("executionProviders: ['wasm']")
  })

  it('bundle wasm xin đúng cặp loader thường, manifest có đúng cặp đó (không thừa biến thể 25 MB nào) và file có trong node_modules', () => {
    const wanted = new Set<string>()
    const file = bundleFor('./wasm')
    expect(existsSync(file)).toBe(true)
    const code = readFileSync(file, 'utf8')
    for (const m of code.matchAll(/ort-wasm-simd-threaded[a-z.]*\.mjs/g)) {
      wanted.add(m[0])
      wanted.add(m[0].replace(/\.mjs$/, '.wasm'))
    }
    expect([...wanted].sort()).toEqual([
      'ort-wasm-simd-threaded.mjs',
      'ort-wasm-simd-threaded.wasm',
    ])
    expect([...manifest.ort.files].sort()).toEqual([...wanted].sort())
    for (const f of manifest.ort.files) expect(existsSync(resolve(ortDist, f))).toBe(true)
  })

  it('vite.config.ts: condition extern-wasm đứng trước điều kiện mặc định để không bundle wasm vào dist/assets', async () => {
    const mod = await import('../../vite.config')
    const cfg = mod.default as unknown as (env: { mode: string; command: 'build' }) => {
      resolve: { conditions: string[] }
    }
    const conditions = cfg({ mode: 'production', command: 'build' }).resolve.conditions
    expect(conditions[0]).toBe(CONDITION)
    expect(conditions).toContain('browser')
  })

  it('wasm MediaPipe: manifest chỉ copy loader module + SIMD (useModuleLoader), có trong package', () => {
    expect(DEFAULTS.mediapipe.useModuleLoader).toBe(true)
    expect(manifest.wasm.files).toEqual([
      'vision_wasm_module_internal.js',
      'vision_wasm_module_internal.wasm',
    ])
    for (const f of manifest.wasm.files)
      expect(existsSync(resolve('node_modules/@mediapipe/tasks-vision/wasm', f))).toBe(true)
  })
})
