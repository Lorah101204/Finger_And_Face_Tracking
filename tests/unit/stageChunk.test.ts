import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  allowChunkReload,
  CHUNK_RELOAD_KEY,
  createChunkLoader,
  isChunkLoadError,
  prefetch,
  schedulePrefetchWhenIdle,
  type IdleEnv,
} from '../../src/app/stageChunk'

// PERF-03 (mục 7.36, D-063): chunk sân khấu nạp động; trang chào không kéo mã sân khấu vào chunk đầu.

describe('createChunkLoader', () => {
  it('nạp đúng một lần, mọi lần gọi nhận cùng promise', async () => {
    const load = vi.fn(async () => 'stage')
    const get = createChunkLoader(load)
    expect(get()).toBe(get())
    await expect(get()).resolves.toBe('stage')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('nhớ cả lỗi: không nạp lại trong trang (helper preload của Vite sẽ thiếu CSS ở lần thứ hai)', async () => {
    const load = vi.fn(() =>
      Promise.reject(new TypeError('Failed to fetch dynamically imported module')),
    )
    const get = createChunkLoader(load)
    await expect(get()).rejects.toThrow(/dynamically imported module/)
    await expect(get()).rejects.toThrow()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('prefetch nuốt lỗi (lỗi thật hiện ra lúc vào sân khấu)', async () => {
    const load = vi.fn(() => Promise.reject(new Error('offline')))
    expect(() => prefetch(load)).not.toThrow()
    await Promise.resolve()
    expect(load).toHaveBeenCalledTimes(1)
  })
})

function fakeEnv(over: Partial<IdleEnv> = {}) {
  const calls: string[] = []
  let loadCb: (() => void) | null = null
  const env: IdleEnv = {
    readyState: () => 'interactive',
    onLoad: (cb) => {
      loadCb = cb
      calls.push('onLoad')
      return () => calls.push('offLoad')
    },
    requestIdle: (cb, opts) => {
      calls.push(`idle:${opts.timeout}`)
      cb()
      return 7
    },
    cancelIdle: (id) => calls.push(`cancelIdle:${id}`),
    setTimeout: (cb, ms) => {
      calls.push(`timeout:${ms}`)
      cb()
      return 9
    },
    clearTimeout: (id) => calls.push(`clear:${id}`),
    saveData: () => false,
    ...over,
  }
  return { env, calls, fireLoad: () => loadCb?.() }
}

describe('schedulePrefetchWhenIdle', () => {
  it('đợi sự kiện load rồi chạy lúc rảnh (requestIdleCallback tối đa 2 s)', () => {
    const run = vi.fn()
    const { env, calls, fireLoad } = fakeEnv()
    schedulePrefetchWhenIdle(run, env)
    expect(run).not.toHaveBeenCalled()
    fireLoad()
    expect(run).toHaveBeenCalledTimes(1)
    expect(calls).toEqual(['onLoad', 'idle:2000'])
  })

  it('trang đã load xong thì lên lịch ngay; không có requestIdleCallback thì setTimeout', () => {
    const run = vi.fn()
    const { env, calls } = fakeEnv({ readyState: () => 'complete', requestIdle: undefined })
    schedulePrefetchWhenIdle(run, env)
    expect(run).toHaveBeenCalledTimes(1)
    expect(calls).toEqual(['timeout:200'])
  })

  it('Save-Data: không nạp trước', () => {
    const run = vi.fn()
    const { env, calls, fireLoad } = fakeEnv({ saveData: () => true })
    schedulePrefetchWhenIdle(run, env)
    fireLoad()
    expect(run).not.toHaveBeenCalled()
    expect(calls).toEqual([])
  })

  it('hàm hủy gỡ listener load trước khi kịp chạy', () => {
    const run = vi.fn()
    const { env, calls } = fakeEnv()
    const cancel = schedulePrefetchWhenIdle(run, env)
    cancel()
    expect(calls).toEqual(['onLoad', 'offLoad'])
    expect(run).not.toHaveBeenCalled()
  })
})

describe('lỗi nạp chunk', () => {
  it('nhận ra lỗi import động của Chrome, Firefox, Safari và CSS preload của Vite', () => {
    expect(
      isChunkLoadError(
        new TypeError('Failed to fetch dynamically imported module: /assets/StagePage-x.js'),
      ),
    ).toBe(true)
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true)
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isChunkLoadError(new Error('Unable to preload CSS for /assets/StagePage-x.css'))).toBe(
      true,
    )
    expect(isChunkLoadError(new Error('Cannot read properties of null'))).toBe(false)
  })

  it('allowChunkReload: tối đa một lần mỗi 30 s, storage lỗi thì không tải lại', () => {
    const map = new Map<string, string>()
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    }
    expect(allowChunkReload(100_000, storage)).toBe(true)
    expect(map.get(CHUNK_RELOAD_KEY)).toBe('100000')
    expect(allowChunkReload(110_000, storage)).toBe(false)
    expect(allowChunkReload(131_000, storage)).toBe(true)
    const broken = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {},
    }
    expect(allowChunkReload(1, broken)).toBe(false)
  })
})

