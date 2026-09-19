import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { ApiError, api, type AdminEventRow, type AdminSessionRow, type DayStats } from '../api'

type Me = { username: string | null }

// ADM-01: đăng nhập admin, bảng phiên, chi tiết sự kiện, thống kê theo ngày, xuất CSV. Làm mới mỗi 10 giây.
export function AdminPage() {
  const [me, setMe] = useState<Me | null | 'loading'>('loading')
  useEffect(() => {
    api
      .adminMe()
      .then((m) => setMe(m))
      .catch(() => setMe(null))
  }, [])
  if (me === 'loading') {
    return (
      <main className="page">
        <p>Đang kiểm tra đăng nhập.</p>
      </main>
    )
  }
  if (!me) return <LoginForm onLoggedIn={(m) => setMe(m)} />
  return <Dashboard username={me.username ?? ''} onLogout={() => setMe(null)} />
}

function LoginForm({ onLoggedIn }: { onLoggedIn: (m: Me) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const r = await api.adminLogin(username, password)
      onLoggedIn({ username: r.username })
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setError('Sai tài khoản hoặc mật khẩu.')
      else if (err instanceof ApiError && err.status === 429) setError('Thử lại sau một phút.')
      else setError(`Lỗi: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page">
      <h1>Quản trị</h1>
      <form onSubmit={onSubmit} className="card narrow">
        <label>
          Tài khoản
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        </label>
        <label>
          Mật khẩu
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        <button type="submit" disabled={busy || !username || !password}>
          Đăng nhập
        </button>
        {error && <p className="error">{error}</p>}
      </form>
      <p className="muted">
        <Link to="/">Về trang chào</Link>
      </p>
    </main>
  )
}

function fmt(ts: string | null): string {
  if (!ts) return ''
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString('vi-VN')
}

function durationMin(s: AdminSessionRow): string {
  const end = s.ended_at ?? s.last_seen_at
  const ms = Date.parse(end) - Date.parse(s.created_at)
  return Number.isNaN(ms) ? '' : `${Math.max(0, Math.round(ms / 60000))} phút`
}

function Dashboard({ username, onLogout }: { username: string; onLogout: () => void }) {
  const [rows, setRows] = useState<AdminSessionRow[]>([])
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState<DayStats[]>([])
  const [q, setQ] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<{ session: AdminSessionRow; events: AdminEventRow[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pageSize = 50

  const params = useCallback(
    () => ({
      q: q || undefined,
      from: from ? `${from}T00:00:00.000Z` : undefined,
      to: to ? `${to}T23:59:59.999Z` : undefined,
    }),
    [q, from, to],
  )

  const load = useCallback(async () => {
    try {
      const r = await api.adminSessions({ ...params(), page, pageSize })
      setRows(r.rows)
      setTotal(r.total)
      const s = await api.adminStats(7)
      setStats(s.rows)
      setError(null)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onLogout()
      else setError(`Không tải được dữ liệu: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [params, page, onLogout])

  useEffect(() => {
    const first = setTimeout(() => void load(), 0)
    const id = setInterval(() => void load(), 10_000)
    return () => {
      clearTimeout(first)
      clearInterval(id)
    }
  }, [load])

  async function openSession(id: string) {
    try {
      setSelected(await api.adminEvents(id))
    } catch (err) {
      setError(`Không tải được sự kiện: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function logout() {
    try {
      await api.adminLogout()
    } finally {
      onLogout()
    }
  }

  const pages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <main className="page wide">
      <header className="row">
        <h1>Nhật ký người vào web</h1>
        <span className="muted">{username}</span>
        <a href={api.adminExportUrl(params())} className="button-link">
          Xuất CSV
        </a>
        <button type="button" onClick={logout}>
          Đăng xuất
        </button>
      </header>

      <section className="stats">
        {stats.length === 0 && <span className="muted">Chưa có dữ liệu 7 ngày gần đây.</span>}
        {stats.map((d) => (
          <div key={d.day} className="stat">
            <div className="stat-day">{d.day}</div>
            <div>
              vào {d.visits} · đồng ý {d.consents} · camera {d.cameraStarts}
            </div>
          </div>
        ))}
      </section>

      <form
        className="row filters"
        onSubmit={(e) => {
          e.preventDefault()
          setPage(1)
          void load()
        }}
      >
        <label>
          Tìm
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="tên, IP, id phiên" />
        </label>
        <label>
          Từ ngày
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          Đến ngày
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button type="submit">Lọc</button>
        <span className="muted">
          {total} phiên · trang {page}/{pages}
        </span>
        <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          Trước
        </button>
        <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
          Sau
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      <table className="grid">
        <thead>
          <tr>
            <th>Vào lúc</th>
            <th>Tên</th>
            <th>IP</th>
            <th>Trình duyệt</th>
            <th>Đồng ý</th>
            <th>Camera</th>
            <th>Sự kiện</th>
            <th>Thời lượng</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} onClick={() => void openSession(r.id)} className="clickable">
              <td>{fmt(r.created_at)}</td>
              <td>{r.display_name ?? ''}</td>
              <td>{r.ip ?? ''}</td>
              <td title={r.user_agent ?? ''}>{(r.user_agent ?? '').slice(0, 40)}</td>
              <td>{r.consent_at ? 'có' : 'chưa'}</td>
              <td>{r.camera_starts}</td>
              <td>{r.event_count}</td>
              <td>{durationMin(r)}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={8} className="muted">
                Chưa có phiên nào.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {selected && (
        <section className="card detail">
          <header className="row">
            <h2>Phiên {selected.session.id.slice(0, 8)}</h2>
            <span className="muted">{selected.session.display_name ?? 'không tên'}</span>
            <button type="button" onClick={() => setSelected(null)}>
              Đóng
            </button>
          </header>
          <table className="grid">
            <thead>
              <tr>
                <th>Thời điểm</th>
                <th>Loại</th>
                <th>Chi tiết</th>
              </tr>
            </thead>
            <tbody>
              {selected.events.map((e) => (
                <tr key={e.id}>
                  <td>{fmt(e.ts)}</td>
                  <td>{e.type}</td>
                  <td>
                    <code>{e.payload ?? ''}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  )
}
