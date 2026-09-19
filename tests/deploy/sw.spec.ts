import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type BrowserContext, type Page, type Request } from '@playwright/test'
import { BASE } from '../../playwright.deploy.config'
import { CONSENT_KEY, CONSENT_VERSION, note } from '../e2e/helpers'

// REL-01 (mục 7.27, D-050): bản build dist/ qua `vite preview` (playwright.deploy.config.ts). Một context dùng chung
// cho cả file (storage và service worker sống qua các trang) nên các ca chạy tuần tự và phụ thuộc nhau theo thứ tự:
// 1. trang đầu chặn đăng ký để tạo hai cache "cũ"; 2. lần mở 1 vào #/app: worker kích hoạt, xóa cache cũ, cache model,
// wasm, loader ORT và asset của trang ngay lần này qua `warm` và fetch; 3. lần mở 2: mọi phản hồi models/ và assets/
// từ service worker; 4. lần mở 3 offline: worker mặt và phân loại vẫn sẵn sàng; 5. không yêu cầu nào rời origin (I9),
// đo ở tầng context (yêu cầu do service worker phát cũng vào đây, page.on('request') thì không).
test.describe.configure({ mode: 'serial' })

const ORIGIN = 'http://127.0.0.1:4174'
const APP_URL = `${ORIGIN}${BASE}#/app?debug=1&source=synthetic`
const PAGE_KEY = `${ORIGIN}${BASE}`
const sw = readFileSync(resolve('dist/sw.js'), 'utf8')
const MODELS_KEY = /const MODELS_KEY = '([0-9a-f]{12})'/.exec(sw)?.[1] ?? ''
const BUILD_ID = /const BUILD_ID = '([0-9a-f]{12})'/.exec(sw)?.[1] ?? ''
const MODELS_CACHE = `wct-models-${MODELS_KEY}`
const APP_CACHE = `wct-app-${BUILD_ID}`

let context: BrowserContext
const requests: Request[] = []
const foreign: string[] = []

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({ baseURL: `${ORIGIN}${BASE}` })
  context.on('request', (req) => {
    requests.push(req)
    const url = req.url()
    if (/^(about:|data:|blob:|chrome-error:)/.test(url)) return
    if (new URL(url).origin !== ORIGIN) foreign.push(url)
  })
})
test.afterAll(async () => {
  await context?.close()
})

type CacheDump = Record<string, string[]>
/** Tên cache và URL từng entry (evaluate trong trang cùng origin). */
async function dumpCaches(page: Page): Promise<CacheDump> {
  return page.evaluate(async () => {
    const out: Record<string, string[]> = {}
    for (const name of await caches.keys()) {
      const c = await caches.open(name)
      out[name] = (await c.keys()).map((r) => r.url).sort()
    }
    return out
  })
}
const waitFaceReady = (page: Page) =>
  page.waitForFunction(() => window.__wct?.face?.snapshot().ready === true, undefined, {
    timeout: 120_000,
  })
const waitClassifierReady = (page: Page) =>
  page.waitForFunction(() => window.__wct?.classifier?.snapshot().ready === true, undefined, {
    timeout: 120_000,
  })
/** Mở #/app, chờ worker mặt, mở cửa sổ 10 ô (khởi tạo worker phân loại lười), chờ nó sẵn sàng; trả ep. */
async function openAndReveal(page: Page): Promise<string> {
  await page.goto(APP_URL)
  await expect(page.locator('canvas#stage')).toBeVisible()
  await waitFaceReady(page)
  await page.waitForFunction(() => (window.__wct?.stage?.snapshot().stageSize.w ?? 0) > 0)
  const cols = await page.evaluate(() => window.__wct!.stage!.snapshot().layout.cols)
  await page.evaluate((c) => window.__scenario!.run(`windowAt(${c - 14},8,10)`), cols)
  await expect
    .poll(async () => (await page.evaluate(() => window.__wct!.loop!.snapshot())).reveal.kind)
    .toBe('open')
  await waitClassifierReady(page)
  return page.evaluate(() => window.__wct!.classifier!.snapshot().ep ?? '')
}
const under = (url: string, dir: string) => url.startsWith(`${ORIGIN}${BASE}${dir}`)
const contentLength = (h: Record<string, string>) => Number(h['content-length'] ?? 0)

test('khóa cache trong dist/sw.js: MODELS_KEY là sha256 rút gọn của models.json, BUILD_ID theo dist/assets', () => {
  const manifest = readFileSync(resolve('public/models/models.json'))
  expect(MODELS_KEY).toBe(createHash('sha256').update(manifest).digest('hex').slice(0, 12))
  expect(BUILD_ID).toMatch(/^[0-9a-f]{12}$/)
  expect(sw).not.toContain('__WCT_')
  note(`khóa model ${MODELS_KEY}, build ${BUILD_ID}, base ${BASE}`)
})

test('trang đầu (chặn đăng ký): đặt đồng ý và tạo hai cache wct-* cũ để ca sau kiểm activate xóa chúng', async () => {
  const page = await context.newPage()
  await page.addInitScript(() => {
    navigator.serviceWorker.register = () => new Promise(() => {})
  })
  await page.goto(`${ORIGIN}${BASE}`)
  await page.evaluate(
    async ([k, v]) => {
      localStorage.setItem(k, v)
      for (const name of ['wct-models-000000000000', 'wct-app-000000000000']) {
        const c = await caches.open(name)
        await c.put(new Request(`${location.origin}${location.pathname}cu.txt`), new Response('cu'))
      }
    },
    [CONSENT_KEY, CONSENT_VERSION],
  )
  expect(Object.keys(await dumpCaches(page)).sort()).toEqual([
    'wct-app-000000000000',
    'wct-models-000000000000',
  ])
  expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull()
  await page.close()
})

