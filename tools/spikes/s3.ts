// S3: nhãn handedness của MediaPipe trên ảnh CHƯA mirror (như frame webcam thô) và trên bản lật ngang.
// Vẽ landmarks + nhãn lên canvas để đối chiếu bằng mắt với giải phẫu (vị trí ngón cái so với ngón út).
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import { loadImage, log, report, setStatus } from './lib'

const WASM = '/models/wasm'
const MODEL = '/models/hand_landmarker.task'
const CANDIDATES = ['/spike-assets/hands.jpg', '/spike-assets/thumbs_up.jpg', '/spike-assets/pointing_up.jpg']

type HandInfo = {
  label: string
  score: number
  wristX: number
  thumbTipX: number
  pinkyTipX: number
  thumbSideInImage: 'trái ảnh' | 'phải ảnh'
  centerX: number
}

const vision = await FilesetResolver.forVisionTasks(WASM)
const lm = await HandLandmarker.createFromOptions(vision, {
  baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' },
  runningMode: 'IMAGE',
  numHands: 2,
})

const results: Record<string, unknown> = { spike: 'S3', images: {} }
const stage = document.getElementById('stage')

function analyse(canvas: HTMLCanvasElement, title: string): HandInfo[] {
  const r = lm.detect(canvas)
  const handed = (r as unknown as { handedness?: { categoryName: string; score: number }[][] }).handedness ?? []
  const ctx = canvas.getContext('2d')
  const infos: HandInfo[] = []
  r.landmarks.forEach((pts, i) => {
    const cat = handed[i]?.[0]
    const info: HandInfo = {
      label: cat?.categoryName ?? '?',
      score: Math.round((cat?.score ?? 0) * 100) / 100,
      wristX: +pts[0].x.toFixed(3),
      thumbTipX: +pts[4].x.toFixed(3),
      pinkyTipX: +pts[20].x.toFixed(3),
      thumbSideInImage: pts[4].x < pts[20].x ? 'trái ảnh' : 'phải ảnh',
      centerX: +(pts.reduce((s, p) => s + p.x, 0) / pts.length).toFixed(3),
    }
    infos.push(info)
    if (ctx) {
      ctx.fillStyle = '#00ff00'
      for (const p of pts) ctx.fillRect(p.x * canvas.width - 2, p.y * canvas.height - 2, 4, 4)
      ctx.fillStyle = '#ff00ff'
      ctx.fillRect(pts[4].x * canvas.width - 5, pts[4].y * canvas.height - 5, 10, 10)
      ctx.font = 'bold 20px sans-serif'
      ctx.fillStyle = '#ffff00'
      ctx.strokeStyle = '#000'
      ctx.lineWidth = 4
      const text = `${info.label} ${info.score}`
      const tx = pts[0].x * canvas.width
      const ty = pts[0].y * canvas.height + 24
      ctx.strokeText(text, tx, ty)
      ctx.fillText(text, tx, ty)
    }
  })
  if (ctx) {
    ctx.font = 'bold 18px sans-serif'
    ctx.fillStyle = '#fff'
    ctx.strokeStyle = '#000'
    ctx.lineWidth = 4
    ctx.strokeText(title, 8, 22)
    ctx.fillText(title, 8, 22)
  }
  return infos
}

for (const url of CANDIDATES) {
  let img: HTMLImageElement
  try {
    img = await loadImage(url)
  } catch {
    log(`bỏ qua ${url}`)
    continue
  }
  const scale = Math.min(1, 640 / img.naturalWidth)
  const w = Math.round(img.naturalWidth * scale)
  const h = Math.round(img.naturalHeight * scale)
  const raw = document.createElement('canvas')
  raw.width = w
  raw.height = h
  raw.getContext('2d')?.drawImage(img, 0, 0, w, h)
  const mirrored = document.createElement('canvas')
  mirrored.width = w
  mirrored.height = h
  const mctx = mirrored.getContext('2d')
  if (mctx) {
    mctx.translate(w, 0)
    mctx.scale(-1, 1)
    mctx.drawImage(img, 0, 0, w, h)
  }
  const rawInfo = analyse(raw, `${url} RAW (chưa mirror)`)
  const mirInfo = analyse(mirrored, `${url} MIRRORED`)
  ;(results.images as Record<string, unknown>)[url] = { raw: rawInfo, mirrored: mirInfo }
  stage?.appendChild(raw)
  stage?.appendChild(mirrored)
  log(`${url}: raw ${JSON.stringify(rawInfo)}`)
  log(`${url}: mirrored ${JSON.stringify(mirInfo)}`)
}
lm.close()
setStatus('xong')
report(results)