/** Đồ thị import tĩnh (bỏ import chỉ-type) từ một file trong src/. */
function staticGraph(entry: string): Set<string> {
  const exts = ['', '.ts', '.tsx', '/index.ts']
  const resolveSpec = (from: string, spec: string) => {
    if (!spec.startsWith('.')) return null
    const base = resolve(dirname(from), spec)
    for (const e of exts) if (existsSync(base + e) && statSync(base + e).isFile()) return base + e
    return null
  }
  const typeOnly = (clause: string) => {
    const c = clause.trim()
    if (!c.startsWith('{')) return false
    const names = c
      .slice(1, -1)
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean)
    return names.length > 0 && names.every((n) => n.startsWith('type '))
  }
  const seen = new Set<string>()
  const stack = [resolve(entry)]
  while (stack.length) {
    const f = stack.pop()!
    if (seen.has(f)) continue
    seen.add(f)
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(
      /^\s*(?:import|export)\s+(type\s+)?([\s\S]*?)\s*from\s*['"]([^'"]+)['"]/gm,
    )) {
      if (m[1] || typeOnly(m[2])) continue
      const r = resolveSpec(f, m[3])
      if (r) stack.push(r)
    }
    for (const m of src.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) {
      const r = resolveSpec(f, m[1])
      if (r) stack.push(r)
    }
  }
  return seen
}

describe('tách chunk (D-063)', () => {
  it('đồ thị tĩnh từ main.tsx không chứa mã sân khấu; chỉ một import() động tới StagePage', () => {
    const root = resolve('src')
    const mods = [...staticGraph('src/main.tsx')].map((f) => relative(root, f).split(sep).join('/'))
    for (const banned of [
      /^app\/pages\/StagePage/,
      /^camera\//,
      /^loop\//,
      /^debug\//,
      /^dataset\//,
      /^log\//,
      /^face\//,
      /^hands\//,
      /^reveal\//,
      /^classify\/classifierClient/,
      /^mask\/(compositor|restrictedFrame|logoLayer)/,
      /^app\/guidance\.ts$/,
    ])
      expect(
        mods.filter((m) => banned.test(m)),
        String(banned),
      ).toEqual([])
    expect(mods).toContain('app/pages/LandingPage.tsx')
    expect(mods).toContain('app/session.ts')
    expect(mods).toContain('core/i18n/vi.ts')
    expect(mods).toContain('core/i18n/en.ts')
    // Mọi file trong src/: đúng một import (tĩnh hay động) tới pages/StagePage, và nó là import() trong stageLoader.ts.
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = resolve(dir, name)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.(ts|tsx)$/.test(name) && !/StagePage\.tsx$/.test(name)) {
          const code = readFileSync(p, 'utf8')
          for (const m of code.matchAll(/(?:import\(|from )\s*'[^']*pages\/StagePage'/g))
            hits.push(`${relative(resolve('src'), p).split(sep).join('/')}: ${m[0]}`)
        }
      }
    }
    walk(resolve('src'))
    expect(hits).toEqual(["app/stageLoader.ts: import('./pages/StagePage'"])
    expect(readFileSync(resolve('src/app/AppRouter.tsx'), 'utf8')).not.toMatch(
      /from '\.\/pages\/StagePage'/,
    )
    // palette và guideSteps là lá: không kéo gì nặng.
    expect([...staticGraph('src/mask/palette.ts')]).toHaveLength(1)
    expect([...staticGraph('src/app/guideSteps.ts')]).toHaveLength(1)
  })
})
