import { describe, expect, it } from 'vitest'
import {
  LOG_ENABLED_KEY,
  LOG_EVENT_TYPES,
  createLocalLog,
  createMemoryLogStore,
  csvEscape,
  filterEvents,
  fitPayload,
  localDay,
  payloadBytes,
  readLogEnabled,
  toCsv,
  type LogEvent,
  type LogStore,
  type StorageLike,
} from '../../src/log/localLog'

// LOG-02 (mục 7.25): lõi nhật ký thuần với kho bộ nhớ và storage giả.
function memStorage(
  init: Record<string, string> = {},
): StorageLike & { data: Record<string, string> } {
  const data = { ...init }
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v
    },
  }
}

const DAY = 24 * 60 * 60 * 1000
const T0 = Date.UTC(2026, 8, 19, 3, 0, 0)

describe('công tắc và storage', () => {
  it('mặc định tắt; chỉ "1" là bật; storage null hay ném lỗi → tắt và ghi không ném', () => {
    expect(readLogEnabled(null)).toBe(false)
    expect(readLogEnabled(memStorage())).toBe(false)
    expect(readLogEnabled(memStorage({ [LOG_ENABLED_KEY]: '0' }))).toBe(false)
    expect(readLogEnabled(memStorage({ [LOG_ENABLED_KEY]: '1' }))).toBe(true)
    const bad: StorageLike = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(readLogEnabled(bad)).toBe(false)
    const log = createLocalLog({ store: createMemoryLogStore(), storage: bad })
    expect(() => log.setEnabled(true)).not.toThrow()
    expect(log.enabled).toBe(true)
  })

  it('setEnabled ghi storage, gọi onEnable khi bật và thông báo listener', () => {
    const storage = memStorage()
    let enabled = 0
    let notified = 0
    const log = createLocalLog({
      store: createMemoryLogStore(),
      storage,
      onEnable: () => enabled++,
    })
    log.subscribe(() => notified++)
    log.setEnabled(true)
    expect(storage.data[LOG_ENABLED_KEY]).toBe('1')
    expect(enabled).toBe(1)
    expect(notified).toBe(1)
    log.setEnabled(true)
    expect(enabled).toBe(1)
    log.setEnabled(false)
    expect(storage.data[LOG_ENABLED_KEY]).toBe('0')
    expect(enabled).toBe(1)
    expect(log.snapshot().enabled).toBe(false)
  })
})

describe('payload', () => {
  it('fitPayload giữ payload ≤ 1 KB và thay payload lớn bằng dấu vết có tên khóa', () => {
    const small = { a: 1, b: 'x' }
    expect(fitPayload(small)).toBe(small)
    const big = { data: 'y'.repeat(2000), n: 1 }
    expect(payloadBytes(big)).toBeGreaterThan(1024)
    expect(fitPayload(big)).toEqual({ truncated: true, keys: ['data', 'n'] })
    expect(payloadBytes(fitPayload(big))).toBeLessThan(100)
    expect(payloadBytes({ s: 'ă' })).toBe(JSON.stringify({ s: 'ă' }).length + 1)
  })
})

