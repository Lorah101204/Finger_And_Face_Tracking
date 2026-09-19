// Kiểm bất biến I2, I4, I9 và I10 bằng grep (WEB-00, CAM-01, MASK-01; D-025, D-028). Chạy: npm run check:invariants.
// - getUserMedia( chỉ được xuất hiện ở src/camera/cameraSource.ts, và this.#gate() phải đứng trước nó.
// - src/ không có fetch(, sendBeacon, WebSocket, XMLHttpRequest, EventSource: không có gì rời trình duyệt.
// - drawImage( chỉ ở src/mask/compositor.ts (lên output, trong stageRect) và src/mask/restrictedFrame.ts (crop cho
//   worker), và luôn có rect nguồn (9 tham số): không có đường nào vẽ frame camera toàn khung (I2, I4).
// - src/mask/restrictedFrame.ts không đụng DOM (document, querySelector, getElementById, HTMLCanvasElement) và crop
//   từ source.drawable: nguồn buffer là FrameSource, không bao giờ là canvas output (I1, I3; D-030).
// - createImageBitmap( (bitmap frame gốc toàn khung) chỉ ở src/hands/handClient.ts: đường frame gốc tới worker chỉ có
//   một và chỉ tới hand.worker (I1; D-009, D-033). face/ và classify/ nhận ImageBitmap qua transferToImageBitmap của
//   restrictedFrame.ts.
// - REL-01 (D-050): mọi worker (src/**/*.worker.ts) và src/main.tsx gọi installSameOriginGuard( (core/networkGuard.ts)
//   để fetch của thư viện thứ ba (telemetry MediaPipe) không rời origin (I9); public/sw.js chặn lần nữa khi kích hoạt.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const GUM_FILE = 'src/camera/cameraSource.ts'
const RF_FILE = 'src/mask/restrictedFrame.ts'
const BITMAP_FILE = 'src/hands/handClient.ts'
const RF_FORBIDDEN = [/\bdocument\b/, /querySelector/, /getElementById/, /HTMLCanvasElement/]
// syntheticCameraSource vẽ VÀO canvas camera tổng hợp (nó là camera), không phải lên output.
// CLS-02: classifier.worker vẽ bitmap của RestrictedFrame về cạnh input của model trên canvas riêng trong worker; worker
// không có đường nào tới video hay canvas output (lint:boundaries) nên nguồn drawImage chỉ có thể là buffer giới hạn.
const DRAW_FILES = new Set([
  'src/mask/compositor.ts',
  'src/mask/restrictedFrame.ts',
  'src/camera/syntheticCameraSource.ts',
  'src/classify/classifier.worker.ts',
])
const NETWORK = [
  [/\bfetch\s*\(/, 'fetch('],
  [/\bsendBeacon\b/, 'sendBeacon'],
  [/\bWebSocket\b/, 'WebSocket'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
  [/\bEventSource\b/, 'EventSource'],
]

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

/** Bỏ các dòng chỉ là chú thích để không bắt nhầm ghi chú nhắc tới tên hàm. */
function codeOnly(text) {
  return text
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
    .join('\n')
}

/** Số tham số của lời gọi bắt đầu tại dấu ( ở vị trí open: đếm dấu phẩy ở độ sâu 1, bỏ dấu phẩy cuối (Prettier). */
function argCount(code, open) {
  let depth = 0
  let commas = 0
  let trailing = false
  for (let i = open; i < code.length; i++) {
    const ch = code[i]
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth--
      if (depth === 0) return commas + (trailing ? 0 : 1)
    } else if (ch === ',' && depth === 1) commas++
    if (depth === 1 && ch.trim() !== '') trailing = ch === ','
  }
  return commas + 1
}

const errors = []
const files = walk(SRC)
for (const f of files) {
  const rel = relative(ROOT, f).replace(/\\/g, '/')
  const code = codeOnly(readFileSync(f, 'utf8'))
  const draw = /drawImage\s*\(/g
  let m
  while ((m = draw.exec(code))) {
    if (!DRAW_FILES.has(rel)) {
      errors.push(`${rel}: drawImage ngoài ${[...DRAW_FILES].join(', ')} (I2, I4)`)
      break
    }
    const n = argCount(code, m.index + m[0].length - 1)
    if (n !== 9)
      errors.push(`${rel}: drawImage có ${n} tham số, phải là 9 (rect nguồn = cameraRect) (I2, I4)`)
  }
  if (/getUserMedia\s*\(/.test(code) && rel !== GUM_FILE)
    errors.push(`${rel}: gọi getUserMedia ngoài ${GUM_FILE} (I10)`)
  if (/\bcreateImageBitmap\s*\(/.test(code) && rel !== BITMAP_FILE)
    errors.push(
      `${rel}: gọi createImageBitmap ngoài ${BITMAP_FILE} (frame gốc chỉ tới hand.worker, I1)`,
    )
  for (const [re, label] of NETWORK) if (re.test(code)) errors.push(`${rel}: có ${label} (I9)`)
  if (
    (/\.worker\.ts$/.test(rel) || rel === 'src/main.tsx') &&
    !/\binstallSameOriginGuard\s*\(/.test(code)
  )
    errors.push(
      `${rel}: không gọi installSameOriginGuard( (fetch khác origin của thư viện phải bị chặn, I9)`,
    )
}
const cam = codeOnly(readFileSync(join(ROOT, GUM_FILE), 'utf8'))
const gateIdx = cam.indexOf('this.#gate()')
const gumIdx = cam.indexOf('getUserMedia(')
if (gumIdx < 0) errors.push(`${GUM_FILE}: không thấy getUserMedia(`)
else if (gateIdx < 0 || gateIdx > gumIdx)
  errors.push(`${GUM_FILE}: this.#gate() phải đứng trước getUserMedia( (I10)`)

const rf = codeOnly(readFileSync(join(ROOT, RF_FILE), 'utf8'))
for (const re of RF_FORBIDDEN)
  if (re.test(rf))
    errors.push(
      `${RF_FILE}: có ${re.source}: nguồn crop phải là FrameSource.drawable, không lấy canvas từ DOM (I1, I3)`,
    )
if (!/\bsource\.drawable\b/.test(rf))
  errors.push(`${RF_FILE}: không thấy source.drawable (nguồn crop phải là FrameSource) (I1, I3)`)
const hc = codeOnly(readFileSync(join(ROOT, BITMAP_FILE), 'utf8'))
if (!/\bcreateImageBitmap\s*\(/.test(hc))
  errors.push(`${BITMAP_FILE}: không thấy createImageBitmap( (frame gốc phải đi qua đây) (I1)`)

if (errors.length) {
  console.error('check-invariants: LỖI')
  for (const e of errors) console.error(' - ' + e)
  process.exit(1)
}
console.log(`check-invariants: ${files.length} file trong src/, OK (I1, I2, I3, I4, I9, I10)`)
