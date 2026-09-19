import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  LOG_EVENT_TEXT,
  LOG_EVENT_TYPES,
  localDay,
  type LocalLog,
  type LogEvent,
  type LogEventType,
} from '../log/localLog'

// LOG-02 (D-022, D-046): mục nhật ký cục bộ trong cột cài đặt: công tắc (mặc định tắt, lưu localStorage), số bản
// ghi, bảng xem tại chỗ (lọc theo loại và ngày, mới nhất trước, tối đa 200 dòng), Xuất CSV (Blob + <a download>
// qua props.download, không có đường mạng, I9) và Xóa nhật ký (nút danger, UX-03). Trạng thái bật/tắt cũng hiện ở
// thanh trên (StagePage).
export type LogControlsProps = {
  log: LocalLog
  download: (bytes: Uint8Array, name: string, type?: string) => void
}

const MAX_ROWS = 200
const encoder = new TextEncoder()

const pad2 = (n: number) => String(n).padStart(2, '0')
function timeText(ts: number): string {
  const d = new Date(ts)
  return `${localDay(ts)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

export function LogControls({ log, download }: LogControlsProps) {
  const snap = useSyncExternalStore(log.subscribe, log.snapshot)
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<LogEventType | 'all'>('all')
  const [day, setDay] = useState('')
  const [rows, setRows] = useState<LogEvent[]>([])

  // Bảng chỉ đọc kho khi đang mở; đọc lại khi bộ lọc hay số bản ghi đổi (kết quả về bất đồng bộ).
  useEffect(() => {
    if (!open) return
    let alive = true
    void log.list({ type, day }).then((all) => {
      if (alive) setRows(all.slice(-MAX_ROWS).reverse())
    })
    return () => {
      alive = false
    }
  }, [open, type, day, log, snap.count])

  async function exportCsv(): Promise<void> {
    const csv = await log.csv()
    download(encoder.encode(csv), `wct-log-${localDay(Date.now())}.csv`, 'text/csv')
  }

  return (
    <section className="sec" data-testid="log-bar">
      <h3>
        Nhật ký cục bộ
        <span className="hint" data-testid="log-count">
          {snap.count} bản ghi{snap.pending ? ` (đang ghi ${snap.pending})` : ''}
        </span>
      </h3>
      <div className="acts">
        <label className="check">
          <input
            type="checkbox"
            aria-label="Ghi nhật ký cục bộ"
            checked={snap.enabled}
            onChange={(e) => log.setEnabled(e.target.checked)}
          />
          Ghi nhật ký cục bộ
        </label>
      </div>
      <div className="acts">
        <button
          type="button"
          className="sm"
          aria-expanded={open}
          aria-controls="log-view"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? 'Ẩn nhật ký' : 'Xem nhật ký'}
        </button>
        <button
          type="button"
          className="sm"
          disabled={snap.count === 0}
          onClick={() => void exportCsv()}
        >
          Xuất CSV
        </button>
        <button
          type="button"
          className="sm danger"
          disabled={snap.count === 0}
          onClick={() => void log.clear()}
        >
          Xóa nhật ký
        </button>
      </div>
      {snap.error && (
        <span className="error" role="alert">
          nhật ký lỗi: {snap.error}
        </span>
      )}
      {open && (
        <div className="log-view" id="log-view" data-testid="log-view">
          <div className="cols2">
            <div className="lbl">
              <span>Loại</span>
              <select
                aria-label="Lọc loại"
                value={type}
                onChange={(e) => setType(e.target.value as LogEventType | 'all')}
              >
                <option value="all">tất cả</option>
                {LOG_EVENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {LOG_EVENT_TEXT[t]} ({t})
                  </option>
                ))}
              </select>
            </div>
            <div className="lbl">
              <span>Ngày</span>
              <input
                type="date"
                aria-label="Lọc ngày"
                value={day}
                onChange={(e) => setDay(e.target.value)}
              />
            </div>
          </div>
          <table className="log-table" data-testid="log-table">
            <thead>
              <tr>
                <th>Thời điểm</th>
                <th>Loại</th>
                <th>Chi tiết</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id ?? e.ts} data-type={e.type}>
                  <td>{timeText(e.ts)}</td>
                  <td>{LOG_EVENT_TEXT[e.type]}</td>
                  <td>
                    <code>{JSON.stringify(e.payload)}</code>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    không có bản ghi
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
