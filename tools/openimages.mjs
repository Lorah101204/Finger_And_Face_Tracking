// CLS-07 (D-072): mẫu person / mannequin từ Open Images V7 khi chưa có người tham gia và hình nộm thật trước camera.
// Ảnh của Open Images do người đăng khai CC BY 2.0 (từng ảnh, ghi trong attribution.csv), annotation CC BY 4.0; ảnh và
// mẫu ở data/ (không commit), không phát tán lại. Các bước:
//
//   node tools/openimages.mjs select   [--person 3000] [--mannequin 0] [--doll 1200] [--seed 1]
//       Đọc data/openimages/index/ (CSV đã lọc, xem README của bước index) và chọn ảnh: mannequin = nhãn cấp ảnh
//       "Mannequin" (/m/01gl_m) do người xác nhận; doll = box "Doll" (/m/0167gd) hay nhãn cấp ảnh; person = box
//       "Human face" (/m/0dzct) không phải nhóm, không phải tranh vẽ hay tượng (IsDepiction 0), rộng ≥ 6 % ảnh, ảnh không
//       xoay (Rotation 0) và không có nhãn Mannequin hay Doll. 0 là lấy hết. Ghi data/openimages/selection.json.
//   node tools/openimages.mjs download [--concurrency 16]
//       Tải ảnh (bản thu nhỏ trên S3 công khai của Open Images) vào data/openimages/images/<subset>/<id>.jpg.
//   node tools/openimages.mjs faces    [--root data/dataset] [--browser chromium|chrome] [--limit N] [--subset train]
//       Chạy Face Landmarker của app (IMAGE, CPU, cùng model) trong Chromium headless trên ảnh letterbox 256 xám 128 như
//       restrictedFrame: quanh mỗi box với box có sẵn, trên cả ảnh và năm ô chồng nhau khi chỉ có nhãn cấp ảnh. Mỗi mặt
//       (bbox landmark ≥ 48 px) thành một mẫu: vùng vuông 2,4 × mặt (thu về ≤ 448 px) với `face` theo gốc vùng, đúng
//       định dạng của dataset mode (SampleMeta) nên tools/train cắt quanh mặt như app (--crop face). Phiên
//       ses-oi-<kind>-<subset>, subjectId oi-<ImageID> (các mặt của một ảnh chung subject, split không rò).
//   node tools/openimages.mjs sheets   [--root data/dataset] [--session ses-oi-mannequin-test] [--split test] [--per 48]
//       Bảng thumbnail đánh số (crop quanh mặt mà classifier thấy) vào data/openimages/sheets/ để kiểm nhãn bằng mắt.
//   node tools/openimages.mjs reject   <sample-id> ...  (hay --file ids.txt) [--as unknown|person|mannequin|background]
//       Ghi labelFinal cho mẫu nhận sai (mặc định unknown: split.py và train bỏ qua).
//   node tools/openimages.mjs attribute [--root data/dataset]
//       Bổ sung oi.license, oi.author, oi.landing cho mẫu còn thiếu từ metadata ảnh đã lọc trong index/.
//
// Không thuộc CI; chỉ chạy khi chuẩn bị dữ liệu. Không gửi gì từ app: công cụ Node tải từ Open Images (như
// fetch-models.mjs tải model), app vẫn không gọi mạng (I9).
/* global OffscreenCanvas, createImageBitmap, window */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OI = join(ROOT, 'data', 'openimages')
const INDEX = join(OI, 'index')
const IMAGES = join(OI, 'images')
const SELECTION = join(OI, 'selection.json')
const MID = { mannequin: '/m/01gl_m', doll: '/m/0167gd', face: '/m/0dzct' }
const SUBSET_DIR = { train: 'train', validation: 'validation', test: 'test' }

const argv = process.argv.slice(2)
const cmd = argv.shift()
function opt(name, def) {
  const i = argv.indexOf(`--${name}`)
  if (i < 0) return def
  const v = argv[i + 1]
  argv.splice(i, 2)
  return v
}

/** CSV đơn giản của Open Images: không có dấu phẩy trong ô trừ Title (cột cuối tùy file), nên tách có giới hạn. */
function readCsv(path, onRow) {
  const text = readFileSync(path, 'utf8')
  const lines = text.split(/\r?\n/)
  const header = lines[0].split(',')
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue
    onRow(splitCsv(lines[i]), header)
  }
  return header
}
function splitCsv(line) {
  const out = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (c === '"') q = false
      else cur += c
    } else if (c === '"') q = true
    else if (c === ',') {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out
}

