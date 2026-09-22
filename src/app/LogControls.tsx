import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  LOG_EVENT_TYPES,
  localDay,
  type LocalLog,
  type LogEvent,
  type LogEventType,
} from '../log/localLog'
import { HelpTip } from './HelpTip'
import { useStrings } from './useLang'

// LOG-02 (D-022, D-046): mục nhật ký cục bộ trong cột cài đặt: công tắc (mặc định tắt, lưu localStorage), số bản
// ghi, bảng xem tại chỗ (lọc theo loại và ngày, mới nhất trước, tối đa 200 dòng), Xuất CSV (Blob + <a download>
// qua props.download, không có đường mạng, I9) và Xóa nhật ký (nút danger, UX-03). Trạng thái bật/tắt cũng hiện ở
// thanh trên (StagePage). UX-05: nút "?" cạnh công tắc mang chú thích (settings.help.log.toggle).
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
  const strings = useStrings().settings
  const l = strings.log

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
        {l.title}
        <span className="hint" data-testid="log-count">
          {l.count(snap.count)}
          {snap.pending ? l.pending(snap.pending) : ''}
        </span>
      </h3>
      <div className="acts">
        <span className="with-help">
          <label className="check">
            <input
              type="checkbox"
              aria-label={l.toggle}
              checked={snap.enabled}
              onChange={(e) => log.setEnabled(e.target.checked)}
            />
            {l.toggle}
          </label>
          <HelpTip id="log" text={strings.help.log.toggle} />
        </span>
      </div>
      <div className="acts">
        <button
          type="button"
          className="sm"
          aria-expanded={open}
          aria-controls="log-view"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? l.hide : l.show}
        </button>
        <button
          type="button"
          className="sm"
          disabled={snap.count === 0}
          onClick={() => void exportCsv()}
        >
          {l.exportCsv}
        </button>
        <button
          type="button"
          className="sm danger"
          disabled={snap.count === 0}
          onClick={() => void log.clear()}
        >
          {l.clear}
        </button>
      </div>
      {snap.error && (
        <span className="error" role="alert">
          {l.error(snap.error)}
        </span>
      )}
      {open && (
        <div className="log-view" id="log-view" data-testid="log-view">
          <div className="cols2">
            <div className="lbl">
              <span>{l.typeFilter}</span>
              <select
                aria-label={l.typeFilterAria}
                value={type}
                onChange={(e) => setType(e.target.value as LogEventType | 'all')}
              >
                <option value="all">{l.all}</option>
                {LOG_EVENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {l.events[t]} ({t})
                  </option>
                ))}
              </select>
            </div>
            <div className="lbl">
              <span>{l.dayFilter}</span>
              <input
                type="date"
                aria-label={l.dayFilterAria}
                value={day}
                onChange={(e) => setDay(e.target.value)}
              />
            </div>
          </div>
          <table className="log-table" data-testid="log-table">
            <thead>
              <tr>
                <th>{l.colTime}</th>
                <th>{l.colType}</th>
                <th>{l.colDetail}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id ?? e.ts} data-type={e.type}>
                  <td>{timeText(e.ts)}</td>
                  <td>{l.events[e.type]}</td>
                  <td>
                    <code>{JSON.stringify(e.payload)}</code>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    {l.empty}
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
