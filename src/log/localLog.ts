// LOG-02 (D-022, D-046): nhật ký vận hành cục bộ, thuần. Chỉ ghi sự kiện metadata (consent, camera, vùng mở, đổi cấu
// hình) với payload ≤ 1 KB JSON; không bao giờ nhận frame, crop, landmark hay ảnh: module này chỉ import kiểu, StagePage
// xây payload từ snapshot chữ và số, và lint:boundaries cấm src/log/** import camera/, mask/, hands/… Kho lưu tiêm vào
// (IndexedDB `wct-log` ở idbStore.ts, bộ nhớ ở đây cho unit test và khi IndexedDB bị chặn). Giới hạn: tối đa 10 000
// bản ghi hoặc 30 ngày, xóa cũ trước, dọn lúc start và mỗi 50 lần ghi. Công tắc mặc định tắt, lưu localStorage
// `wct.log`. Xuất CSV bằng chuỗi; tải xuống do app làm (Blob + <a download>), không có đường mạng (I9).
export type LogEventType =
  | 'consent'
  | 'camera-start'
  | 'camera-stop'
  | 'camera-error'
  | 'reveal-open'
  | 'reveal-close'
  | 'config-change'

export const LOG_EVENT_TYPES: readonly LogEventType[] = [
  'consent',
  'camera-start',
  'camera-stop',
  'camera-error',
  'reveal-open',
  'reveal-close',
  'config-change',
]

/** Chữ hiển thị theo ngôn ngữ nằm trong từ điển (`settings.log.events`, I18N-01). */

export type LogPayload = Record<string, unknown>

export type LogEvent = {
  /** Khóa tự tăng của kho (thiếu khi chưa ghi). */
  id?: number
  /** Thời điểm tường (Date.now) để lọc theo ngày và giữ 30 ngày. */
  ts: number
  type: LogEventType
  payload: LogPayload
}

/** Kho lưu: mọi phương thức bất đồng bộ để IndexedDB và bộ nhớ dùng chung giao diện. */
export type LogStore = {
  append(ev: LogEvent): Promise<number>
  /** Ghi nhiều bản ghi trong một transaction (probe test giới hạn); trả số đã ghi. */
  appendMany(events: readonly LogEvent[]): Promise<number>
  /** Tăng dần theo id (thứ tự ghi). */
  list(): Promise<LogEvent[]>
  count(): Promise<number>
  /** Xóa bản ghi có ts < before; trả số đã xóa. */
  deleteBefore(before: number): Promise<number>
  /** Xóa n bản ghi cũ nhất (id nhỏ nhất); trả số đã xóa. */
  deleteOldest(n: number): Promise<number>
  clear(): Promise<void>
}

export type LogLimits = {
  maxRecords: number
  maxAgeMs: number
  maxPayloadBytes: number
  /** Dọn sau chừng này lần ghi (và lúc start). */
  pruneEvery: number
}

export const LOG_LIMITS: LogLimits = {
  maxRecords: 10_000,
  maxAgeMs: 30 * 24 * 60 * 60 * 1000,
  maxPayloadBytes: 1024,
  pruneEvery: 50,
}

export const LOG_ENABLED_KEY = 'wct.log'

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export function readLogEnabled(storage: StorageLike | null): boolean {
  if (!storage) return false
  try {
    return storage.getItem(LOG_ENABLED_KEY) === '1'
  } catch {
    return false
  }
}

export function writeLogEnabled(storage: StorageLike | null, on: boolean): void {
  if (!storage) return
  try {
    storage.setItem(LOG_ENABLED_KEY, on ? '1' : '0')
  } catch {
    // Storage bị chặn: chỉ giữ trong bộ nhớ.
  }
}

/** localStorage của thiết bị, hoặc null khi không truy cập được. */
export function deviceStore(): StorageLike | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

const encoder = new TextEncoder()

export function payloadBytes(payload: LogPayload): number {
  return encoder.encode(JSON.stringify(payload)).length
}

