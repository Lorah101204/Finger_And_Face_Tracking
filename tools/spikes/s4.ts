// S4: requestVideoFrameCallback có bắn khi video ẩn (opacity 0, ngoài viewport, 1px, visibility hidden, display none)
// và khi tab nền không? MediaStreamTrackProcessor có dùng được không?
// Nguồn video: getUserMedia nếu được (webcam thật, hoặc camera giả của Chromium); nếu không thì ghi một đoạn WebM 16 s
// từ canvas bằng MediaRecorder rồi phát lại: decode tiếp tục khi tab ẩn, gần với webcam hơn captureStream (phụ thuộc rAF).
// Việc ghi cần document đang visible (rAF chạy). Pha 1: các kiểu ẩn của video element. Pha 2: đếm 12 s theo visibilityState
// trong lúc người chạy chuyển sang tab khác rồi quay lại.
import { log, report, setStatus, sleep } from './lib'

const W = 1280
const H = 720
// ?src=gum|webm (webm: /spike-assets/test.webm tạo bằng tools/spikes/make-webm.mjs)  ?phase=all|fg|bg
const PARAMS = new URLSearchParams(location.search)
const SRC = PARAMS.get('src') ?? 'gum'
const PHASE = PARAMS.get('phase') ?? 'all'
const results: Record<string, unknown> = {
  spike: 'S4',
  src: SRC,
  phase: PHASE,
  ua: navigator.userAgent,
  visibilityAtStart: document.visibilityState,
  hasRvfc: 'requestVideoFrameCallback' in HTMLVideoElement.prototype,
  hasMSTP: 'MediaStreamTrackProcessor' in window,
}
report(results, false)

const video = document.createElement('video')
video.muted = true
video.playsInline = true
video.autoplay = true
document.getElementById('stage')?.appendChild(video)

type Source = { kind: string; restart: () => Promise<void>; track: () => MediaStreamTrack | undefined }

async function recordWebm(stream: MediaStream, ms: number): Promise<string> {
  const mime = ['video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m))
  if (!mime) throw new Error('MediaRecorder không hỗ trợ webm')
  const rec = new MediaRecorder(stream, { mimeType: mime })
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data)
  }
  const stopped = new Promise<void>((r) => {
    rec.onstop = () => r()
  })
  rec.start(500)
  await sleep(ms)
  rec.stop()
  await stopped
  const blob = new Blob(chunks, { type: mime })
  if (blob.size < 20000) throw new Error(`WebM quá nhỏ (${blob.size} byte): rAF không chạy, pane/tab phải đang hiển thị khi ghi`)
  results.webmBytes = blob.size
  return URL.createObjectURL(blob)
}

async function getSource(): Promise<Source> {
  const cs = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream
  if (SRC === 'webm') {
    const url = '/spike-assets/test.webm'
    const restart = async () => {
      video.srcObject = null
      video.src = url
      await video.play()
    }
    await restart()
    return {
      kind: 'WebM 16 s có sẵn tại /spike-assets/test.webm, decode độc lập rAF',
      restart,
      track: () => (cs ? cs.call(video).getVideoTracks()[0] : undefined),
    }
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: W }, height: { ideal: H } },
      audio: false,
    })
    const s = stream.getVideoTracks()[0].getSettings()
    video.srcObject = stream
    await video.play()
    return {
      kind: `getUserMedia ${s.width}x${s.height}@${s.frameRate}`,
      restart: async () => {},
      track: () => stream.getVideoTracks()[0],
    }
  } catch (err) {
    log(`getUserMedia không dùng được (${String(err)}); ghi WebM từ canvas`)
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')
    let t = 0
    const anim = () => {
      if (ctx) {
        ctx.fillStyle = `hsl(${t % 360} 60% 50%)`
        ctx.fillRect(0, 0, W, H)
        ctx.fillStyle = '#fff'
        ctx.fillRect((t * 5) % W, 100, 60, 60)
      }
      t++
      requestAnimationFrame(anim)
    }
    anim()
    setStatus('ghi WebM 16 s (tab phải đang hiển thị)')
    const url = await recordWebm(canvas.captureStream(30), 16000)
    const restart = async () => {
      video.srcObject = null
      video.src = url
      await video.play()
    }
    await restart()
    return {
      kind: 'WebM 16 s ghi từ canvas, phát lại bằng video element (decode độc lập rAF)',
      restart,
      track: () => (cs ? cs.call(video).getVideoTracks()[0] : undefined),
    }
  }
}

const source = await getSource()
results.source = source.kind

type Buckets = { visible: number; hidden: number }
const bucketOf = () => (document.visibilityState === 'visible' ? 'visible' : 'hidden')

