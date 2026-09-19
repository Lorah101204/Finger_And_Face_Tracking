// LOG-02: kho IndexedDB `wct-log` (object store `events`, khóa tự tăng, index `ts`) cho localLog.ts. Chỉ chạy trong
// trình duyệt; mỗi phương thức một transaction; không có đường mạng (I9). Không mở được (bị chặn, chế độ riêng tư lạ)
// thì app dùng createMemoryLogStore của localLog.ts.
import type { LogEvent, LogStore } from './localLog'

export const LOG_DB_NAME = 'wct-log'
export const LOG_STORE_NAME = 'events'
const DB_VERSION = 1

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error ?? new Error('IndexedDB lỗi'))
  })
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction lỗi'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction bị hủy'))
  })
}

export function idbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null
  } catch {
    return false
  }
}

export async function openIdbLogStore(
  name = LOG_DB_NAME,
  storeName = LOG_STORE_NAME,
): Promise<LogStore> {
  if (!idbAvailable()) throw new Error('IndexedDB không có')
  const open = indexedDB.open(name, DB_VERSION)
  open.onupgradeneeded = () => {
    const db = open.result
    if (!db.objectStoreNames.contains(storeName)) {
      const os = db.createObjectStore(storeName, { keyPath: 'id', autoIncrement: true })
      os.createIndex('ts', 'ts', { unique: false })
    }
  }
  const db = await req(open)
  const rw = () => db.transaction(storeName, 'readwrite')
  const ro = () => db.transaction(storeName, 'readonly')

  /** Duyệt cursor và xóa từng bản ghi tới khi hết hoặc đủ n. */
  function deleteByCursor(
    source: IDBObjectStore | IDBIndex,
    range: IDBKeyRange | null,
    max: number,
  ) {
    return new Promise<number>((resolve, reject) => {
      let removed = 0
      if (max <= 0) return resolve(0)
      const c = source.openCursor(range)
      c.onerror = () => reject(c.error ?? new Error('IndexedDB cursor lỗi'))
      c.onsuccess = () => {
        const cur = c.result
        if (!cur || removed >= max) return resolve(removed)
        cur.delete()
        removed++
        cur.continue()
      }
    })
  }

  return {
    async append(ev: LogEvent) {
      const tx = rw()
      const { id: _drop, ...rest } = ev
      void _drop
      const id = (await req(tx.objectStore(storeName).add(rest))) as number
      await done(tx)
      return id
    },
    async appendMany(events) {
      const tx = rw()
      const os = tx.objectStore(storeName)
      for (const ev of events) {
        const { id: _drop, ...rest } = ev
        void _drop
        os.add(rest)
      }
      await done(tx)
      return events.length
    },
    async list() {
      const tx = ro()
      const rows = (await req(tx.objectStore(storeName).getAll())) as LogEvent[]
      await done(tx)
      return rows
    },
    async count() {
      const tx = ro()
      const n = await req(tx.objectStore(storeName).count())
      await done(tx)
      return n
    },
    async deleteBefore(before) {
      const tx = rw()
      const idx = tx.objectStore(storeName).index('ts')
      const removed = await deleteByCursor(idx, IDBKeyRange.upperBound(before, true), Infinity)
      await done(tx)
      return removed
    },
    async deleteOldest(n) {
      const tx = rw()
      const removed = await deleteByCursor(tx.objectStore(storeName), null, n)
      await done(tx)
      return removed
    },
    async clear() {
      const tx = rw()
      await req(tx.objectStore(storeName).clear())
      await done(tx)
    },
  }
}
