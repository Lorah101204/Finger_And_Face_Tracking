/// <reference types="vitest/config" />
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defaultClientConditions, defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// SETUP-00. HTTPS chỉ khi VITE_HTTPS=1 (thử trên LAN); localhost đã là secure context cho getUserMedia.
const useHttps = process.env.VITE_HTTPS === '1'

/**
 * REL-01 (D-050): gốc đường dẫn của trang từ biến build VITE_BASE (phụ lục 9.3): '/' mặc định, '/<repo>/' khi trang
 * ở https://<user>.github.io/<repo>/. Phải bắt đầu và kết thúc bằng '/' để withBase() (core/config.ts) và scope của
 * service worker khớp nhau.
 */
export function resolveBase(raw: string | undefined): string {
  const base = raw?.trim() || '/'
  if (!/^\/([^/].*\/)?$/.test(base)) {
    throw new Error(
      `VITE_BASE phải có dạng '/' hoặc '/ten/' (bắt đầu và kết thúc bằng '/'), nhận '${raw}'`,
    )
  }
  return base
}

const sha12 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex').slice(0, 12)

export type ClassifierChoice = 'stub' | 'model'
export type ClassifierResolution = { choice: ClassifierChoice; reason: string }

/**
 * CLS-03 (D-061): model phân loại mà dev server hay build dùng, đưa vào app qua import.meta.env.VITE_WCT_CLASSIFIER.
 * `model` (public/models/<classifier.file>, classifier.onnx) chỉ khi file có mặt và sha256 khớp mục classifier của
 * models.json (tools/train/export_onnx.py --manifest ghi); không thì `stub` (D-044) kèm lý do. File model là sản phẩm
 * huấn luyện, không commit: CI và trang public chưa có nó (trừ khi models:fetch tải từ `source`) nên vẫn chạy stub.
 * Vitest (mode test) luôn stub để unit test tất định. WCT_CLASSIFIER=stub|model ép một bên; ép model mà thiếu file hay
 * sha256 lệch thì lỗi (không lặng lẽ quay về stub).
 */
export function resolveClassifier(opts: {
  mode: string
  force?: string
  manifest: { classifier?: { file?: string; sha256?: string } }
  readModel: (file: string) => Buffer | null
}): ClassifierResolution {
  const force = opts.force?.trim() || undefined
  if (force && force !== 'stub' && force !== 'model')
    throw new Error(`WCT_CLASSIFIER phải là 'stub' hoặc 'model', nhận '${opts.force}'`)
  if (force === 'stub') return { choice: 'stub', reason: 'WCT_CLASSIFIER=stub' }
  if (opts.mode === 'test' && !force) return { choice: 'stub', reason: 'vitest' }
  const c = opts.manifest.classifier ?? {}
  const miss = (reason: string): ClassifierResolution => {
    if (force === 'model') throw new Error(`WCT_CLASSIFIER=model nhưng ${reason}`)
    return { choice: 'stub', reason }
  }
  if (!c.file) return miss('models.json không có classifier.file')
  const buf = opts.readModel(c.file)
  if (!buf) return miss(`chưa có public/models/${c.file} (tools/train/export_onnx.py)`)
  if (!c.sha256) return miss(`models.json chưa có sha256 của ${c.file} (export_onnx.py --manifest)`)
  const have = createHash('sha256').update(buf).digest('hex')
  if (have !== c.sha256)
    return miss(
      `sha256 của ${c.file} ${have.slice(0, 12)} khác models.json ${c.sha256.slice(0, 12)}`,
    )
  return {
    choice: 'model',
    reason: `${c.file} ${(buf.length / 1e6).toFixed(1)} MB, sha256 ${have.slice(0, 12)}`,
  }
}