function countFrames() {
  const rv: Buckets = { visible: 0, hidden: 0 }
  const rf: Buckets = { visible: 0, hidden: 0 }
  let running = true
  const onFrame = () => {
    rv[bucketOf()]++
    if (running) video.requestVideoFrameCallback(onFrame)
  }
  const onRaf = () => {
    rf[bucketOf()]++
    if (running) requestAnimationFrame(onRaf)
  }
  video.requestVideoFrameCallback(onFrame)
  requestAnimationFrame(onRaf)
  const start = performance.now()
  return () => {
    running = false
    return { elapsedS: +((performance.now() - start) / 1000).toFixed(2), rvfc: rv, raf: rf }
  }
}

type MSTPCtor = new (init: { track: MediaStreamTrack }) => { readable: ReadableStream<VideoFrame> }
type MSTPResult =
  | { available: false; reason: string }
  | { available: true; frames: number; hz: number; elapsedS: number; buckets: Buckets }

async function countMSTP(ms: number): Promise<MSTPResult> {
  const track = source.track()
  if (!('MediaStreamTrackProcessor' in window) || !track) {
    await sleep(ms)
    return { available: false, reason: track ? 'không có MediaStreamTrackProcessor' : 'không có track' }
  }
  const Proc = (window as unknown as { MediaStreamTrackProcessor: MSTPCtor }).MediaStreamTrackProcessor
  const reader = new Proc({ track }).readable.getReader()
  const buckets: Buckets = { visible: 0, hidden: 0 }
  const start = performance.now()
  let n = 0
  while (performance.now() - start < ms) {
    const { value, done } = await reader.read()
    if (done || !value) break
    n++
    buckets[bucketOf()]++
    value.close()
  }
  await reader.cancel()
  const elapsed = (performance.now() - start) / 1000
  return { available: true, frames: n, hz: +(n / elapsed).toFixed(1), elapsedS: +elapsed.toFixed(2), buckets }
}

// Pha 1: các kiểu ẩn video element, document đang visible.
if (PHASE !== 'bg') {
const conditions: Array<[string, string]> = [
  ['visible', 'width:320px'],
  ['opacity0', 'width:320px;opacity:0'],
  ['offscreen', 'width:320px;position:fixed;left:-10000px;top:0'],
  ['size1px', 'width:1px;height:1px'],
  ['visibilityHidden', 'width:320px;visibility:hidden'],
  ['displayNone', 'width:320px;display:none'],
]
const conds: unknown[] = []
for (const [label, css] of conditions) {
  setStatus(`pha 1: ${label}`)
  video.style.cssText = css
  await source.restart()
  await sleep(300)
  const stop = countFrames()
  await sleep(4000)
  const r = stop()
  const rvfcHz = +((r.rvfc.visible + r.rvfc.hidden) / r.elapsedS).toFixed(1)
  const rafHz = +((r.raf.visible + r.raf.hidden) / r.elapsedS).toFixed(1)
  conds.push({ label, ...r, rvfcHz, rafHz, videoTime: +video.currentTime.toFixed(2), paused: video.paused })
  log(`${label}: rvfc ${rvfcHz} Hz, raf ${rafHz} Hz, visibility ${document.visibilityState}`)
}
video.style.cssText = 'width:320px'
results.conditions = conds
setStatus('pha 1: MediaStreamTrackProcessor')
await source.restart()
results.mstpForeground = await countMSTP(3000)
report(results, false)
}

// Pha 2: tab nền. Người chạy chuyển sang tab khác trong lúc đếm 12 s rồi quay lại (hoặc trang đã ở tab ẩn sẵn).
if (PHASE !== 'fg') {
setStatus('pha 2: đếm 12 s, hãy chuyển sang tab khác rồi quay lại')
await source.restart()
;(window as unknown as { __phase: string }).__phase = 'bg-ready'
const vis: { ts: number; state: DocumentVisibilityState }[] = [{ ts: 0, state: document.visibilityState }]
const start = performance.now()
document.addEventListener('visibilitychange', () =>
  vis.push({ ts: Math.round(performance.now() - start), state: document.visibilityState }),
)
const stop2 = countFrames()
const mstpBg = await countMSTP(12000)
const r2 = stop2()
let hiddenMs = 0
for (let i = 0; i < vis.length; i++) {
  const next = i + 1 < vis.length ? vis[i + 1].ts : Math.round(r2.elapsedS * 1000)
  if (vis[i].state === 'hidden') hiddenMs += next - vis[i].ts
}
const visibleMs = r2.elapsedS * 1000 - hiddenMs
results.background = {
  ...r2,
  hiddenS: +(hiddenMs / 1000).toFixed(2),
  rvfcHzVisible: visibleMs > 0 ? +((r2.rvfc.visible / visibleMs) * 1000).toFixed(1) : null,
  rvfcHzHidden: hiddenMs > 0 ? +((r2.rvfc.hidden / hiddenMs) * 1000).toFixed(1) : null,
  mstp: mstpBg,
  mstpHzHidden: hiddenMs > 0 && mstpBg.available ? +((mstpBg.buckets.hidden / hiddenMs) * 1000).toFixed(1) : null,
  visibilityEvents: vis,
  videoTime: +video.currentTime.toFixed(2),
  paused: video.paused,
}
}
setStatus('xong')
report(results)
