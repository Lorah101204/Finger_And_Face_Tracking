import { describe, expect, it } from 'vitest'
import { installSameOriginGuard, requestOrigin, type GuardScope } from '../../src/core/networkGuard'

// REL-01 (mục 7.27, D-050): fetch của worker và trang chỉ cho cùng origin để thư viện thứ ba (telemetry MediaPipe tới
// odml.pa.googleapis.com) không gửi được gì (I9).
function scope(href = 'https://host.test/repo/#/app') {
  const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = []
  const s: GuardScope & { calls: typeof calls } = {
    calls,
    location: { href, origin: new URL(href).origin },
    fetch: async (input, init) => {
      calls.push([input, init])
      return new Response('ok')
    },
  }
  return s
}

describe('requestOrigin', () => {
  it('chuỗi tuyệt đối, tương đối, URL và Request đều về origin; chuỗi hỏng thì null', () => {
    const base = 'https://host.test/repo/'
    expect(requestOrigin('https://odml.pa.googleapis.com/v1/log', base)).toBe(
      'https://odml.pa.googleapis.com',
    )
    expect(requestOrigin('/models/x.task', base)).toBe('https://host.test')
    expect(requestOrigin('models/x.task', base)).toBe('https://host.test')
    expect(requestOrigin(new URL('https://a.test/x'), base)).toBe('https://a.test')
    expect(requestOrigin(new Request('https://b.test/y'), base)).toBe('https://b.test')
    expect(requestOrigin('http://[bad', base)).toBeNull()
  })
})

describe('installSameOriginGuard', () => {
  it('cùng origin đi qua nguyên vẹn (kể cả tương đối); khác origin bị từ chối TypeError, không gọi fetch gốc', async () => {
    const s = scope()
    const { stats } = installSameOriginGuard(s)
    const init = { method: 'GET' }
    await s.fetch('/repo/models/hand_landmarker.task', init)
    await s.fetch('models/wasm/vision_wasm_module_internal.wasm')
    await s.fetch(new Request('https://host.test/repo/index.html'))
    expect(s.calls).toHaveLength(3)
    expect(s.calls[0]).toEqual(['/repo/models/hand_landmarker.task', init])
    await expect(
      s.fetch('https://odml.pa.googleapis.com/v1/log', { method: 'POST', body: 'x' }),
    ).rejects.toThrow(TypeError)
    await expect(s.fetch(new Request('https://cdn.example/lib.js'))).rejects.toThrow(/I9/)
    await expect(s.fetch('http://[bad')).rejects.toThrow(TypeError)
    expect(s.calls).toHaveLength(3)
    expect(stats).toEqual({
      allowed: 3,
      blocked: [
        'https://odml.pa.googleapis.com/v1/log',
        'https://cdn.example/lib.js',
        'http://[bad',
      ],
    })
  })

  it('cùng host khác giao thức hay cổng là khác origin', async () => {
    const s = scope('http://localhost:5173/')
    installSameOriginGuard(s)
    await s.fetch('http://localhost:5173/models/x')
    await expect(s.fetch('https://localhost:5173/models/x')).rejects.toThrow()
    await expect(s.fetch('http://localhost:5174/models/x')).rejects.toThrow()
    expect(s.calls).toHaveLength(1)
  })

  it('cài lần hai không bọc thêm (cùng bộ đếm); uninstall trả fetch gốc', async () => {
    const s = scope()
    const original = s.fetch
    const a = installSameOriginGuard(s)
    const guarded = s.fetch
    const b = installSameOriginGuard(s)
    expect(s.fetch).toBe(guarded)
    expect(b.stats).toBe(a.stats)
    await s.fetch('/x')
    expect(a.stats.allowed).toBe(1)
    a.uninstall()
    expect(s.fetch).toBe(original)
  })

  it('danh sách URL bị chặn dừng ở 50 mục để không phình bộ nhớ', async () => {
    const s = scope()
    const { stats } = installSameOriginGuard(s)
    for (let i = 0; i < 60; i++) await s.fetch(`https://x${i}.test/`).catch(() => {})
    expect(stats.blocked).toHaveLength(50)
  })
})
