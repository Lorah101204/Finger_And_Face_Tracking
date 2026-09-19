// REL-01 (D-050): đăng ký service worker public/sw.js của bản build (không đăng ký khi dev: Vite không phục vụ
// sw.js đã thay khóa và HMR không cần cache). Scope là base của trang (VITE_BASE) nên hoạt động cả ở
// https://<user>.github.io/<repo>/. Không precache lúc install: sau khi worker sẵn sàng, StagePage gửi danh sách file
// mà app đã nạp thật (asset của trang, model, wasm) qua `warm` để cache ngay từ lần mở đầu; loader ORT được cache khi
// worker phân loại nạp qua fetch. Mọi hàm ở đây thuần về DOM: chỉ đụng navigator.serviceWorker và performance.

export type SwContainerLike = {
  register(url: string, options?: { scope?: string }): Promise<unknown>
  ready: Promise<{ active: { postMessage(data: unknown): void } | null }>
}

export type SwEnv = {
  /** Chỉ bản build (import.meta.env.PROD). */
  prod: boolean
  /** Gốc đường dẫn của trang, kết thúc bằng '/'. */
  base: string
  container: SwContainerLike | null
  /** Promise hoàn tất khi trang đã nạp xong (sự kiện load) để không tranh băng thông với model lúc khởi động. */
  loaded: Promise<void>
}

/** URL của service worker: `${base}sw.js`, base luôn có dấu gạch cuối. */
export function serviceWorkerUrl(base: string): string {
  return (base.endsWith('/') ? base : base + '/') + 'sw.js'
}

function whenLoaded(): Promise<void> {
  if (typeof document === 'undefined' || document.readyState === 'complete')
    return Promise.resolve()
  return new Promise((resolve) => window.addEventListener('load', () => resolve(), { once: true }))
}

export function defaultSwEnv(): SwEnv {
  return {
    prod: import.meta.env.PROD,
    base: import.meta.env.BASE_URL,
    container:
      typeof navigator !== 'undefined' && 'serviceWorker' in navigator
        ? (navigator.serviceWorker as unknown as SwContainerLike)
        : null,
    loaded: whenLoaded(),
  }
}

/** Đăng ký sau `load`; trả false khi không đăng ký (dev, không hỗ trợ, lỗi: app vẫn chạy bình thường không cache). */
export async function registerServiceWorker(env: SwEnv = defaultSwEnv()): Promise<boolean> {
  if (!env.prod || !env.container) return false
  await env.loaded
  try {
    await env.container.register(serviceWorkerUrl(env.base), { scope: env.base })
    return true
  } catch {
    return false
  }
}

export type WarmMessage = { type: 'warm'; urls: string[] }

/**
 * Chọn từ Resource Timing của trang các asset đã nạp dưới `${base}assets/` (JS, CSS, worker) cộng URL của chính
 * trang (không hash) để service worker cache; bỏ trùng. Thuần để unit test.
 */
export function pickWarmAssets(
  entries: ReadonlyArray<{ name: string }>,
  pageHref: string,
  base: string,
): string[] {
  const page = new URL(pageHref)
  const prefix = new URL((base.endsWith('/') ? base : base + '/') + 'assets/', page.origin).href
  const out = new Set<string>([page.origin + page.pathname])
  for (const e of entries) if (e.name.startsWith(prefix)) out.add(e.name.split('#')[0])
  return [...out]
}

/** Gửi `warm` cho worker đang hoạt động; trả false khi không có service worker (dev). */
export async function warmServiceWorker(
  urls: string[],
  env: SwEnv = defaultSwEnv(),
): Promise<boolean> {
  if (!env.prod || !env.container || urls.length === 0) return false
  try {
    const reg = await env.container.ready
    if (!reg.active) return false
    const msg: WarmMessage = { type: 'warm', urls }
    reg.active.postMessage(msg)
    return true
  } catch {
    return false
  }
}

/** Danh sách asset của trang hiện tại từ Resource Timing (rỗng khi không có performance). */
export function documentWarmList(base: string = import.meta.env.BASE_URL): string[] {
  if (typeof performance === 'undefined' || typeof location === 'undefined') return []
  return pickWarmAssets(performance.getEntriesByType('resource'), location.href, base)
}