/** RNG xác định (mulberry32) để chọn mẫu lặp lại được theo --seed. */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function shuffle(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function cmdSelect() {
  const cap = {
    person: Number(opt('person', 3000)),
    mannequin: Number(opt('mannequin', 0)),
    doll: Number(opt('doll', 1200)),
  }
  const rand = rng(Number(opt('seed', 1)))
  // Nhãn cấp ảnh dương tính theo ảnh.
  const labels = new Map() // id → { subset, set }
  const addLabels = (file, subset) => {
    if (!existsSync(file)) return
    readCsv(file, (r) => {
      if (r[3] !== '1') return
      let e = labels.get(r[0])
      if (!e) labels.set(r[0], (e = { subset, set: new Set() }))
      e.set.add(r[2])
    })
  }
  addLabels(join(INDEX, 'val-imagelabels.csv'), 'validation')
  addLabels(join(INDEX, 'test-imagelabels.csv'), 'test')
  addLabels(join(INDEX, 'train-mannequin-doll-labels.csv'), 'train')
  // Xoay và metadata (chỉ val, test có sẵn; ảnh train không có box nên hướng ảnh chỉ ảnh hưởng số mặt dò được).
  const rotation = new Map()
  for (const f of ['validation-images.csv', 'test-images.csv']) {
    const p = join(INDEX, f)
    if (!existsSync(p)) continue
    readCsv(p, (r, h) => rotation.set(r[0], Number(r[h.indexOf('Rotation')] || 0)))
  }
  // Box của val, test.
  const boxes = new Map() // id → { subset, face: [], doll: [] }
  for (const [f, subset] of [
    ['validation-face-doll-bbox.csv', 'validation'],
    ['test-face-doll-bbox.csv', 'test'],
  ]) {
    const p = join(INDEX, f)
    if (!existsSync(p)) continue
    readCsv(p, (r) => {
      const [id, , label, , x0, x1, y0, y1, , , group, depiction] = r
      let e = boxes.get(id)
      if (!e) boxes.set(id, (e = { subset, face: [], doll: [], faceAll: 0 }))
      const box = { x0: +x0, x1: +x1, y0: +y0, y1: +y1 }
      if (label === MID.face) {
        e.faceAll++
        if (group === '0' && depiction === '0' && box.x1 - box.x0 >= 0.06) e.face.push(box)
      } else if (label === MID.doll && group === '0') e.doll.push(box)
    })
  }
  const sel = []
  const mannequin = []
  const doll = []
  const person = []
  for (const [id, e] of labels) {
    if (e.set.has(MID.mannequin)) mannequin.push({ id, subset: e.subset, kind: 'mannequin' })
    else if (e.set.has(MID.doll) && !boxes.get(id)?.doll.length)
      doll.push({ id, subset: e.subset, kind: 'doll' })
  }
  for (const [id, e] of boxes) {
    const lab = labels.get(id)?.set
    if (lab?.has(MID.mannequin)) continue
    if (e.doll.length && !(rotation.get(id) ?? 0))
      doll.push({ id, subset: e.subset, kind: 'doll', boxes: e.doll.slice(0, 3) })
    if (lab?.has(MID.doll)) continue
    if (e.face.length && e.faceAll <= 4 && !(rotation.get(id) ?? 0)) {
      const largest = e.face.sort((a, b) => b.x1 - b.x0 - (a.x1 - a.x0)).slice(0, 3)
      person.push({ id, subset: e.subset, kind: 'person', boxes: largest })
    }
  }
  for (const [list, k] of [
    [mannequin, 'mannequin'],
    [doll, 'doll'],
    [person, 'person'],
  ]) {
    shuffle(list, rand)
    sel.push(...(cap[k] > 0 ? list.slice(0, cap[k]) : list))
  }
  writeFileSync(
    SELECTION,
    JSON.stringify({ createdAt: new Date().toISOString(), cap, images: sel }, null, 1),
  )
  const count = (k) => sel.filter((s) => s.kind === k).length
  console.log(
    `chọn ${sel.length} ảnh: mannequin ${count('mannequin')}/${mannequin.length}, doll ${count('doll')}/${doll.length}, person ${count('person')}/${person.length} → ${SELECTION}`,
  )
}

async function cmdDownload() {
  const conc = Number(opt('concurrency', 16))
  const { images } = JSON.parse(readFileSync(SELECTION, 'utf8'))
  let done = 0
  let skipped = 0
  let failed = 0
  let bytes = 0
  const queue = images.slice()
  const worker = async () => {
    for (;;) {
      const im = queue.shift()
      if (!im) return
      const dir = join(IMAGES, SUBSET_DIR[im.subset])
      const out = join(dir, `${im.id}.jpg`)
      if (existsSync(out)) {
        skipped++
        continue
      }
      mkdirSync(dir, { recursive: true })
      const url = `https://open-images-dataset.s3.amazonaws.com/${SUBSET_DIR[im.subset]}/${im.id}.jpg`
      let ok = false
      for (let t = 0; t < 3 && !ok; t++) {
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(60_000) })
          if (res.status === 404 || res.status === 403) break
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const buf = Buffer.from(await res.arrayBuffer())
          writeFileSync(out, buf)
          bytes += buf.length
          ok = true
        } catch {
          await new Promise((r) => setTimeout(r, 1000 * (t + 1)))
        }
      }
      if (ok) done++
      else failed++
      if ((done + failed) % 200 === 0)
        console.log(
          `… ${done + failed + skipped}/${images.length} (${(bytes / 1048576).toFixed(0)} MB)`,
        )
    }
  }
  await Promise.all(Array.from({ length: conc }, worker))
  console.log(
    `tải ${done}, có sẵn ${skipped}, lỗi ${failed} (${(bytes / 1048576).toFixed(0)} MB) → ${IMAGES}`,
  )
}

