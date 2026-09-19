import { describe, expect, it } from 'vitest'
import {
  pickWarmAssets,
  registerServiceWorker,
  serviceWorkerUrl,
  warmServiceWorker,
  type SwEnv,
} from '../../src/app/registerSw'

// REL-01 (mục 7.27, D-050): đăng ký service worker chỉ ở bản build, sau load, scope là base; warm gửi danh sách file
// đã nạp thật cho worker đang hoạt động.
function env(over: Partial<SwEnv> = {}) {
  const registered: Array<[string, { scope?: string } | undefined]> = []
  const posted: unknown[] = []
  const active = { postMessage: (m: unknown) => posted.push(m) }
  const e: SwEnv & { registered: typeof registered; posted: typeof posted } = {
    registered,
    posted,
    prod: true,
    base: '/repo/',
    loaded: Promise.resolve(),
    container: {
      register: async (url, opts) => void registered.push([url, opts]),
      ready: Promise.resolve({ active }),
    },
    ...over,
  }
  return e
}

describe('serviceWorkerUrl', () => {
  it('ghép sw.js vào base, base thiếu gạch cuối vẫn đúng', () => {
    expect(serviceWorkerUrl('/')).toBe('/sw.js')
    expect(serviceWorkerUrl('/repo/')).toBe('/repo/sw.js')
    expect(serviceWorkerUrl('/repo')).toBe('/repo/sw.js')
  })
})

describe('registerServiceWorker', () => {
  it('bản build có navigator.serviceWorker: đăng ký sau load với url và scope theo base', async () => {
    let loaded = false
    const e = env({
      loaded: new Promise((r) =>
        setTimeout(() => {
          loaded = true
          r()
        }, 0),
      ),
    })
    const p = registerServiceWorker(e)
    expect(e.registered).toHaveLength(0)
    expect(await p).toBe(true)
    expect(loaded).toBe(true)
    expect(e.registered).toEqual([['/repo/sw.js', { scope: '/repo/' }]])
  })

  it('dev, không hỗ trợ hay register ném lỗi: trả false, không ném', async () => {
    expect(await registerServiceWorker(env({ prod: false }))).toBe(false)
    expect(await registerServiceWorker(env({ container: null }))).toBe(false)
    const e = env({
      container: {
        register: async () => {
          throw new Error('SecurityError')
        },
        ready: new Promise(() => {}),
      },
    })
    expect(await registerServiceWorker(e)).toBe(false)
  })
})

describe('pickWarmAssets', () => {
  it('lấy URL trang (không hash, không query) và các asset dưới base/assets/, bỏ trùng và bỏ thứ khác', () => {
    const entries = [
      { name: 'https://host.test/repo/assets/index-abc.js' },
      { name: 'https://host.test/repo/assets/index-abc.js' },
      { name: 'https://host.test/repo/assets/index-def.css' },
      { name: 'https://host.test/repo/assets/face.worker-123.js#x' },
      { name: 'https://host.test/repo/models/hand_landmarker.task' },
      { name: 'https://host.test/other/assets/x.js' },
      { name: 'https://cdn.example/assets/y.js' },
    ]
    expect(pickWarmAssets(entries, 'https://host.test/repo/#/app?debug=1', '/repo/')).toEqual([
      'https://host.test/repo/',
      'https://host.test/repo/assets/index-abc.js',
      'https://host.test/repo/assets/index-def.css',
      'https://host.test/repo/assets/face.worker-123.js',
    ])
    expect(pickWarmAssets([], 'https://host.test/#/', '/')).toEqual(['https://host.test/'])
  })
})

describe('warmServiceWorker', () => {
  it('gửi { type: warm, urls } cho worker đang hoạt động; dev, danh sách rỗng hay chưa có worker thì false', async () => {
    const e = env()
    expect(await warmServiceWorker(['/repo/models/a.task', '/repo/assets/b.js'], e)).toBe(true)
    expect(e.posted).toEqual([{ type: 'warm', urls: ['/repo/models/a.task', '/repo/assets/b.js'] }])
    expect(await warmServiceWorker([], e)).toBe(false)
    expect(await warmServiceWorker(['/x'], env({ prod: false }))).toBe(false)
    expect(await warmServiceWorker(['/x'], env({ container: null }))).toBe(false)
    const noActive = env({
      container: { register: async () => {}, ready: Promise.resolve({ active: null }) },
    })
    expect(await warmServiceWorker(['/x'], noActive)).toBe(false)
  })
})