function dirSize(dir: string): { bytes: number; largest: { file: string; bytes: number } } {
  let bytes = 0
  let largest = { file: '', bytes: 0 }
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) {
      const sub = dirSize(p)
      bytes += sub.bytes
      if (sub.largest.bytes > largest.bytes) largest = sub.largest
    } else {
      bytes += st.size
      if (st.size > largest.bytes) largest = { file: p, bytes: st.size }
    }
  }
  return { bytes, largest }
}

/**
 * REL-01 (D-050) bước "dọn build" và service worker, chạy ở closeBundle (sau khi Vite đã copy public/):
 * - xóa dist/spike-assets (ảnh mẫu, model spike 114 MB chỉ cho dev và e2e cục bộ; R-06a của REVIEW-ROI-01);
 * - thay hai khóa trong dist/sw.js: MODELS_KEY theo sha256 của public/models/models.json, BUILD_ID theo danh sách
 *   file đã hash trong dist/assets (tất định theo nội dung build);
 * - in dung lượng dist/ và file lớn nhất (CI đọc từ log).
 */
function wctBuild(): Plugin {
  let outDir = 'dist'
  let root = process.cwd()
  return {
    name: 'wct-build',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
      root = config.root
    },
    closeBundle() {
      const dist = join(root, outDir)
      if (!existsSync(join(dist, 'index.html'))) return // build của worker hay môi trường khác
      rmSync(join(dist, 'spike-assets'), { recursive: true, force: true })
      const swPath = join(dist, 'sw.js')
      if (existsSync(swPath)) {
        const manifest = readFileSync(join(root, 'public', 'models', 'models.json'))
        const assets = existsSync(join(dist, 'assets'))
          ? readdirSync(join(dist, 'assets')).sort()
          : []
        const sw = readFileSync(swPath, 'utf8')
          .replace('__WCT_MODELS_KEY__', sha12(manifest))
          .replace('__WCT_BUILD_ID__', sha12(assets.join('\n')))
        writeFileSync(swPath, sw)
      }
      const { bytes, largest } = dirSize(dist)
      const mb = (n: number) => (n / 1e6).toFixed(1)
      console.log(
        `wct-build: ${outDir}/ ${mb(bytes)} MB, file lớn nhất ${largest.file.slice(dist.length + 1).replace(/\\/g, '/')} ${mb(largest.bytes)} MB`,
      )
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const modelsDir = join(process.cwd(), 'public', 'models')
  const classifier = resolveClassifier({
    mode,
    force: process.env.WCT_CLASSIFIER,
    manifest: JSON.parse(readFileSync(join(modelsDir, 'models.json'), 'utf8')),
    readModel: (file) =>
      existsSync(join(modelsDir, file)) ? readFileSync(join(modelsDir, file)) : null,
  })
  if (mode !== 'test') console.log(`wct-classifier: ${classifier.choice} (${classifier.reason})`)
  return {
    base: resolveBase(env.VITE_BASE),
    // CLS-03 (D-061): core/config.ts chọn đường dẫn model theo giá trị này.
    define: { 'import.meta.env.VITE_WCT_CLASSIFIER': JSON.stringify(classifier.choice) },
    plugins: [react(), wctBuild(), ...(useHttps ? [basicSsl()] : [])],
    // D-019: ứng dụng tĩnh thuần client, không có proxy /api.
    server: { port: 5173 },
    worker: { format: 'es' },
    resolve: {
      // REL-01 (D-050): onnxruntime-web có export condition riêng cho biến thể không bundle wasm (ort.min.mjs,
      // ort.webgpu.min.mjs): loader và wasm nạp từ env.wasm.wasmPaths (models:fetch copy vào public/models/ort/) thay vì
      // bundle thêm 55 MB wasm trùng vào dist/assets. Cặp file cần theo bundle nằm trong models.json (unit test đối chiếu).
      conditions: ['onnxruntime-web-use-extern-wasm', ...defaultClientConditions],
    },
    test: {
      include: ['tests/unit/**/*.test.ts'],
      environment: 'node',
    },
  }
})
