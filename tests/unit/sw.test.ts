import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

// REL-01 (mục 7.27, D-050): public/sw.js chạy trong node:vm với self, caches, fetch giả. Scope https://host/repo/ để
// kiểm base khác '/'. Khóa placeholder được thay như vite.config.ts làm lúc build.
const SW_SRC = readFileSync(resolve('public/sw.js'), 'utf8')
const MODELS_KEY = 'aaaaaaaaaaaa'
const BUILD_ID = 'bbbbbbbbbbbb'
const ORIGIN = 'https://host.test'
const SCOPE = `${ORIGIN}/repo/`

type Handler = (event: unknown) => void

class FakeCache {
  map = new Map<string, Response>()
  key(req: { url: string } | string) {
    return typeof req === 'string' ? req : req.url
  }
  matchOpts: unknown[] = []
  async match(req: { url: string } | string, opts?: unknown) {
    this.matchOpts.push(opts)
    const r = this.map.get(this.key(req))
    return r ? r.clone() : undefined
  }
  async put(req: { url: string } | string, res: Response) {
    this.map.set(this.key(req), res)
  }
  async keys() {
    return [...this.map.keys()].map((k) => new Request(k))
  }
}

function setup(
  opts: { placeholders?: boolean; fetch?: (req: { url: string }) => Promise<Response> } = {},
) {
  const src =
    opts.placeholders === false
      ? SW_SRC
      : SW_SRC.replace('__WCT_MODELS_KEY__', MODELS_KEY).replace('__WCT_BUILD_ID__', BUILD_ID)
  const caches = new Map<string, FakeCache>()
  const handlers: Record<string, Handler[]> = {}
  const fetched: string[] = []
  const claimed = { n: 0, skip: 0 }
  const defaultFetch = async (req: { url: string }) => {
    fetched.push(req.url)
    if (req.url.endsWith('/missing.task')) return new Response('no', { status: 404 })
    return new Response(`body:${new URL(req.url).pathname}`, {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
    })
  }
  const sandbox: Record<string, unknown> = {
    URL,
    Request,
    Response,
    Headers,
    console,
    fetch: (input: { url: string } | string) =>
      (opts.fetch ?? defaultFetch)(typeof input === 'string' ? { url: input } : input),
    caches: {
      open: async (name: string) => {
        let c = caches.get(name)
        if (!c) {
          c = new FakeCache()
          caches.set(name, c)
        }
        return c
      },
      keys: async () => [...caches.keys()],
      delete: async (name: string) => caches.delete(name),
      has: async (name: string) => caches.has(name),
    },
    registration: { scope: SCOPE },
    location: new URL(SCOPE),
    clients: { claim: async () => void claimed.n++ },
    skipWaiting: async () => void claimed.skip++,
    addEventListener: (type: string, fn: Handler) => (handlers[type] ??= []).push(fn),
  }
  sandbox.self = sandbox
  vm.createContext(sandbox)
  vm.runInContext(src, sandbox, { filename: 'sw.js' })

  async function dispatch(type: string, event: Record<string, unknown>) {
    const pending: Promise<unknown>[] = []
    const ev = {
      ...event,
      respondWith(p: Promise<Response>) {
        ;(this as { response?: Promise<Response> }).response = p
      },
      waitUntil(p: Promise<unknown>) {
        pending.push(p)
      },
    }
    for (const h of handlers[type] ?? []) h(ev)
    await Promise.all(pending)
    return ev as typeof ev & { response?: Promise<Response> }
  }
  // Request thật không cho đặt mode 'navigate' qua constructor; sw.js chỉ đọc url, method, mode nên dùng object thường.
  const fetchEvent = (url: string, init: { mode?: string; method?: string } = {}) =>
    dispatch('fetch', { request: { url, method: init.method ?? 'GET', mode: init.mode ?? 'cors' } })
  const urls = (name: string) => [...(caches.get(name)?.map.keys() ?? [])]
  return { caches, fetched, claimed, dispatch, fetchEvent, urls, handlers }
}

const MODELS = `wct-models-${MODELS_KEY}`
const APP = `wct-app-${BUILD_ID}`

