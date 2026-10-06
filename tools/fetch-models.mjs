// SETUP-00: tải model MediaPipe (.task) và copy wasm của @mediapipe/tasks-vision vào public/models.
// Nguồn, phiên bản và sha256 nằm trong public/models/models.json. Chạy lại là idempotent: file đúng sha256 thì bỏ qua.
// Lần đầu, nếu sha256 trong manifest để trống thì script ghi sha256 của file vừa tải vào manifest (pin).
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { syncClassifier } from './classifier-source.mjs'
import { writeStubClassifier } from './make-stub-classifier.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const modelsDir = join(root, 'public', 'models')
const manifestPath = join(modelsDir, 'models.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
let dirty = false

for (const m of manifest.models) {
  const dest = join(modelsDir, m.file)
  if (existsSync(dest)) {
    const have = sha256(readFileSync(dest))
    if (!m.sha256 || have === m.sha256) {
      if (!m.sha256) {
        m.sha256 = have
        dirty = true
      }
      console.log(`ok    ${m.file}`)
      continue
    }
    console.log(`stale ${m.file} (sha256 khác manifest), tải lại`)
  }
  console.log(`get   ${m.file} <- ${m.source}`)
  const res = await fetch(m.source)
  if (!res.ok) throw new Error(`HTTP ${res.status} khi tải ${m.source}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const got = sha256(buf)
  if (m.sha256 && got !== m.sha256) {
    throw new Error(`sha256 không khớp cho ${m.file}: manifest ${m.sha256}, tải về ${got}`)
  }
  if (!m.sha256) {
    m.sha256 = got
    dirty = true
  }
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, buf)
  console.log(
    `done  ${m.file} (${(buf.length / 1e6).toFixed(2)} MB, sha256 ${got.slice(0, 12)}...)`,
  )
}

const pkgPath = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'package.json')
if (!existsSync(pkgPath))
  throw new Error('Chưa cài @mediapipe/tasks-vision; chạy npm install trước')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const wasmSrc = join(dirname(pkgPath), 'wasm')
const wasmDest = join(modelsDir, manifest.wasm.dest)
mkdirSync(wasmDest, { recursive: true })
// REL-01 (D-050): manifest liệt kê file cần (loader module + SIMD); không liệt kê thì copy cả thư mục như trước.
const files = manifest.wasm.files ?? readdirSync(wasmSrc)
for (const f of files) copyFileSync(join(wasmSrc, f), join(wasmDest, f))
for (const f of readdirSync(wasmDest))
  if (!files.includes(f)) {
    rmSync(join(wasmDest, f))
    console.log(`xóa  ${f} (không còn trong manifest)`)
  }
if (manifest.wasm.version !== pkg.version) {
  manifest.wasm.version = pkg.version
  dirty = true
}
console.log(
  `wasm  ${files.length} file từ @mediapipe/tasks-vision@${pkg.version} -> public/models/${manifest.wasm.dest}`,
)

if (dirty) {
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  console.log('models.json đã cập nhật sha256 và phiên bản wasm')
}

// CLS-02: loader wasm của onnxruntime-web cho build tĩnh (D-013) và model stub khi chưa có model huấn luyện (D-044).
if (manifest.ort) {
  const ortPkg = JSON.parse(
    readFileSync(join(root, 'node_modules', manifest.ort.package, 'package.json'), 'utf8'),
  )
  const ortSrc = join(root, 'node_modules', manifest.ort.package, 'dist')
  const ortDest = join(modelsDir, manifest.ort.dest)
  mkdirSync(ortDest, { recursive: true })
  for (const f of manifest.ort.files) copyFileSync(join(ortSrc, f), join(ortDest, f))
  for (const f of readdirSync(ortDest))
    if (!manifest.ort.files.includes(f)) {
      rmSync(join(ortDest, f))
      console.log(`xóa  ${manifest.ort.dest}${f} (không còn trong manifest)`)
    }
  if (manifest.ort.version !== ortPkg.version) {
    manifest.ort.version = ortPkg.version
    dirty = true
  }
  console.log(
    `ort   ${manifest.ort.files.length} file từ ${manifest.ort.package}@${ortPkg.version} -> public/models/${manifest.ort.dest}`,
  )
}
if (manifest.classifier?.stub) {
  const dest = join(modelsDir, manifest.classifier.stub)
  const n = writeStubClassifier(dest)
  console.log(
    `stub  ${manifest.classifier.stub} (${n} byte, sinh bởi tools/make-stub-classifier.mjs)`,
  )
}
// CLS-03 (D-061): model huấn luyện (tools/train/export_onnx.py --manifest ghi sha256), không commit; vite.config.ts
// (resolveClassifier) chỉ dùng nó khi sha256 khớp. REL-02 (D-068): có `source` (nhánh `models`, npm run models:publish)
// thì tải khi máy chưa có file và đối chiếu sha256, để CI build trang public với model này. File cục bộ lệch sha256
// được giữ nguyên, không bị ghi đè (trước REL-02 nó bị ghi đè khi có source): đó có thể là model vừa train.
await syncClassifier({ cls: manifest.classifier, modelsDir })
if (dirty) writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