/** Dev server của chính dự án (model, wasm của MediaPipe từ node_modules cùng origin như app). */
async function withPage(browserName, fn) {
  const { createServer } = await import('vite')
  const { chromium } = await import('playwright')
  const server = await createServer({
    root: ROOT,
    logLevel: 'error',
    server: { port: 5181, strictPort: false, host: '127.0.0.1' },
  })
  await server.listen()
  const base = server.resolvedUrls.local[0].replace(/\/$/, '')
  const browser = await chromium.launch(
    browserName === 'chrome' ? { channel: 'chrome', headless: true } : { headless: true },
  )
  try {
    const page = await browser.newPage()
    page.on('pageerror', (e) => console.error('pageerror', e.message))
    await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 180_000 })
    return await fn(page)
  } finally {
    await browser.close()
    await server.close()
  }
}

/** Mã chạy trong trang: nạp Face Landmarker một lần, rồi window.__oi.run(job) cho từng ảnh. */
async function pageSetup() {
  const mp = await import('/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs')
  const fs = await mp.FilesetResolver.forVisionTasks('/node_modules/@mediapipe/tasks-vision/wasm')
  const lm = await mp.FaceLandmarker.createFromOptions(fs, {
    baseOptions: { modelAssetPath: '/models/face_landmarker.task', delegate: 'CPU' },
    runningMode: 'IMAGE',
    numFaces: 4,
  })
  const SIZE = 256
  const GRAY = 'rgb(128, 128, 128)'
  const lbCanvas = new OffscreenCanvas(SIZE, SIZE)
  const lb = lbCanvas.getContext('2d')
  const jsRound = Math.round
  /** Như faceCropRect của app (classify/faceCrop.ts) với scale tùy ý, bounds là cả ảnh. */
  const squareAround = (f, W, H, scale) => {
    const side = Math.max(1, jsRound(Math.max(f.w, f.h) * scale))
    const axis = (c, b) => {
      const len = Math.min(side, b)
      return [Math.max(0, Math.min(b - len, jsRound(c - len / 2))), len]
    }
    const [x, w] = axis(f.x + f.w / 2, W)
    const [y, h] = axis(f.y + f.h / 2, H)
    return { x, y, w, h }
  }
  const iou = (a, b) => {
    const x0 = Math.max(a.x, b.x)
    const y0 = Math.max(a.y, b.y)
    const x1 = Math.min(a.x + a.w, b.x + b.w)
    const y1 = Math.min(a.y + a.h, b.y + b.h)
    const i = Math.max(0, x1 - x0) * Math.max(0, y1 - y0)
    return i / (a.w * a.h + b.w * b.h - i || 1)
  }
  /** Một view: crop rect của ảnh → letterbox 256 xám như restrictedFrame → landmarker → bbox landmark ở px ảnh. */
  const detectView = (img, v) => {
    const scale = SIZE / Math.max(v.w, v.h)
    const dx = Math.floor((SIZE - v.w * scale) / 2)
    const dy = Math.floor((SIZE - v.h * scale) / 2)
    lb.fillStyle = GRAY
    lb.fillRect(0, 0, SIZE, SIZE)
    lb.drawImage(img, v.x, v.y, v.w, v.h, dx, dy, v.w * scale, v.h * scale)
    const r = lm.detect(lbCanvas)
    return r.faceLandmarks.map((pts) => {
      let x0 = Infinity
      let y0 = Infinity
      let x1 = -Infinity
      let y1 = -Infinity
      for (const p of pts) {
        const x = v.x + (p.x * SIZE - dx) / scale
        const y = v.y + (p.y * SIZE - dy) / scale
        x0 = Math.min(x0, x)
        y0 = Math.min(y0, y)
        x1 = Math.max(x1, x)
        y1 = Math.max(y1, y)
      }
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
    })
  }
  const toB64 = async (canvas) => {
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let s = ''
    for (let i = 0; i < bytes.length; i += 0x8000)
      s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(s)
  }
  window.__oi = {
    async run(job) {
      const res = await fetch(job.url)
      if (!res.ok) return { error: `HTTP ${res.status}` }
      const img = await createImageBitmap(await res.blob())
      const W = img.width
      const H = img.height
      let faces = []
      if (job.boxes && job.boxes.length) {
        for (const b of job.boxes) {
          const box = { x: b.x0 * W, y: b.y0 * H, w: (b.x1 - b.x0) * W, h: (b.y1 - b.y0) * H }
          const view = squareAround(box, W, H, 2.4)
          const cands = detectView(img, view).filter((f) => {
            const cx = f.x + f.w / 2
            const cy = f.y + f.h / 2
            return cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h
          })
          cands.sort((a, b) => iou(b, box) - iou(a, box))
          if (cands[0] && iou(cands[0], box) >= 0.2) faces.push(cands[0])
        }
      } else {
        const tw = Math.round(W * 0.6)
        const th = Math.round(H * 0.6)
        const views = [
          { x: 0, y: 0, w: W, h: H },
          { x: 0, y: 0, w: tw, h: th },
          { x: W - tw, y: 0, w: tw, h: th },
          { x: 0, y: H - th, w: tw, h: th },
          { x: W - tw, y: H - th, w: tw, h: th },
          { x: Math.round((W - tw) / 2), y: Math.round((H - th) / 2), w: tw, h: th },
        ]
        for (const v of views) faces.push(...detectView(img, v))
        // Gộp mặt trùng giữa các view (giữ bbox lớn hơn).
        faces.sort((a, b) => b.w * b.h - a.w * a.h)
        const kept = []
        for (const f of faces) if (!kept.some((k) => iou(k, f) > 0.4)) kept.push(f)
        faces = kept
      }
      faces = faces.filter((f) => Math.min(f.w, f.h) >= job.minFacePx).slice(0, job.maxFaces)
      const crops = []
      for (const f of faces) {
        const region = squareAround(f, W, H, 2.4)
        const s = Math.min(1, job.maxSide / Math.max(region.w, region.h))
        const cw = Math.max(1, Math.round(region.w * s))
        const ch = Math.max(1, Math.round(region.h * s))
        const c = new OffscreenCanvas(cw, ch)
        c.getContext('2d').drawImage(img, region.x, region.y, region.w, region.h, 0, 0, cw, ch)
        crops.push({
          png: await toB64(c),
          w: cw,
          h: ch,
          region,
          faceImg: f,
          face: {
            x: (f.x - region.x) * (cw / region.w),
            y: (f.y - region.y) * (ch / region.h),
            w: f.w * (cw / region.w),
            h: f.h * (ch / region.h),
          },
        })
      }
      img.close()
      return { width: W, height: H, crops }
    },
    /** Bảng thumbnail: crop vuông 1,6 × mặt (như classifier) letterbox xám, đánh số. */
    async sheet(items, cols, cell) {
      const rows = Math.ceil(items.length / cols)
      const c = new OffscreenCanvas(cols * cell, rows * (cell + 16))
      const g = c.getContext('2d')
      g.fillStyle = '#fff'
      g.fillRect(0, 0, c.width, c.height)
      for (let i = 0; i < items.length; i++) {
        const it = items[i]
        const res = await fetch(it.url)
        const img = await createImageBitmap(await res.blob())
        const r = squareAround(it.face, img.width, img.height, 1.6)
        const x = (i % cols) * cell
        const y = Math.floor(i / cols) * (cell + 16)
        g.fillStyle = GRAY
        g.fillRect(x, y, cell, cell)
        const sc = cell / Math.max(r.w, r.h)
        g.drawImage(
          img,
          r.x,
          r.y,
          r.w,
          r.h,
          x + (cell - r.w * sc) / 2,
          y + (cell - r.h * sc) / 2,
          r.w * sc,
          r.h * sc,
        )
        g.fillStyle = '#000'
        g.font = '12px sans-serif'
        g.fillText(String(i), x + 3, y + cell + 12)
        img.close()
      }
      return toB64(c)
    },
  }
  return true
}

