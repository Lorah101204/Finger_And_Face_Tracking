// PERF-03 (D-063): sân khấu (StagePage và mọi thứ chỉ nó dùng: vòng lặp, compositor, camera, worker client, dataset,
// log, debug) là một chunk riêng, nạp bằng import() động; trang chào chỉ tải phần của nó. Chunk được nạp trước khi
// người dùng cần: lúc trình duyệt rảnh sau khi trang chào tải xong (chỉ bản build; trên dev server đồ thị chưa bundle
// là hàng trăm request và làm e2e chậm) và khi có ý định (rê chuột, focus, chạm vào thẻ đồng ý, tích hộp đồng ý).
// Một promise duy nhất cho mọi lần gọi, kể cả khi bị từ chối: không thử lại trong trang vì module map của trình duyệt
// nhớ lần nạp lỗi (import() lần hai cùng URL bị từ chối ngay, không tải lại); khôi phục bằng tải lại trang một lần
// (StageErrorBoundary, allowChunkReload). Bộ nạp thật (import của StagePage) ở stageLoader.ts để file này thuần, unit test
// được trong Node mà không kéo .tsx của sân khấu.

/** Bộ nạp nhớ một promise (cả khi lỗi). */
export function createChunkLoader<T>(load: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | null = null
  return () => (promise ??= load())
}

/** Nạp trước, nuốt lỗi (lỗi thật sẽ hiện ra lúc vào sân khấu, qua StageErrorBoundary). */
export function prefetch(load: () => Promise<unknown>): void {
  load().catch(() => {})
}

export type IdleEnv = {
  readyState: () => DocumentReadyState
  onLoad: (cb: () => void) => () => void
  requestIdle?: (cb: () => void, opts: { timeout: number }) => number
  cancelIdle?: (id: number) => void
  setTimeout: (cb: () => void, ms: number) => number
  clearTimeout: (id: number) => void
  saveData: () => boolean
}

function browserIdleEnv(): IdleEnv {
  const w = window as Window &
    typeof globalThis & {
      requestIdleCallback?: (cb: () => void, opts: { timeout: number }) => number
      cancelIdleCallback?: (id: number) => void
    }
  return {
    readyState: () => document.readyState,
    onLoad: (cb) => {
      w.addEventListener('load', cb, { once: true })
      return () => w.removeEventListener('load', cb)
    },
    requestIdle: w.requestIdleCallback?.bind(w),
    cancelIdle: w.cancelIdleCallback?.bind(w),
    setTimeout: (cb, ms) => w.setTimeout(cb, ms),
    clearTimeout: (id) => w.clearTimeout(id),
    // navigator.connection không có trong lib.dom.
    saveData: () =>
      (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData ===
      true,
  }
}

/** Chạy `run` lúc rảnh sau sự kiện load (requestIdleCallback tối đa 2 s, không có thì setTimeout); bỏ qua khi
 *  người dùng bật Save-Data. Trả hàm hủy. */
export function schedulePrefetchWhenIdle(
  run: () => void,
  env: IdleEnv = browserIdleEnv(),
): () => void {
  if (env.saveData()) return () => {}
  let idle: number | null = null
  let timer: number | null = null
  const fire = () => {
    if (env.requestIdle) idle = env.requestIdle(run, { timeout: 2000 })
    else timer = env.setTimeout(run, 200)
  }
  let offLoad: (() => void) | null = null
  if (env.readyState() === 'complete') fire()
  else offLoad = env.onLoad(fire)
  return () => {
    offLoad?.()
    if (idle !== null) env.cancelIdle?.(idle)
    if (timer !== null) env.clearTimeout(timer)
  }
}

/** Lỗi nạp module động (chunk cũ đã bị deploy mới xóa, mất mạng giữa chừng). */
export function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err)
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|ChunkLoadError/i.test(
    msg,
  )
}

export const CHUNK_RELOAD_KEY = 'wct.chunkReloadAt'

/** Cho tải lại trang tự động tối đa một lần mỗi 30 s (tránh vòng lặp tải lại khi chunk hỏng thật). */
export function allowChunkReload(
  now: number,
  storage: Pick<Storage, 'getItem' | 'setItem'>,
): boolean {
  try {
    const last = Number(storage.getItem(CHUNK_RELOAD_KEY) ?? 0)
    if (Number.isFinite(last) && now - last < 30_000) return false
    storage.setItem(CHUNK_RELOAD_KEY, String(now))
    return true
  } catch {
    return false
  }
}