describe('ghi, giới hạn và dọn', () => {
  it('tắt thì không ghi; bật thì ghi theo thứ tự với ts của now, đếm và lastTs cập nhật', async () => {
    let t = T0
    const store = createMemoryLogStore()
    const log = createLocalLog({ store, storage: memStorage(), now: () => t })
    expect(log.log('consent', { version: 'v' })).toBe(false)
    await log.flush()
    expect(store.events).toHaveLength(0)
    log.setEnabled(true)
    expect(log.log('consent', { version: 'v' })).toBe(true)
    t += 10
    log.log('camera-start', { width: 1280 })
    await log.flush()
    expect(store.events.map((e) => [e.id, e.ts, e.type])).toEqual([
      [1, T0, 'consent'],
      [2, T0 + 10, 'camera-start'],
    ])
    expect(log.snapshot()).toMatchObject({ count: 2, lastTs: T0 + 10, pending: 0, error: null })
  })

  it('start đếm kho có sẵn, xóa bản ghi quá 30 ngày và cắt còn maxRecords (cũ trước)', async () => {
    const store = createMemoryLogStore()
    await store.append({ ts: T0 - 31 * DAY, type: 'consent', payload: {} })
    await store.append({ ts: T0 - 29 * DAY, type: 'consent', payload: {} })
    await store.appendMany(
      Array.from({ length: 12 }, (_, i) => ({
        ts: T0 - 1000 + i,
        type: 'reveal-open' as const,
        payload: { i },
      })),
    )
    const log = createLocalLog({
      store,
      storage: memStorage({ [LOG_ENABLED_KEY]: '1' }),
      now: () => T0,
      limits: { maxRecords: 10 },
    })
    await log.start()
    expect(store.events).toHaveLength(10)
    expect(store.events[0].ts).toBe(T0 - 1000 + 2)
    expect(log.snapshot()).toMatchObject({ count: 10, lastTs: T0 - 1000 + 11, storeReady: true })
  })

  it('dọn tự động sau pruneEvery lần ghi; clear về 0; prune() gọi được bất kỳ lúc nào', async () => {
    let t = T0
    const store = createMemoryLogStore()
    const log = createLocalLog({
      store,
      storage: memStorage({ [LOG_ENABLED_KEY]: '1' }),
      now: () => t,
      limits: { maxRecords: 5, pruneEvery: 3 },
    })
    for (let i = 0; i < 8; i++) {
      t += 1
      log.log('config-change', { i })
    }
    await log.flush()
    // 8 lần ghi: dọn ở lần 3 (3 ≤ 5, giữ) và lần 6 (6 → 5), rồi 2 lần nữa → 7 bản ghi.
    expect(store.events).toHaveLength(7)
    expect(log.snapshot().count).toBe(7)
    await log.prune()
    expect(store.events).toHaveLength(5)
    expect(store.events.map((e) => e.payload.i)).toEqual([3, 4, 5, 6, 7])
    await log.clear()
    expect(store.events).toHaveLength(0)
    expect(log.snapshot()).toMatchObject({ count: 0, lastTs: null })
  })

  it('kho là Promise: ghi chờ kho mở; kho ném lỗi thì snapshot.error và onError, không ném ra ngoài', async () => {
    let resolveStore!: (s: LogStore) => void
    const store = createMemoryLogStore()
    const log = createLocalLog({
      store: new Promise<LogStore>((r) => (resolveStore = r)),
      storage: memStorage({ [LOG_ENABLED_KEY]: '1' }),
    })
    log.log('camera-stop', { reason: 'user' })
    expect(log.snapshot().pending).toBe(1)
    resolveStore(store)
    await log.flush()
    expect(store.events).toHaveLength(1)
    expect(log.snapshot().storeReady).toBe(true)

    const errors: string[] = []
    const broken: LogStore = {
      ...store,
      append: async () => {
        throw new Error('quota')
      },
      appendMany: async () => {
        throw new Error('quota')
      },
    }
    const log2 = createLocalLog({
      store: broken,
      storage: memStorage({ [LOG_ENABLED_KEY]: '1' }),
      onError: (m) => errors.push(m),
    })
    log2.log('consent')
    await log2.flush()
    expect(errors).toEqual(['quota'])
    expect(log2.snapshot()).toMatchObject({ error: 'quota', pending: 0 })
  })

  it('logOnce: mỗi loại một lần trong đời instance, không tính lần bị tắt', async () => {
    const store = createMemoryLogStore()
    const log = createLocalLog({ store, storage: memStorage() })
    expect(log.logOnce('consent', { v: 1 })).toBe(false)
    log.setEnabled(true)
    expect(log.logOnce('consent', { v: 1 })).toBe(true)
    expect(log.logOnce('consent', { v: 2 })).toBe(false)
    expect(log.log('consent', { v: 3 })).toBe(true)
    await log.flush()
    expect(store.events.map((e) => e.payload.v)).toEqual([1, 3])
  })

  it('dispose: không ghi thêm và không gọi listener; start() mở lại', async () => {
    const store = createMemoryLogStore()
    const log = createLocalLog({ store, storage: memStorage({ [LOG_ENABLED_KEY]: '1' }) })
    let n = 0
    log.subscribe(() => n++)
    log.dispose()
    expect(log.log('consent')).toBe(false)
    await log.flush()
    expect(store.events).toHaveLength(0)
    expect(n).toBe(0)
    await log.start()
    expect(log.log('consent')).toBe(true)
    await log.flush()
    expect(store.events).toHaveLength(1)
  })
})

describe('lọc và CSV', () => {
  const events: LogEvent[] = [
    { id: 1, ts: T0, type: 'consent', payload: { version: '2026-09-17' } },
    { id: 2, ts: T0 + DAY, type: 'reveal-open', payload: { epoch: 3, note: 'a,b' } },
    { id: 3, ts: T0 + DAY + 1, type: 'reveal-close', payload: { reason: 'user', q: 'say "hi"' } },
  ]

  it('filterEvents theo loại và ngày địa phương; localDay dùng giờ địa phương', () => {
    expect(filterEvents(events).map((e) => e.id)).toEqual([1, 2, 3])
    expect(filterEvents(events, { type: 'all' })).toHaveLength(3)
    expect(filterEvents(events, { type: 'reveal-open' }).map((e) => e.id)).toEqual([2])
    const day2 = localDay(T0 + DAY)
    expect(day2).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(filterEvents(events, { day: day2 }).map((e) => e.id)).toEqual([2, 3])
    expect(filterEvents(events, { day: day2, type: 'reveal-close' }).map((e) => e.id)).toEqual([3])
    expect(filterEvents(events, { day: '1999-01-01' })).toEqual([])
    const d = new Date(T0 + DAY)
    expect(localDay(T0 + DAY)).toBe(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    )
  })

  it('toCsv: tiêu đề, mỗi dòng ts, ISO, loại, JSON payload được bọc và thoát dấu nháy', () => {
    expect(csvEscape('plain')).toBe('plain')
    expect(csvEscape('a,b')).toBe('"a,b"')
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""')
    expect(csvEscape('x\ny')).toBe('"x\ny"')
    const csv = toCsv(events)
    const lines = csv.split('\n')
    expect(lines[0]).toBe('ts,time,type,payload')
    expect(lines[1]).toBe(
      `${T0},${new Date(T0).toISOString()},consent,"{""version"":""2026-09-17""}"`,
    )
    expect(lines[2]).toBe(
      `${T0 + DAY},${new Date(T0 + DAY).toISOString()},reveal-open,"{""epoch"":3,""note"":""a,b""}"`,
    )
    expect(lines[3]).toContain('reveal-close,"{""reason"":""user"",""q"":""say \\""hi\\""""}"')
    expect(lines[4]).toBe('')
    expect(toCsv([])).toBe('ts,time,type,payload\n')
    for (const t of LOG_EVENT_TYPES) expect(t).toMatch(/^[a-z-]+$/)
  })
})
