// REL-01 (D-050): service worker của bản build. File thuần, không bundle, không phụ thuộc; hai khóa dưới đây được
// vite.config.ts thay lúc build (closeBundle): MODELS_KEY là 12 ký tự đầu sha256 của public/models/models.json (đổi
// model thì đổi khóa, cache model cũ bị xóa ở activate), BUILD_ID là sha256 rút gọn của danh sách file trong
// dist/assets (đổi mỗi build, cache asset cũ bị xóa). Chiến lược:
// - `models/*` (model .task, .onnx, wasm MediaPipe, loader ORT): cache-first vào wct-models-<khóa>; sống qua nhiều
//   lần deploy app vì model không đổi theo build.
// - `assets/*` (JS, CSS, worker có hash trong tên): cache-first vào wct-app-<build>.
// - Trang (điều hướng, `index.html`): network-first, bản cache là dự phòng để mở offline (kiosk).
// - Chỉ cùng origin; yêu cầu khác origin bị trả Response.error() (I9: không có gì rời trình duyệt; đây là chốt thứ hai
//   sau core/networkGuard.ts trong worker và trang). Không precache lúc install: trang gửi `warm` với danh sách file đã
//   nạp thật (app/registerSw.ts) để cache ngay từ lần mở đầu sau khi worker kích hoạt.
// Unit test: tests/unit/sw.test.ts nạp file này vào node:vm với self, caches, fetch giả.
const MODELS_KEY = '__WCT_MODELS_KEY__'
const BUILD_ID = '__WCT_BUILD_ID__'
const MODELS_CACHE = `wct-models-${MODELS_KEY}`
const APP_CACHE = `wct-app-${BUILD_ID}`
const KEEP = [MODELS_CACHE, APP_CACHE]
/** Gốc đường dẫn của trang ('/', '/repo/'), suy từ scope đăng ký nên không cần biết VITE_BASE. */
const BASE = new URL(self.registration.scope).pathname
/** Khóa cache của trang: mọi điều hướng trong scope dùng chung một bản index.html. */
const PAGE_KEY = new URL(BASE, self.location.origin).href

/**
 * Phân loại một yêu cầu: foreign (khác origin), models, assets, page, other (cùng origin nhưng không cache, ví dụ
 * sw.js hay spike-assets khi preview).
 */
function classify(request) {
  let url
  try {
    url = new URL(request.url)
  } catch {
    return 'other'
  }
  if (url.origin !== self.location.origin) return 'foreign'
  if (!url.pathname.startsWith(BASE)) return 'other'
  const rel = url.pathname.slice(BASE.length)
  if (rel.startsWith('models/')) return 'models'
  if (rel.startsWith('assets/')) return 'assets'
  if (request.mode === 'navigate' || rel === '' || rel === 'index.html') return 'page'
  return 'other'
}

/**
 * Khóa cache là URL bỏ hash, dạng chuỗi, và so khớp với ignoreVary: máy chủ tĩnh trả `Vary: Origin` (vite preview) hay
 * `Vary: Accept-Encoding` (CDN), mà Cache API mặc định đòi header của yêu cầu lúc tra khớp header lúc lưu; yêu cầu
 * module script có `Origin`, yêu cầu warm thì không, nên nếu không bỏ Vary thì bản đã cache không bao giờ được dùng.
 */
function keyOf(request) {
  const u = new URL(request.url)
  u.hash = ''
  return u.href
}
const MATCH = { ignoreVary: true }

async function cacheFirst(cacheName, request) {
  const cache = await caches.open(cacheName)
  const key = keyOf(request)
  const hit = await cache.match(key, MATCH)
  if (hit) return hit
  const res = await fetch(request)
  // Chỉ cache bản đầy đủ 200 (Cache API từ chối 206; lỗi 404 không cache để lần sau thử lại).
  if (res.status === 200) await cache.put(key, res.clone())
  return res
}

async function networkFirst(cacheName, request) {
  const cache = await caches.open(cacheName)
  try {
    const res = await fetch(request)
    if (res.status === 200) await cache.put(PAGE_KEY, res.clone())
    return res
  } catch (err) {
    const hit = await cache.match(PAGE_KEY, MATCH)
    if (hit) return hit
    throw err
  }
}

/** `warm`: cache các URL trang gửi (chỉ models, assets, page cùng origin; đã có thì bỏ qua). Trả số file mới cache. */
async function warm(urls) {
  let added = 0
  for (const raw of urls) {
    let request
    try {
      request = new Request(new URL(String(raw), self.location.href).href)
    } catch {
      continue
    }
    const kind = classify(request)
    const name =
      kind === 'models' ? MODELS_CACHE : kind === 'assets' || kind === 'page' ? APP_CACHE : null
    if (!name) continue
    const key = kind === 'page' ? PAGE_KEY : keyOf(request)
    const cache = await caches.open(name)
    if (await cache.match(key, MATCH)) continue
    try {
      const res = await fetch(request)
      if (res.status === 200) {
        await cache.put(key, res)
        added++
      }
    } catch {
      // mất mạng giữa chừng: lần mở sau warm lại
    }
  }
  return added
}

self.addEventListener('install', (event) => {
  // Kích hoạt ngay để trang đang mở được điều khiển (clients.claim ở activate) mà không chờ đóng hết tab.
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(
        names.filter((n) => n.startsWith('wct-') && !KEEP.includes(n)).map((n) => caches.delete(n)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const kind = classify(event.request)
  if (kind === 'foreign') {
    event.respondWith(Promise.resolve(Response.error()))
    return
  }
  if (event.request.method !== 'GET') return
  if (kind === 'models') event.respondWith(cacheFirst(MODELS_CACHE, event.request))
  else if (kind === 'assets') event.respondWith(cacheFirst(APP_CACHE, event.request))
  else if (kind === 'page') event.respondWith(networkFirst(APP_CACHE, event.request))
})

self.addEventListener('message', (event) => {
  const data = event.data
  if (!data || data.type !== 'warm' || !Array.isArray(data.urls)) return
  const done = warm(data.urls).then((added) => {
    if (event.source && typeof event.source.postMessage === 'function')
      event.source.postMessage({ type: 'warmed', added })
  })
  if (typeof event.waitUntil === 'function') event.waitUntil(done)
})
