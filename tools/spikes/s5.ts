// S5: drawImage sub-rect 1:1 vào OffscreenCanvas rồi transferToImageBitmap; ms cho crop 256 và 720 px, 300 lần.
// So sánh thêm createImageBitmap(src, sx, sy, sw, sh), bước letterbox 720 -> 256 và getImageData (chi phí probe).
// Nguồn: canvas 1280x720 và video 1280x720 (captureStream của canvas).
import { loadImage, log, report, setStatus, sleep, stats } from './lib'

const W = 1280
const H = 720
const N = 300
const img = await loadImage('/spike-assets/hands.jpg')
const canvasSrc = document.createElement('canvas')
canvasSrc.width = W
canvasSrc.height = H
const c2 = canvasSrc.getContext('2d')
if (!c2) throw new Error('không tạo được 2d context')
{
  const s = Math.max(W / img.naturalWidth, H / img.naturalHeight)
  const dw = img.naturalWidth * s
  const dh = img.naturalHeight * s
  c2.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh)
}
// Nguồn video: WebM 16 s có sẵn (tạo bằng tools/spikes/make-webm.mjs), decode độc lập rAF. Nếu host không cho phát
// (ví dụ pane ẩn), bỏ qua nguồn video và chỉ đo nguồn canvas.
let video: HTMLVideoElement | null = document.createElement('video')
video.muted = true
video.playsInline = true
video.loop = true
video.src = '/spike-assets/test.webm'
video.style.width = '320px'
document.getElementById('stage')?.appendChild(video)
await Promise.race([video.play().catch(() => undefined), sleep(3000)])
await sleep(800)
let videoNote: unknown = { w: video.videoWidth, h: video.videoHeight, currentTime: +video.currentTime.toFixed(2) }
if (video.paused || video.currentTime === 0) {
  videoNote = `bỏ qua: video không phát được (paused=${video.paused}, visibility=${document.visibilityState})`
  video = null
}

const results: Record<string, unknown> = {
  spike: 'S5',
  iterations: N,
  visibility: document.visibilityState,
  video: videoNote,
}
report(results, false)

function benchDraw(source: CanvasImageSource, size: number) {
  const oc = new OffscreenCanvas(size, size)
  const octx = oc.getContext('2d')
  if (!octx) throw new Error('no offscreen 2d')
  const sx = Math.floor((W - size) / 2)
  const sy = Math.floor((H - size) / 2)
  const draw: number[] = []
  const transfer: number[] = []
  const total: number[] = []
  for (let i = 0; i < N; i++) {
    const t0 = performance.now()
    octx.drawImage(source, sx, sy, size, size, 0, 0, size, size)
    const t1 = performance.now()
    const bmp = oc.transferToImageBitmap()
    const t2 = performance.now()
    bmp.close()
    draw.push(t1 - t0)
    transfer.push(t2 - t1)
    total.push(t2 - t0)
  }
  return { draw: stats(draw), transfer: stats(transfer), total: stats(total) }
}

async function benchCreateImageBitmap(source: ImageBitmapSource, size: number) {
  const sx = Math.floor((W - size) / 2)
  const sy = Math.floor((H - size) / 2)
  const ms: number[] = []
  for (let i = 0; i < N; i++) {
    const t0 = performance.now()
    const bmp = await createImageBitmap(source, sx, sy, size, size)
    ms.push(performance.now() - t0)
    bmp.close()
  }
  return stats(ms)
}

function benchLetterbox(source: CanvasImageSource, cropSize: number, outSize = 256) {
  const crop = new OffscreenCanvas(cropSize, cropSize)
  const cctx = crop.getContext('2d')
  const lb = new OffscreenCanvas(outSize, outSize)
  const lctx = lb.getContext('2d')
  if (!cctx || !lctx) throw new Error('no offscreen 2d')
  const sx = Math.floor((W - cropSize) / 2)
  const sy = Math.floor((H - cropSize) / 2)
  const ms: number[] = []
  for (let i = 0; i < N; i++) {
    const t0 = performance.now()
    cctx.drawImage(source, sx, sy, cropSize, cropSize, 0, 0, cropSize, cropSize)
    lctx.fillStyle = 'rgb(128,128,128)'
    lctx.fillRect(0, 0, outSize, outSize)
    lctx.drawImage(crop, 0, 0, cropSize, cropSize, 0, 0, outSize, outSize)
    const bmp = lb.transferToImageBitmap()
    ms.push(performance.now() - t0)
    bmp.close()
  }
  return stats(ms)
}

function benchGetImageData(source: CanvasImageSource, size: number) {
  const oc = new OffscreenCanvas(size, size)
  const octx = oc.getContext('2d', { willReadFrequently: true })
  if (!octx) throw new Error('no offscreen 2d')
  const sx = Math.floor((W - size) / 2)
  const sy = Math.floor((H - size) / 2)
  const ms: number[] = []
  for (let i = 0; i < N; i++) {
    const t0 = performance.now()
    octx.drawImage(source, sx, sy, size, size, 0, 0, size, size)
    octx.getImageData(0, 0, size, size)
    ms.push(performance.now() - t0)
  }
  return stats(ms)
}

const sources: Array<[string, HTMLCanvasElement | HTMLVideoElement]> = [['canvas', canvasSrc]]
if (video) sources.push(['video', video])
for (const [name, source] of sources) {
  for (const size of [256, 720]) {
    setStatus(`${name} ${size}`)
    const key = `${name}_${size}`
    const draw = benchDraw(source, size)
    const cib = await benchCreateImageBitmap(source, size)
    const lb = benchLetterbox(source, size)
    const gid = benchGetImageData(source, size)
    results[key] = { drawThenTransfer: draw, createImageBitmapCrop: cib, cropPlusLetterbox256: lb, drawPlusGetImageData: gid }
    log(
      `${key}: draw p50 ${draw.draw.p50} + transfer p50 ${draw.transfer.p50} = total p50 ${draw.total.p50} (p95 ${draw.total.p95}) ms; createImageBitmap p50 ${cib.p50} ms; crop+letterbox256 p50 ${lb.p50} ms; getImageData p50 ${gid.p50} ms`,
    )
  }
}
setStatus('xong')
report(results)
