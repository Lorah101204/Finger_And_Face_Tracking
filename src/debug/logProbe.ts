// LOG-02: window.__wct.log cho e2e: đọc snapshot, danh sách, CSV; xóa và dọn; ghi thẳng vào kho (appendRaw) để kiểm
// giới hạn 30 ngày và 10 000 bản ghi mà không chờ thật. Chỉ trong trang, không gửi đi đâu (I9).
import type { LocalLog, LogEvent, LogFilter, LogStore } from '../log/localLog'
import { wct } from './wctGlobal'

export type LogProbe = {
  snapshot: LocalLog['snapshot']
  list: (filter?: LogFilter) => Promise<LogEvent[]>
  csv: (filter?: LogFilter) => Promise<string>
  clear: () => Promise<void>
  prune: () => Promise<void>
  flush: () => Promise<void>
  /** Ghi thẳng vào kho, bỏ qua công tắc và giới hạn (test giới hạn). */
  appendRaw: (events: LogEvent[]) => Promise<number>
}

export function installLogProbe(log: LocalLog, store: Promise<LogStore>): () => void {
  const g = wct()
  const probe: LogProbe = {
    snapshot: () => log.snapshot(),
    list: (f) => log.list(f),
    csv: (f) => log.csv(f),
    clear: () => log.clear(),
    prune: () => log.prune(),
    flush: () => log.flush(),
    appendRaw: async (events) => {
      const s = await store
      const n = await s.appendMany(events)
      await log.start()
      return n
    },
  }
  g.log = probe
  return () => {
    if (g.log === probe) delete g.log
  }
}