describe('public/sw.js', () => {
  it('install skipWaiting; activate xóa cache wct-* khóa khác, giữ hai khóa hiện tại, claim client', async () => {
    const s = setup()
    await s.dispatch('install', {})
    expect(s.claimed.skip).toBe(1)
    // cache cũ của build và model trước, cache lạ không đụng
    for (const n of ['wct-models-000000000000', 'wct-app-111111111111', 'khac', MODELS])
      s.caches.set(n, new FakeCache())
    await s.dispatch('activate', {})
    expect([...s.caches.keys()].sort()).toEqual(['khac', MODELS].sort())
    expect(s.claimed.n).toBe(1)
  })

  it('models/*: cache-first vào wct-models; lần hai không fetch; 404 không cache', async () => {
    const s = setup()
    const url = `${SCOPE}models/hand_landmarker.task`
    const r1 = await (await s.fetchEvent(url)).response!
    expect(await r1.text()).toBe('body:/repo/models/hand_landmarker.task')
    expect(s.fetched).toEqual([url])
    const r2 = await (await s.fetchEvent(url)).response!
    expect(await r2.text()).toBe('body:/repo/models/hand_landmarker.task')
    expect(s.fetched).toHaveLength(1)
    expect(s.urls(MODELS)).toEqual([url])
    // khóa là URL bỏ hash và tra với ignoreVary (máy chủ trả Vary: Origin thì bản cache vẫn được dùng)
    const r3 = await (await s.fetchEvent(`${url}#frag`)).response!
    expect(await r3.text()).toBe('body:/repo/models/hand_landmarker.task')
    expect(s.fetched).toHaveLength(1)
    expect(
      s.caches
        .get(MODELS)!
        .matchOpts.every((o) => (o as { ignoreVary?: boolean })?.ignoreVary === true),
    ).toBe(true)
    const miss = await (await s.fetchEvent(`${SCOPE}models/missing.task`)).response!
    expect(miss.status).toBe(404)
    expect(s.urls(MODELS)).toEqual([url])
  })

  it('assets/* cache-first vào wct-app; trang network-first ghi khóa trang và dùng bản cache khi mất mạng', async () => {
    let offline = false
    const s = setup({
      fetch: async (req) => {
        if (offline) throw new TypeError('Failed to fetch')
        return new Response(`net:${new URL(req.url).pathname}`, { status: 200 })
      },
    })
    await (
      await s.fetchEvent(`${SCOPE}assets/index-abc.js`)
    ).response!
    expect(s.urls(APP)).toEqual([`${SCOPE}assets/index-abc.js`])
    const nav = await (await s.fetchEvent(`${SCOPE}`, { mode: 'navigate' })).response!
    expect(await nav.text()).toBe('net:/repo/')
    // index.html tường minh cũng là trang; điều hướng tới đường dẫn con trong scope dùng cùng khóa
    await (
      await s.fetchEvent(`${SCOPE}index.html`)
    ).response!
    expect(s.urls(APP).sort()).toEqual([`${SCOPE}assets/index-abc.js`, SCOPE].sort())
    offline = true
    // bản cache là phản hồi mạng gần nhất của trang (index.html tường minh), dùng cho mọi điều hướng trong scope
    const cached = await (await s.fetchEvent(`${SCOPE}`, { mode: 'navigate' })).response!
    expect(await cached.text()).toBe('net:/repo/index.html')
    const asset = await (await s.fetchEvent(`${SCOPE}assets/index-abc.js`)).response!
    expect(await asset.text()).toBe('net:/repo/assets/index-abc.js')
    // asset chưa có trong cache mà mất mạng thì lỗi trả về cho trang (không nuốt)
    await expect((await s.fetchEvent(`${SCOPE}assets/other.js`)).response!).rejects.toThrow()
  })

  it('khác origin: Response.error() ngay, không fetch (I9); cùng origin ngoài scope hay POST: không can thiệp', async () => {
    const s = setup()
    const foreign = await s.fetchEvent('https://odml.pa.googleapis.com/v1/log', { method: 'POST' })
    expect(foreign.response).toBeDefined()
    expect((await foreign.response!).type).toBe('error')
    expect(s.fetched).toEqual([])
    const outside = await s.fetchEvent(`${ORIGIN}/other/x.js`)
    expect(outside.response).toBeUndefined()
    const post = await s.fetchEvent(`${SCOPE}models/x.task`, { method: 'POST' })
    expect(post.response).toBeUndefined()
    const sw = await s.fetchEvent(`${SCOPE}sw.js`)
    expect(sw.response).toBeUndefined()
  })

  it('message warm: cache models, assets và trang từ danh sách; bỏ URL lạ và URL đã có; báo warmed với số mới', async () => {
    const s = setup()
    const posted: unknown[] = []
    const urls = [
      `${SCOPE}models/wasm/vision_wasm_module_internal.wasm`,
      `${SCOPE}models/face_landmarker.task`,
      `${SCOPE}assets/index-abc.js`,
      `${SCOPE}`,
      `${SCOPE}spike-assets/face.png`,
      'https://cdn.example/x.js',
      'không phải url ://',
    ]
    await s.dispatch('message', {
      data: { type: 'warm', urls },
      source: { postMessage: (m: unknown) => posted.push(m) },
    })
    expect(s.urls(MODELS).sort()).toEqual(urls.slice(0, 2).sort())
    expect(s.urls(APP).sort()).toEqual([`${SCOPE}assets/index-abc.js`, SCOPE].sort())
    expect(s.fetched).toHaveLength(4)
    expect(posted).toEqual([{ type: 'warmed', added: 4 }])
    await s.dispatch('message', {
      data: { type: 'warm', urls: urls.slice(0, 3) },
      source: { postMessage: (m: unknown) => posted.push(m) },
    })
    expect(s.fetched).toHaveLength(4)
    expect(posted[1]).toEqual({ type: 'warmed', added: 0 })
    await s.dispatch('message', { data: { type: 'khac' } })
    expect(posted).toHaveLength(2)
  })

  it('khóa cache là hai placeholder đã thay; chưa thay thì tên vẫn hợp lệ nhưng khác', () => {
    expect(SW_SRC).toContain("'__WCT_MODELS_KEY__'")
    expect(SW_SRC).toContain("'__WCT_BUILD_ID__'")
    const raw = setup({ placeholders: false })
    expect(raw.handlers.fetch).toHaveLength(1)
  })
})
