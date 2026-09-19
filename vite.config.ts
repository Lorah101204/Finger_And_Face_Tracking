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
  return {
    base: resolveBase(env.VITE_BASE),
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