function sizeClass(w, h) {
  const s = Math.min(w, h)
  return s < 160 ? 'small' : s < 320 ? 'medium' : 'large'
}

function attribution() {
  const map = new Map()
  for (const f of ['validation-images.csv', 'test-images.csv', 'train-images-selected.csv']) {
    const p = join(INDEX, f)
    if (!existsSync(p)) continue
    readCsv(p, (r, h) =>
      map.set(r[0], {
        license: r[h.indexOf('License')],
        author: r[h.indexOf('Author')],
        landing: r[h.indexOf('OriginalLandingURL')],
      }),
    )
  }
  return map
}

async function cmdFaces() {
  const root = join(ROOT, opt('root', 'data/dataset'))
  const limit = Number(opt('limit', 0))
  const browserName = opt('browser', 'chromium')
  const { images } = JSON.parse(readFileSync(SELECTION, 'utf8'))
  const attr = attribution()
  const subset = opt('subset', null)
  const todo = images.filter(
    (im) =>
      (!subset || im.subset === subset) &&
      existsSync(join(IMAGES, SUBSET_DIR[im.subset], `${im.id}.jpg`)),
  )
  const list = limit > 0 ? todo.slice(0, limit) : todo
  const sessions = new Map()
  const stat = { images: 0, faces: 0, none: 0, errors: 0 }
  const byKind = {}
  const t0 = Date.now()
  await withPage(browserName, async (page) => {
    await page.evaluate(pageSetup)
    for (const im of list) {
      const url = `/data/openimages/images/${SUBSET_DIR[im.subset]}/${im.id}.jpg`
      const out = await page.evaluate((job) => window.__oi.run(job), {
        url,
        boxes: im.boxes ?? null,
        minFacePx: 48,
        maxFaces: im.kind === 'person' ? 3 : 4,
        maxSide: 448,
      })
      stat.images++
      if (out.error) {
        stat.errors++
        continue
      }
      if (!out.crops.length) stat.none++
      const sessionId = `ses-oi-${im.kind}-${im.subset}`
      const dir = join(root, sessionId)
      if (!sessions.has(sessionId)) {
        mkdirSync(dir, { recursive: true })
        sessions.set(sessionId, { kind: im.kind, samples: 0 })
      }
      const ses = sessions.get(sessionId)
      const a = attr.get(im.id) ?? {}
      out.crops.forEach((c, k) => {
        const id = `${sessionId}-${im.id}-${k}`
        const edges = []
        if (c.region.x <= 0) edges.push('left')
        if (c.region.y <= 0) edges.push('top')
        if (c.region.x + c.region.w >= out.width) edges.push('right')
        if (c.region.y + c.region.h >= out.height) edges.push('bottom')
        const meta = {
          id,
          sessionId,
          subjectId: `oi-${im.id}`,
          label: im.kind === 'person' ? 'person' : 'mannequin',
          lighting: 'unknown',
          mannequinType: im.kind === 'person' ? 'none' : im.kind === 'doll' ? 'doll' : 'unknown',
          ts: 0,
          capturedAt: new Date().toISOString(),
          epoch: 0,
          frameId: 0,
          taskId: 0,
          cameraRect: c.region,
          crop: { w: c.w, h: c.h },
          cellsBox: { w: 0, h: 0 },
          cellCount: 0,
          holes: 0,
          n: 0,
          sizeClass: sizeClass(c.w, c.h),
          position: edges.length ? 'edge' : 'center',
          edges,
          grid: { w: 0, h: 0 },
          mirror: false,
          face: c.face,
          source: 'openimages',
          oi: {
            imageId: im.id,
            subset: im.subset,
            kind: im.kind,
            image: { w: out.width, h: out.height },
            faceImg: c.faceImg,
            license: a.license ?? null,
            author: a.author ?? null,
            landing: a.landing ?? null,
          },
        }
        writeFileSync(join(dir, `${id}.png`), Buffer.from(c.png, 'base64'))
        writeFileSync(join(dir, `${id}.json`), JSON.stringify(meta, null, 1))
        ses.samples++
        stat.faces++
        byKind[im.kind] = (byKind[im.kind] ?? 0) + 1
      })
      if (stat.images % 250 === 0)
        console.log(
          `… ${stat.images}/${list.length} ảnh, ${stat.faces} mặt ${JSON.stringify(byKind)}, ${((Date.now() - t0) / 1000).toFixed(0)} s`,
        )
    }
  })
  for (const [sessionId, s] of sessions) {
    const dir = join(root, sessionId)
    const n = readdirSync(dir).filter((f) => f.endsWith('.png')).length
    writeFileSync(
      join(dir, 'session.json'),
      JSON.stringify(
        {
          sessionId,
          source: 'openimages',
          license:
            'Open Images V7: annotations CC BY 4.0; images listed by their uploaders as CC BY 2.0 (per image: oi.license, oi.author, oi.landing in each sample)',
          subjectId: null,
          label: s.kind === 'person' ? 'person' : 'mannequin',
          lighting: 'unknown',
          mannequinType: s.kind === 'person' ? 'none' : s.kind === 'doll' ? 'doll' : 'unknown',
          participantConsent: null,
          startedAt: new Date(t0).toISOString(),
          stoppedAt: new Date().toISOString(),
          samples: n,
          app: { consentVersion: null, rateHz: 0, grid: null, camera: null },
        },
        null,
        1,
      ),
    )
  }
  console.log(
    `xong ${stat.images} ảnh trong ${((Date.now() - t0) / 1000).toFixed(0)} s: ${stat.faces} mặt ${JSON.stringify(byKind)}, ${stat.none} ảnh không có mặt dùng được, ${stat.errors} lỗi → ${root}`,
  )
}