/** Payload quá maxPayloadBytes thì thay bằng dấu vết (không cắt chuỗi giữa chừng để tránh JSON hỏng). */
export function fitPayload(payload: LogPayload, maxBytes = LOG_LIMITS.maxPayloadBytes): LogPayload {
  if (payloadBytes(payload) <= maxBytes) return payload
  return { truncated: true, keys: Object.keys(payload) }
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Ngày địa phương YYYY-MM-DD của một mốc ts (cùng quy ước với <input type="date">). */
export function localDay(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export type LogFilter = {
  type?: LogEventType | 'all'
  /** YYYY-MM-DD theo giờ địa phương; rỗng là mọi ngày. */
  day?: string
}

export function filterEvents(events: readonly LogEvent[], f: LogFilter = {}): LogEvent[] {
  const type = f.type && f.type !== 'all' ? f.type : null
  const day = f.day || null
  return events.filter((e) => (!type || e.type === type) && (!day || localDay(e.ts) === day))
}

export function csvEscape(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** CSV: ts (ms), time (ISO), type, payload (JSON); mỗi dòng một sự kiện theo thứ tự ghi. */
export function toCsv(events: readonly LogEvent[]): string {
  const lines = ['ts,time,type,payload']
  for (const e of events) {
    lines.push(
      [
        String(e.ts),
        new Date(e.ts).toISOString(),
        e.type,
        csvEscape(JSON.stringify(e.payload)),
      ].join(','),
    )
  }
  return lines.join('\n') + '\n'
}

export type LocalLogSnapshot = {
  enabled: boolean
  /** Số bản ghi trong kho (sau khi dọn). */
  count: number
  lastTs: number | null
  /** Số lần ghi đang chờ kho. */
  pending: number
  storeReady: boolean
  error: string | null
}

export type LocalLog = {
  readonly enabled: boolean
  setEnabled(on: boolean): void
  /** Ghi khi đang bật; trả false khi tắt. Payload quá 1 KB được thay bằng dấu vết. */
  log(type: LogEventType, payload?: LogPayload): boolean
  /** Như log nhưng mỗi loại chỉ ghi một lần trong đời instance (consent lúc mở app; StrictMode chạy effect hai lần). */
  logOnce(type: LogEventType, payload?: LogPayload): boolean
  list(filter?: LogFilter): Promise<LogEvent[]>
  csv(filter?: LogFilter): Promise<string>
  clear(): Promise<void>
  /** Xóa bản ghi quá 30 ngày rồi cắt còn 10 000 (cũ trước). */
  prune(): Promise<void>
  /** Mở kho, đếm, dọn; gọi lại được sau dispose (React StrictMode mount hai lần). */
  start(): Promise<void>
  /** Chờ mọi lần ghi đang chờ xong (test). */
  flush(): Promise<void>
  snapshot(): LocalLogSnapshot
  subscribe(cb: () => void): () => void
  dispose(): void
}

export type LocalLogOptions = {
  store: LogStore | Promise<LogStore>
  storage: StorageLike | null
  now?: () => number
  limits?: Partial<LogLimits>
  /** Gọi ngay sau khi bật (StagePage ghi sự kiện consent). */
  onEnable?: () => void
  onError?: (message: string) => void
}

export function createLocalLog(opts: LocalLogOptions): LocalLog {
  const limits: LogLimits = { ...LOG_LIMITS, ...opts.limits }
  const now = opts.now ?? (() => Date.now())
  const storeP = Promise.resolve(opts.store)
  let store: LogStore | null = null
  let enabled = readLogEnabled(opts.storage)
  let count = 0
  let lastTs: number | null = null
  let pending = 0
  let error: string | null = null
  let sinceProne = 0
  let disposed = false
  let chain: Promise<unknown> = Promise.resolve()
  const listeners = new Set<() => void>()
  const once = new Set<LogEventType>()
  let snap: LocalLogSnapshot = build()

  function build(): LocalLogSnapshot {
    return { enabled, count, lastTs, pending, storeReady: store !== null, error }
  }
  function notify(): void {
    snap = build()
    for (const l of listeners) l()
  }
  function fail(err: unknown): void {
    error = err instanceof Error ? err.message : String(err)
    opts.onError?.(error)
  }
  /** Xếp một thao tác kho vào hàng đợi tuần tự (giữ thứ tự ghi, không chồng transaction). */
  function enqueue<T>(op: (s: LogStore) => Promise<T>): Promise<T | undefined> {
    pending++
    notify()
    const next = chain
      .then(async () => {
        if (disposed) return undefined
        const s = store ?? (store = await storeP)
        return op(s)
      })
      .catch((err) => {
        fail(err)
        return undefined
      })
      .finally(() => {
        pending--
        notify()
      })
    chain = next
    return next
  }

  async function pruneIn(s: LogStore): Promise<void> {
    const removedOld = await s.deleteBefore(now() - limits.maxAgeMs)
    let n = await s.count()
    if (n > limits.maxRecords) {
      await s.deleteOldest(n - limits.maxRecords)
      n = await s.count()
    }
    if (removedOld || n !== count) count = n
    sinceProne = 0
  }

  const api: LocalLog = {
    get enabled() {
      return enabled
    },
    setEnabled(on) {
      if (on === enabled) return
      enabled = on
      writeLogEnabled(opts.storage, on)
      notify()
      if (on) opts.onEnable?.()
    },
    log(type, payload = {}) {
      if (!enabled || disposed) return false
      const ev: LogEvent = { ts: now(), type, payload: fitPayload(payload, limits.maxPayloadBytes) }
      void enqueue(async (s) => {
        await s.append(ev)
        count++
        lastTs = ev.ts
        if (++sinceProne >= limits.pruneEvery) await pruneIn(s)
      })
      return true
    },
    logOnce(type, payload) {
      if (once.has(type)) return false
      const ok = api.log(type, payload)
      if (ok) once.add(type)
      return ok
    },
    list(filter) {
      return enqueue((s) => s.list()).then((all) => filterEvents(all ?? [], filter))
    },
    csv(filter) {
      return api.list(filter).then(toCsv)
    },
    clear() {
      return enqueue(async (s) => {
        await s.clear()
        count = 0
        lastTs = null
        sinceProne = 0
      }).then(() => undefined)
    },
    prune() {
      return enqueue(pruneIn).then(() => undefined)
    },
    start() {
      disposed = false
      return enqueue(async (s) => {
        count = await s.count()
        const all = count ? await s.list() : []
        lastTs = all.length ? all[all.length - 1].ts : null
        await pruneIn(s)
      }).then(() => undefined)
    },
    flush() {
      return chain.then(() => undefined)
    },
    snapshot() {
      return snap
    },
    subscribe(cb) {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    dispose() {
      // Chỉ chặn ghi thêm; listener tự hủy đăng ký (React) và start() mở lại được.
      disposed = true
    },
  }
  return api
}

/** Kho trong bộ nhớ: unit test và dự phòng khi IndexedDB không mở được. */
export function createMemoryLogStore(): LogStore & { readonly events: readonly LogEvent[] } {
  const events: LogEvent[] = []
  let nextId = 1
  return {
    get events() {
      return events
    },
    async append(ev) {
      const id = nextId++
      events.push({ ...ev, id })
      return id
    },
    async appendMany(evs) {
      for (const ev of evs) events.push({ ...ev, id: nextId++ })
      return evs.length
    },
    async list() {
      return events.map((e) => ({ ...e }))
    },
    async count() {
      return events.length
    },
    async deleteBefore(before) {
      const keep = events.filter((e) => e.ts >= before)
      const removed = events.length - keep.length
      events.splice(0, events.length, ...keep)
      return removed
    },
    async deleteOldest(n) {
      const removed = Math.max(0, Math.min(n, events.length))
      events.splice(0, removed)
      return removed
    },
    async clear() {
      events.length = 0
    },
  }
}
