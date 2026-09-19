// API-00: mọi truy vấn cơ sở dữ liệu ở một chỗ, tham số hóa. Thời gian dạng ISO 8601 UTC.
// Khi chuyển Postgres: giữ nguyên chữ ký các hàm, thay phần thân.
import { randomUUID } from 'node:crypto';
const now = () => new Date().toISOString();
export class Repo {
    db;
    constructor(db) {
        this.db = db;
    }
    createVisitorSession(ip, userAgent) {
        const id = randomUUID();
        const ts = now();
        this.db
            .prepare('INSERT INTO sessions (id, created_at, last_seen_at, ip, user_agent) VALUES (?, ?, ?, ?, ?)')
            .run(id, ts, ts, ip, userAgent);
        return this.getSession(id);
    }
    getSession(id) {
        return this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) ?? null;
    }
    touchSession(id) {
        this.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(now(), id);
    }
    setConsent(id, displayName, consentVersion) {
        this.db
            .prepare('UPDATE sessions SET consent_at = ?, consent_version = ?, display_name = ?, last_seen_at = ? WHERE id = ?')
            .run(now(), consentVersion, displayName, now(), id);
        return this.getSession(id);
    }
    endSession(id) {
        this.db.prepare('UPDATE sessions SET ended_at = COALESCE(ended_at, ?), last_seen_at = ? WHERE id = ?').run(now(), now(), id);
    }
    addEvents(sessionId, events) {
        const insert = this.db.prepare('INSERT INTO events (session_id, ts, type, payload) VALUES (?, ?, ?, ?)');
        this.db.exec('BEGIN');
        try {
            for (const e of events) {
                insert.run(sessionId, e.ts, e.type, e.payload === undefined ? null : JSON.stringify(e.payload));
            }
            this.db.exec('COMMIT');
        }
        catch (err) {
            this.db.exec('ROLLBACK');
            throw err;
        }
        return events.length;
    }
    listSessions(query) {
        const like = query.q ? `%${query.q}%` : null;
        const where = `WHERE (? IS NULL OR s.created_at >= ?) AND (? IS NULL OR s.created_at <= ?)
      AND (? IS NULL OR s.display_name LIKE ? OR s.ip LIKE ? OR s.id LIKE ?)`;
        const params = [
            query.from ?? null,
            query.from ?? null,
            query.to ?? null,
            query.to ?? null,
            like,
            like,
            like,
            like,
        ];
        const total = this.db.prepare(`SELECT COUNT(*) AS c FROM sessions s ${where}`).get(...params).c;
        const rows = this.db
            .prepare(`SELECT s.*,
           (SELECT COUNT(*) FROM events e WHERE e.session_id = s.id) AS event_count,
           (SELECT COUNT(*) FROM events e WHERE e.session_id = s.id AND e.type = 'camera_start') AS camera_starts
         FROM sessions s ${where}
         ORDER BY s.created_at DESC LIMIT ? OFFSET ?`)
            .all(...params, query.pageSize, (query.page - 1) * query.pageSize);
        return { rows, total };
    }
    listEvents(sessionId) {
        return this.db
            .prepare('SELECT * FROM events WHERE session_id = ? ORDER BY ts ASC, id ASC')
            .all(sessionId);
    }
    stats(days) {
        const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
        return this.db
            .prepare(`SELECT substr(ts, 1, 10) AS day,
           SUM(CASE WHEN type = 'visit' THEN 1 ELSE 0 END) AS visits,
           SUM(CASE WHEN type = 'consent' THEN 1 ELSE 0 END) AS consents,
           SUM(CASE WHEN type = 'camera_start' THEN 1 ELSE 0 END) AS cameraStarts
         FROM events WHERE substr(ts, 1, 10) >= ? GROUP BY day ORDER BY day ASC`)
            .all(since);
    }
    exportCsv(from, to) {
        const { rows } = this.listSessions({ from, to, page: 1, pageSize: 100_000 });
        const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
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
        ];
        const lines = rows.map((r) => [
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
            .join(','));
        return [header.join(','), ...lines].join('\r\n') + '\r\n';
    }
    findAdmin(username) {
        return (this.db.prepare("SELECT * FROM users WHERE role = 'admin' AND username = ?").get(username) ?? null);
    }
    countAdmins() {
        return this.db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get().c;
    }
    createAdmin(username, passwordHash) {
        const id = randomUUID();
        this.db
            .prepare("INSERT INTO users (id, role, username, password_hash, created_at) VALUES (?, 'admin', ?, ?, ?)")
            .run(id, username, passwordHash, now());
        return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    }
    createAdminSession(userId, tokenHash, expiresAt) {
        this.db
            .prepare('INSERT INTO admin_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
            .run(tokenHash, userId, now(), expiresAt);
    }
    getAdminSession(tokenHash) {
        return (this.db
            .prepare(`SELECT a.token_hash, a.user_id, a.expires_at, u.username
           FROM admin_sessions a JOIN users u ON u.id = a.user_id WHERE a.token_hash = ?`)
            .get(tokenHash) ?? null);
    }
    deleteAdminSession(tokenHash) {
        this.db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(tokenHash);
    }
    deleteExpiredAdminSessions() {
        this.db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').run(now());
    }
    /** Retention: xóa phiên (và sự kiện theo cascade) có last_seen_at cũ hơn số ngày cho trước. */
    deleteOlderThan(days) {
        const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
        const events = this.db
            .prepare('DELETE FROM events WHERE session_id IN (SELECT id FROM sessions WHERE last_seen_at < ?)')
            .run(cutoff).changes;
        const sessions = this.db.prepare('DELETE FROM sessions WHERE last_seen_at < ?').run(cutoff).changes;
        return { sessions: Number(sessions), events: Number(events) };
    }
}
//# sourceMappingURL=repo.js.map