async function cmdSheets() {
  const root = join(ROOT, opt('root', 'data/dataset'))
  const only = opt('session', null)
  const per = Number(opt('per', 48))
  // Chỉ mẫu thuộc một tập của splits.json (ví dụ --split test để kiểm sạch tập đánh giá).
  const onlySplit = opt('split', null)
  const bySample = onlySplit
    ? JSON.parse(readFileSync(join(root, 'splits.json'), 'utf8')).bySample
    : null
  const cols = 8
  const outDir = join(OI, 'sheets')
  mkdirSync(outDir, { recursive: true })
  const sessions = readdirSync(root).filter(
    (d) =>
      d.startsWith('ses-oi-') && (!only || d === only) && existsSync(join(root, d, 'session.json')),
  )
  await withPage(opt('browser', 'chromium'), async (page) => {
    await page.evaluate(pageSetup)
    for (const ses of sessions) {
      const metas = readdirSync(join(root, ses))
        .filter((f) => f.endsWith('.json') && f !== 'session.json')
        .sort()
        .map((f) => JSON.parse(readFileSync(join(root, ses, f), 'utf8')))
        .filter((m) => !bySample || bySample[m.id] === onlySplit)
      const index = []
      for (let s = 0; s * per < metas.length; s++) {
        const chunk = metas.slice(s * per, (s + 1) * per)
        const items = chunk.map((m) => ({
          url: `/${root.slice(ROOT.length + 1).replace(/\\/g, '/')}/${ses}/${m.id}.png`,
          face: m.face,
        }))
        const b64 = await page.evaluate(([its, c]) => window.__oi.sheet(its, c, 128), [items, cols])
        const name = `${ses}-${String(s).padStart(3, '0')}.png`
        writeFileSync(join(outDir, name), Buffer.from(b64, 'base64'))
        chunk.forEach((m, i) => index.push(`${name}\t${i}\t${m.id}`))
      }
      writeFileSync(join(outDir, `${ses}.tsv`), index.join('\n') + '\n')
      console.log(`${ses}: ${metas.length} mẫu → ${Math.ceil(metas.length / per)} bảng`)
    }
  })
}

