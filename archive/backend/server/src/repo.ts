// API-00: mọi truy vấn cơ sở dữ liệu ở một chỗ, tham số hóa. Thời gian dạng ISO 8601 UTC.
// Khi chuyển Postgres: giữ nguyên chữ ký các hàm, thay phần thân.
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

export type SessionRow = {
  id: string
  user_id: string | null
  created_at: string
  last_seen_at: string
  ended_at: string | null
  ip: string | null
  user_agent: string | null
  consent_at: string | null
  consent_version: string | null
  display_name: string | null
}

export type SessionListRow = SessionRow & { event_count: number; camera_starts: number }

export type EventRow = { id: number; session_id: string; ts: string; type: string; payload: string | null }

export type UserRow = {
  id: string
  role: 'visitor' | 'admin'
  username: string | null
  display_name: string | null
  password_hash: string | null
  created_at: string
}

export type AdminSessionRow = { token_hash: string; user_id: string; expires_at: string; username: string | null }

export type SessionQuery = { from?: string; to?: string; q?: string; page: number; pageSize: number }

export type DayStats = { day: string; visits: number; consents: number; cameraStarts: number }

const now = () => new Date().toISOString()

export class Repo {
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.db = db
  }

  createVisitorSession(ip: string | null, userAgent: string | null): SessionRow {
    const id = randomUUID()
    const ts = now()
    this.db
      .prepare('INSERT INTO sessions (id, created_at, last_seen_at, ip, user_agent) VALUES (?, ?, ?, ?, ?)')
      .run(id, ts, ts, ip, userAgent)
    return this.getSession(id) as SessionRow
  }

  getSession(id: string): SessionRow | null {
    return (this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined) ?? null
  }

  touchSession(id: string): void {
    this.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(now(), id)
  }

  setConsent(id: string, displayName: string | null, consentVersion: string): SessionRow {
    this.db
      .prepare('UPDATE sessions SET consent_at = ?, consent_version = ?, display_name = ?, last_seen_at = ? WHERE id = ?')
      .run(now(), consentVersion, displayName, now(), id)
    return this.getSession(id) as SessionRow
  }

  endSession(id: string): void {
    this.db.prepare('UPDATE sessions SET ended_at = COALESCE(ended_at, ?), last_seen_at = ? WHERE id = ?').run(now(), now(), id)
  }

  addEvents(sessionId: string, events: { ts: string; type: string; payload?: unknown }[]): number {
    const insert = this.db.prepare('INSERT INTO events (session_id, ts, type, payload) VALUES (?, ?, ?, ?)')
    this.db.exec('BEGIN')
    try {
      for (const e of events) {
        insert.run(sessionId, e.ts, e.type, e.payload === undefined ? null : JSON.stringify(e.payload))
      }
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
    return events.length
  }

  listSessions(query: SessionQuery): { rows: SessionListRow[]; total: number } {
    const like = query.q ? `%${query.q}%` : null
    const where = `WHERE (? IS NULL OR s.created_at >= ?) AND (? IS NULL OR s.created_at <= ?)
      AND (? IS NULL OR s.display_name LIKE ? OR s.ip LIKE ? OR s.id LIKE ?)`
    const params = [
      query.from ?? null,
      query.from ?? null,
      query.to ?? null,
      query.to ?? null,
      like,
      like,
      like,
      like,
    ]
    const total = (
      this.db.prepare(`SELECT COUNT(*) AS c FROM sessions s ${where}`).get(...params) as { c: number }
    ).c
    const rows = this.db
      .prepare(
        `SELECT s.*,
           (SELECT COUNT(*) FROM events e WHERE e.session_id = s.id) AS event_count,
           (SELECT COUNT(*) FROM events e WHERE e.session_id = s.id AND e.type = 'camera_start') AS camera_starts
         FROM sessions s ${where}
         ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, query.pageSize, (query.page - 1) * query.pageSize) as SessionListRow[]
    return { rows, total }
  }

  listEvents(sessionId: string): EventRow[] {
    return this.db
      .prepare('SELECT * FROM events WHERE session_id = ? ORDER BY ts ASC, id ASC')
      .all(sessionId) as EventRow[]
  }

  stats(days: number): DayStats[] {
    const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
    return this.db
      .prepare(
        `SELECT substr(ts, 1, 10) AS day,
           SUM(CASE WHEN type = 'visit' THEN 1 ELSE 0 END) AS visits,
           SUM(CASE WHEN type = 'consent' THEN 1 ELSE 0 END) AS consents,
           SUM(CASE WHEN type = 'camera_start' THEN 1 ELSE 0 END) AS cameraStarts
         FROM events WHERE substr(ts, 1, 10) >= ? GROUP BY day ORDER BY day ASC`,
      )
      .all(since) as DayStats[]
  }

  exportCsv(from?: string, to?: string): string {
    const { rows } = this.listSessions({ from, to, page: 1, pageSize: 100_000 })
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const header = [
      'session_id',
      'created_at',
      'last_seen_at',
      'ended_at',
      'display_name',
      'ip',
      'user_agent',
      'consent_at',
      'consent_version',
      'event_count',
      'camera_starts',
    ]
    const lines = rows.map((r) =>
      [
        r.id,
        r.created_at,
        r.last_seen_at,
        r.ended_at,
        r.display_name,
        r.ip,
        r.user_agent,
        r.consent_at,
        r.consent_version,
        r.event_count,
        r.camera_starts,
      ]
        .map(esc)
        .join(','),
    )
    return [header.join(','), ...lines].join('\r\n') + '\r\n'
  }

  findAdmin(username: string): UserRow | null {
    return (
      (this.db.prepare("SELECT * FROM users WHERE role = 'admin' AND username = ?").get(username) as
        | UserRow
        | undefined) ?? null
    )
  }

  countAdmins(): number {
    return (this.db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get() as { c: number }).c
  }

  createAdmin(username: string, passwordHash: string): UserRow {
    const id = randomUUID()
    this.db
      .prepare("INSERT INTO users (id, role, username, password_hash, created_at) VALUES (?, 'admin', ?, ?, ?)")
      .run(id, username, passwordHash, now())
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow
  }

  createAdminSession(userId: string, tokenHash: string, expiresAt: string): void {
    this.db
      .prepare('INSERT INTO admin_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(tokenHash, userId, now(), expiresAt)
  }

  getAdminSession(tokenHash: string): AdminSessionRow | null {
    return (
      (this.db
        .prepare(
          `SELECT a.token_hash, a.user_id, a.expires_at, u.username
           FROM admin_sessions a JOIN users u ON u.id = a.user_id WHERE a.token_hash = ?`,
        )
        .get(tokenHash) as AdminSessionRow | undefined) ?? null
    )
  }

  deleteAdminSession(tokenHash: string): void {
    this.db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(tokenHash)
  }

  deleteExpiredAdminSessions(): void {
    this.db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').run(now())
  }

  /** Retention: xóa phiên (và sự kiện theo cascade) có last_seen_at cũ hơn số ngày cho trước. */
  deleteOlderThan(days: number): { sessions: number; events: number } {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
    const events = this.db
      .prepare('DELETE FROM events WHERE session_id IN (SELECT id FROM sessions WHERE last_seen_at < ?)')
      .run(cutoff).changes
    const sessions = this.db.prepare('DELETE FROM sessions WHERE last_seen_at < ?').run(cutoff).changes
    return { sessions: Number(sessions), events: Number(events) }
  }
}