test('lần mở 1 vào #/app: worker kích hoạt và điều khiển trang, xóa cache cũ, cache đủ model, wasm, loader ORT theo EP và asset của trang', async () => {
  const page = await context.newPage()
  const sizes: Array<[string, number]> = []
  page.on('response', async (res) => {
    const url = res.url()
    if (under(url, 'models/') || under(url, 'assets/'))
      sizes.push([url, contentLength(await res.allHeaders())])
  })
  const ep = await openAndReveal(page)
  expect(['wasm', 'webgpu']).toContain(ep)
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, undefined, {
    timeout: 30_000,
  })
  const wantModels = [
    `models/wasm/vision_wasm_module_internal.js`,
    `models/wasm/vision_wasm_module_internal.wasm`,
    `models/hand_landmarker.task`,
    `models/face_landmarker.task`,
    `models/classifier-stub.onnx`,
  ].map((p) => `${ORIGIN}${BASE}${p}`)
  await expect
    .poll(async () => (await dumpCaches(page))[MODELS_CACHE]?.length ?? 0, { timeout: 60_000 })
    .toBeGreaterThanOrEqual(wantModels.length + 2)
  const dump = await dumpCaches(page)
  expect(Object.keys(dump).sort()).toEqual([APP_CACHE, MODELS_CACHE].sort())
  for (const u of wantModels) expect(dump[MODELS_CACHE]).toContain(u)
  // Loader ORT theo bundle worker đã nạp: asyncify khi có adapter WebGPU (bundle webgpu; EP báo về vẫn có thể là wasm
  // nếu tạo session webgpu lỗi, ví dụ adapter phần mềm trên runner), jsep khi không có adapter. Một cặp trọn phải có.
  const loaderOf = (name: string) =>
    dump[MODELS_CACHE].filter((u) => u.includes(`ort-wasm-simd-threaded.${name}.`)).length
  const loader = loaderOf('asyncify') === 2 ? 'asyncify' : loaderOf('jsep') === 2 ? 'jsep' : 'thiếu'
  expect(loader).not.toBe('thiếu')
  if (ep === 'webgpu') expect(loader).toBe('asyncify')
  expect(dump[APP_CACHE]).toContain(PAGE_KEY)
  expect(dump[APP_CACHE].some((u) => /assets\/index-[\w-]+\.js$/.test(u))).toBe(true)
  expect(dump[APP_CACHE].some((u) => /assets\/face\.worker-[\w-]+\.js$/.test(u))).toBe(true)
  const total = sizes.reduce((a, [, n]) => a + n, 0)
  note(
    `EP ${ep} → loader ${loader}; cache model ${dump[MODELS_CACHE].length} file, cache app ${dump[APP_CACHE].length} file; ` +
      `lần 1 tải ${sizes.length} phản hồi models/ + assets/, ${(total / 1e6).toFixed(1)} MB theo Content-Length`,
  )
  await page.close()
})

test('lần mở 2: trang được điều khiển từ đầu, mọi phản hồi models/ và assets/ đến từ service worker và worker không xin mạng cho chúng (cache hit)', async () => {
  const page = await context.newPage()
  const start = requests.length
  const seen: Array<{ url: string; fromSw: boolean }> = []
  page.on('response', (res) => {
    const url = res.url()
    if (under(url, 'models/') || under(url, 'assets/'))
      seen.push({ url, fromSw: res.fromServiceWorker() })
  })
  const ep = await openAndReveal(page)
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
  const notFromSw = seen.filter((s) => !s.fromSw).map((s) => s.url)
  expect(seen.length).toBeGreaterThanOrEqual(7)
  expect(notFromSw).toEqual([])
  // Yêu cầu do chính service worker phát ra mạng (req.serviceWorker() khác null) trong lần này: chỉ có trang
  // (network-first); models/ và assets/ đều là cache hit nên không có.
  const swNet = requests
    .slice(start)
    .filter((r) => r.serviceWorker() !== null)
    .map((r) => r.url())
  expect(swNet.filter((u) => under(u, 'models/') || under(u, 'assets/'))).toEqual([])
  const mb = seen.length
  note(
    `EP ${ep}; ${mb}/${mb} phản hồi models/ và assets/ từ service worker; worker chỉ ra mạng ${swNet.length} lần (trang): ${swNet.map((u) => u.replace(ORIGIN, '')).join(', ') || 'không'}`,
  )
  await page.close()
})

test('lần mở 3 offline: trang, asset, model và loader ORT từ cache; worker mặt và phân loại sẵn sàng, cửa sổ mở', async () => {
  await context.setOffline(true)
  try {
    const page = await context.newPage()
    const ep = await openAndReveal(page)
    const snap = await page.evaluate(() => ({
      face: window.__wct!.face!.snapshot().ready,
      cls: window.__wct!.classifier!.snapshot().ready,
      reveal: window.__wct!.loop!.snapshot().reveal.kind,
    }))
    expect(snap).toEqual({ face: true, cls: true, reveal: 'open' })
    note(`offline: EP ${ep}, worker mặt và phân loại sẵn sàng, vùng mở`)
    await page.close()
  } finally {
    await context.setOffline(false)
  }
})

test('không yêu cầu nào rời origin của trang trong cả ba lần mở (I9, đo ở context gồm cả service worker)', () => {
  expect(foreign).toEqual([])
  const models = requests.filter((r) => under(r.url(), 'models/')).length
  note(`${requests.length} yêu cầu, ${models} tới models/, 0 khác origin`)
})