function cmdReject() {
  const root = join(ROOT, opt('root', 'data/dataset'))
  const as = opt('as', 'unknown')
  const file = opt('file', null)
  const ids = [...argv, ...(file ? readFileSync(file, 'utf8').split(/\s+/) : [])].filter(Boolean)
  let n = 0
  for (const id of ids) {
    const ses = id.split('-').slice(0, 4).join('-')
    const p = join(root, ses, `${id}.json`)
    if (!existsSync(p)) {
      console.error(`không thấy ${p}`)
      continue
    }
    const m = JSON.parse(readFileSync(p, 'utf8'))
    m.labelFinal = as
    writeFileSync(p, JSON.stringify(m, null, 1))
    n++
  }
  console.log(`labelFinal = ${as} cho ${n} mẫu`)
}

/**
 * Kết quả kiểm bằng mắt theo bảng thumbnail: `label <bảng> <nhãn> <ô,ô,…> [<nhãn> <ô,…>] …`, ví dụ
 * `label ses-oi-mannequin-train-000 person 6,7,8 unknown 0,3`. Ghi labelFinal (ô không nêu giữ nhãn tạm) và
 * `reviewed: true` cho mọi mẫu của bảng; lưu dòng lệnh vào data/openimages/review.log để làm lại được.
 */
