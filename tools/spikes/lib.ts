// SPIKE-00: tiện ích chung cho các trang spike trong tools/spikes. Không dùng trong đường chạy chính (src/).

export type Stats = { n: number; p50: number; p95: number; mean: number; min: number; max: number }

export function stats(values: number[]): Stats {
  const a = [...values].sort((x, y) => x - y)
  const n = a.length
  if (n === 0) return { n: 0, p50: NaN, p95: NaN, mean: NaN, min: NaN, max: NaN }
  const q = (p: number) => a[Math.min(n - 1, Math.max(0, Math.round((n - 1) * p)))]
  const mean = a.reduce((s, v) => s + v, 0) / n
  const r = (v: number) => Math.round(v * 100) / 100
  return { n, p50: r(q(0.5)), p95: r(q(0.95)), mean: r(mean), min: r(a[0]), max: r(a[n - 1]) }
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`không tải được ${url}`))
    img.src = url
  })
}

/** Letterbox nguồn vào canvas vuông size×size, đệm xám (giống restrictedFrame ở MASK-02). */
export function letterbox(
  src: CanvasImageSource,
  sw: number,
  sh: number,
  size: number,
  gray = 128,
): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('không tạo được 2d context')
  ctx.fillStyle = `rgb(${gray},${gray},${gray})`
  ctx.fillRect(0, 0, size, size)
  const s = Math.min(size / sw, size / sh)
  const dw = Math.round(sw * s)
  const dh = Math.round(sh * s)
  ctx.drawImage(src, 0, 0, sw, sh, Math.floor((size - dw) / 2), Math.floor((size - dh) / 2), dw, dh)
  return c
}

export function webglInfo(): Record<string, string> {
  const c = document.createElement('canvas')
  const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null
  if (!gl) return { webgl: 'không có' }
  const dbg = gl.getExtension('WEBGL_debug_renderer_info')
  return {
    version: String(gl.getParameter(gl.VERSION)),
    renderer: String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)),
    vendor: String(dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)),
  }
}

declare global {
  interface Window {
    __results?: unknown
    __done?: boolean
  }
}

export function report(results: unknown, done = true): void {
  window.__results = results
  window.__done = done
  const pre = document.getElementById('out')
  if (pre) pre.textContent = JSON.stringify(results, null, 2)
}

export function setStatus(text: string): void {
  const el = document.getElementById('status')
  if (el) el.textContent = text
}

export function log(line: string): void {
  const pre = document.getElementById('log')
  if (pre) pre.textContent += line + '\n'
  console.log(line)
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export type WorkerMsg = Record<string, unknown>

/** Gửi một message và chờ đúng một message trả lời, có timeout. */
export function makeCall(worker: Worker) {
  return (msg: WorkerMsg, transfer: Transferable[] = [], timeoutMs = 60000) =>
    new Promise<WorkerMsg>((resolve, reject) => {
      const onMsg = (e: MessageEvent) => {
        cleanup()
        resolve(e.data as WorkerMsg)
      }
      const onErr = (e: ErrorEvent) => {
        cleanup()
        reject(new Error(e.message || 'worker error'))
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error(`timeout ${timeoutMs} ms`))
      }, timeoutMs)
      function cleanup() {
        clearTimeout(timer)
        worker.removeEventListener('message', onMsg)
        worker.removeEventListener('error', onErr)
      }
      worker.addEventListener('message', onMsg)
      worker.addEventListener('error', onErr)
      worker.postMessage(msg, transfer)
    })
}
