// REL-01: tải lại asset spike (public/spike-assets/, không commit) cho e2e cục bộ và các trang spike S1 đến S6:
// ảnh mẫu công khai của MediaPipe (bucket mediapipe-assets, cùng nguồn với test data của MediaPipe) và model
// MobileNetV2 mẫu của ONNX model zoo (chỉ S6). Idempotent: file đúng sha256 thì bỏ qua; sha256 pin ở đây theo lần tải
// 2026-09-20 (face.png 1 094 717 byte, hands.jpg 67 719 byte đúng bằng bản đã dùng từ SPIKE-00). WebM cho S4, S5 tạo
// bằng `node tools/spikes/make-webm.mjs`. Chạy: `npm run spikes:fetch` (mobilenetv2 chỉ khi thêm `--all`).
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'public', 'spike-assets')
const all = process.argv.includes('--all')
const MP = 'https://storage.googleapis.com/mediapipe-assets/'
const ASSETS = [
  {
    file: 'face.png',
    source: `${MP}business-person.png`,
    sha256: '1f61cf0603cef77ffca4e24848ddf8290b5651d03b957e93b742c9ef963b5c11',
  },
  {
    file: 'hands.jpg',
    source: `${MP}woman_hands.jpg`,
    sha256: '70cbeb38e198c9862202e0979c21a99b40ca980d3e7b250176c85b1636a40f12',
  },
  {
    file: 'thumbs_up.jpg',
    source: `${MP}thumb_up.jpg`,
    sha256: '5d673c081ab13b8a1812269ff57047066f9c33c07db5f4178089e8cb3fdc0291',
  },
  {
    file: 'pointing_up.jpg',
    source: `${MP}pointing_up.jpg`,
    sha256: 'ecf8ca2611d08fa25948a4fc10710af9120e88243a54da6356bacea17ff3e36e',
  },
  {
    file: 'mobilenetv2-12.onnx',
    source:
      'https://github.com/onnx/models/raw/main/validated/vision/classification/mobilenet/model/mobilenetv2-12.onnx',
    sha256: '',
    optional: true,
  },
]
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

mkdirSync(dir, { recursive: true })
for (const a of ASSETS) {
  if (a.optional && !all) {
    console.log(`skip  ${a.file} (chỉ với --all)`)
    continue
  }
  const dest = join(dir, a.file)
  if (existsSync(dest)) {
    const have = sha256(readFileSync(dest))
    if (!a.sha256 || have === a.sha256) {
      console.log(`ok    ${a.file}`)
      continue
    }
    console.log(`stale ${a.file} (sha256 khác), tải lại`)
  }
  console.log(`get   ${a.file} <- ${a.source}`)
  const res = await fetch(a.source, { redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status} khi tải ${a.source}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const got = sha256(buf)
  if (a.sha256 && got !== a.sha256)
    throw new Error(`sha256 không khớp cho ${a.file}: mong ${a.sha256}, tải về ${got}`)
  writeFileSync(dest, buf)
  console.log(
    `done  ${a.file} (${(buf.length / 1e6).toFixed(2)} MB, sha256 ${got.slice(0, 12)}...)`,
  )
}