function cmdLabel() {
  const root = join(ROOT, opt('root', 'data/dataset'))
  const sheet = argv.shift()
  const ses = sheet.replace(/-\d{3}$/, '')
  const rows = readFileSync(join(OI, 'sheets', `${ses}.tsv`), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split('\t'))
    .filter(([name]) => name === `${sheet}.png`)
  if (!rows.length) throw new Error(`không có bảng ${sheet}`)
  const set = new Map()
  for (let i = 0; i + 1 < argv.length; i += 2) {
    const lab = argv[i]
    if (!['person', 'mannequin', 'unknown', 'background'].includes(lab))
      throw new Error(`nhãn ${lab}`)
    for (const k of argv[i + 1].split(',').filter(Boolean)) set.set(Number(k), lab)
  }
  const counts = {}
  for (const [, idx, id] of rows) {
    const p = join(root, ses, `${id}.json`)
    const m = JSON.parse(readFileSync(p, 'utf8'))
    const lab = set.get(Number(idx))
    if (lab) m.labelFinal = lab
    else delete m.labelFinal
    m.reviewed = true
    writeFileSync(p, JSON.stringify(m, null, 1))
    const final = lab ?? m.label
    counts[final] = (counts[final] ?? 0) + 1
  }
  const bad = [...set.keys()].filter((k) => k >= rows.length)
  if (bad.length) throw new Error(`ô ngoài bảng: ${bad.join(',')}`)
  writeFileSync(join(OI, 'review.log'), `${sheet} ${argv.join(' ')}\n`, { flag: 'a' })
  console.log(`${sheet}: ${rows.length} mẫu → ${JSON.stringify(counts)}`)
}

/** Ghi license, tác giả, trang gốc cho mẫu còn thiếu (metadata ảnh lọc xong sau khi đã dò mặt). */
function cmdAttribute() {
  const root = join(ROOT, opt('root', 'data/dataset'))
  const attr = attribution()
  let filled = 0
  let missing = 0
  for (const ses of readdirSync(root).filter((d) => d.startsWith('ses-oi-'))) {
    for (const f of readdirSync(join(root, ses)).filter(
      (x) => x.endsWith('.json') && x !== 'session.json',
    )) {
      const p = join(root, ses, f)
      const m = JSON.parse(readFileSync(p, 'utf8'))
      if (m.oi?.license) continue
      const a = attr.get(m.oi?.imageId)
      if (!a) {
        missing++
        continue
      }
      m.oi = { ...m.oi, license: a.license, author: a.author, landing: a.landing }
      writeFileSync(p, JSON.stringify(m, null, 1))
      filled++
    }
  }
  console.log(`bổ sung nguồn cho ${filled} mẫu, ${missing} mẫu không tìm thấy metadata`)
}

const commands = {
  select: cmdSelect,
  download: cmdDownload,
  faces: cmdFaces,
  sheets: cmdSheets,
  reject: cmdReject,
  attribute: cmdAttribute,
  label: cmdLabel,
}
if (!commands[cmd]) {
  console.error(`cách dùng: node tools/openimages.mjs <${Object.keys(commands).join('|')}> [...]`)
  process.exit(1)
}
await commands[cmd]()
