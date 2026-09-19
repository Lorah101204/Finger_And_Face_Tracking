import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../../server/src/app'
import { loadConfig } from '../../../server/src/config'
import { openDb } from '../../../server/src/db'
import { Repo } from '../../../server/src/repo'
import { seedAdmin } from '../../../server/src/seed'
import { EVENT_PAYLOAD_MAX_BYTES } from '../../../shared/events'

// API-00, LOG-01, ADM-01, SEC-01: kiểm thử backend với DB :memory: theo docs/WORK-BREAKDOWN.md mục 7.4.
const TEST_ENV = {
  NODE_ENV: 'test',
  DATABASE_PATH: ':memory:',
  SESSION_SECRET: 'test-secret',
  ADMIN_USERNAME: 'admin',
  ADMIN_PASSWORD: 'pw-12345678',
  MIGRATIONS_DIR: 'server/migrations',
  CONSENT_VERSION: '2026-09-17',
}

async function makeApp(extra: Record<string, string> = {}) {
  const config = loadConfig({ ...TEST_ENV, ...extra })
  const db = openDb(config.databasePath, config.migrationsDir)
  const repo = new Repo(db)
  seedAdmin(repo, config, () => {})
  const app = await buildApp({ config, repo, db })
  await app.ready()
  return { app, repo, db, config }
}

function cookieOf(res: LightMyRequestResponse, name: string): Record<string, string> {
  const c = res.cookies.find((x) => x.name === name)
  return c ? { [name]: c.value } : {}
}

const json = (obj: unknown) => ({ payload: JSON.stringify(obj), headers: { 'content-type': 'application/json' } })

describe('backend', () => {
  let app: FastifyInstance
  let repo: Repo
  let db: ReturnType<typeof openDb>
  let sid: Record<string, string>
  let sessionId: string

  beforeAll(async () => {
    const built = await makeApp()
    app = built.app
    repo = built.repo
    db = built.db
  })
  afterAll(async () => {
    await app.close()
  })

  it('health', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
  })

  it('schema không có cột nhị phân (I9)', () => {
    const rows = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table'").all() as { sql: string }[]
    for (const r of rows) expect(r.sql.toUpperCase()).not.toContain('BLOB')
  })

  it('vào web tạo phiên, cookie sid và sự kiện visit; gọi lại thì dùng lại phiên', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/session/start',
      ...json({}),
      headers: { 'content-type': 'application/json', 'user-agent': 'vitest-agent' },
    })
    expect(res.statusCode).toBe(200)
    sessionId = res.json().sessionId
    expect(sessionId).toBeTruthy()
    sid = cookieOf(res, 'sid')
    expect(sid.sid).toBeTruthy()
    const row = repo.getSession(sessionId)
    expect(row?.user_agent).toBe('vitest-agent')
    expect(row?.ip).toBeTruthy()
    expect(repo.listEvents(sessionId).map((e) => e.type)).toEqual(['visit'])

    const again = await app.inject({ method: 'POST', url: '/api/session/start', cookies: sid, ...json({}) })
    expect(again.json().sessionId).toBe(sessionId)
    expect(repo.listEvents(sessionId)).toHaveLength(1)
  })

  it('me: 401 không cookie, 200 có cookie', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/session/me' })).statusCode).toBe(401)
    const ok = await app.inject({ method: 'GET', url: '/api/session/me', cookies: sid })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().consentAt).toBeNull()
  })

  it('sự kiện camera trước khi đồng ý bị 403 (I10)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/session/events',
      cookies: sid,
      ...json({ events: [{ ts: new Date().toISOString(), type: 'camera_start', payload: { width: 1280 } }] }),
    })
    expect(res.statusCode).toBe(403)
  })

  it('đồng ý: sai phiên bản 409, đúng thì ghi consent_at, tên và sự kiện', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: '/api/session/consent',
      cookies: sid,
      ...json({ displayName: 'Huy', consentVersion: '1999-01-01' }),
    })
    expect(bad.statusCode).toBe(409)
    const ok = await app.inject({
      method: 'POST',
      url: '/api/session/consent',
      cookies: sid,
      ...json({ displayName: 'Huy', consentVersion: '2026-09-17' }),
    })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().consentAt).toBeTruthy()
    expect(ok.json().displayName).toBe('Huy')
    expect(repo.listEvents(sessionId).map((e) => e.type)).toEqual(['visit', 'consent'])
  })

  it('sự kiện: nhận lô hợp lệ đúng thứ tự, kể cả text/plain (beacon)', async () => {
    // Sự kiện được liệt kê theo ts nên hai mốc này phải sau visit và consent vừa ghi.
    const t0 = new Date(Date.now() + 1).toISOString()
    const t1 = new Date(Date.now() + 2).toISOString()
    const res = await app.inject({
      method: 'POST',
      url: '/api/session/events',
      cookies: sid,
      ...json({
        events: [
          { ts: t0, type: 'camera_start', payload: { width: 1280, height: 720 } },
          { ts: t1, type: 'reveal_open', payload: { n: 6 } },
        ],
      }),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().accepted).toBe(2)
    const t2 = new Date(Date.now() + 3).toISOString()
    const beacon = await app.inject({
      method: 'POST',
      url: '/api/session/events',
      cookies: sid,
      headers: { 'content-type': 'text/plain' },
      payload: JSON.stringify({ events: [{ ts: t2, type: 'page_hidden' }] }),
    })
    expect(beacon.statusCode).toBe(200)
    expect(repo.listEvents(sessionId).map((e) => e.type)).toEqual([
      'visit',
      'consent',
      'camera_start',
      'reveal_open',
      'page_hidden',
    ])
  })

  it('sự kiện: loại lạ 400, payload quá lớn 413', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: '/api/session/events',
      cookies: sid,
      ...json({ events: [{ ts: new Date().toISOString(), type: 'frame_dump', payload: {} }] }),
    })
    expect(bad.statusCode).toBe(400)
    const big = await app.inject({
      method: 'POST',
      url: '/api/session/events',
      cookies: sid,
      ...json({
        events: [{ ts: new Date().toISOString(), type: 'error', payload: { blob: 'x'.repeat(EVENT_PAYLOAD_MAX_BYTES) } }],
      }),
    })
    expect(big.statusCode).toBe(413)
  })

  it('POST từ nguồn khác bị 403', async () => {
    const cross = await app.inject({
      method: 'POST',
      url: '/api/session/start',
      ...json({}),
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
    })
    expect(cross.statusCode).toBe(403)
    const badOrigin = await app.inject({
      method: 'POST',
      url: '/api/session/start',
      ...json({}),
      headers: { 'content-type': 'application/json', origin: 'https://evil.example', host: 'localhost:3000' },
    })
    expect(badOrigin.statusCode).toBe(403)
  })

  it('admin: sai mật khẩu 401, không cookie 401, đăng nhập đúng thì thấy phiên, sự kiện, thống kê, CSV', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/admin/sessions' })).statusCode).toBe(401)
    const bad = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      ...json({ username: 'admin', password: 'sai' }),
    })
    expect(bad.statusCode).toBe(401)
    const login = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      ...json({ username: 'admin', password: 'pw-12345678' }),
    })
    expect(login.statusCode).toBe(200)
    const adm = cookieOf(login, 'adm')
    expect(adm.adm).toBeTruthy()

    const me = await app.inject({ method: 'GET', url: '/api/admin/me', cookies: adm })
    expect(me.json().username).toBe('admin')

    const list = await app.inject({ method: 'GET', url: '/api/admin/sessions?q=Huy', cookies: adm })
    expect(list.statusCode).toBe(200)
    expect(list.json().total).toBe(1)
    expect(list.json().rows[0].id).toBe(sessionId)
    expect(list.json().rows[0].camera_starts).toBe(1)

    const events = await app.inject({ method: 'GET', url: `/api/admin/sessions/${sessionId}/events`, cookies: adm })
    expect(events.json().events).toHaveLength(5)

    const stats = await app.inject({ method: 'GET', url: '/api/admin/stats?days=7', cookies: adm })
    expect(stats.json().rows[0].visits).toBe(1)

    const csv = await app.inject({ method: 'GET', url: '/api/admin/export.csv', cookies: adm })
    expect(csv.headers['content-type']).toContain('text/csv')
    expect(csv.body).toContain(sessionId)
    expect(csv.body).toContain('"Huy"')

    const logout = await app.inject({ method: 'POST', url: '/api/admin/logout', cookies: adm, ...json({}) })
    expect(logout.statusCode).toBe(204)
    expect((await app.inject({ method: 'GET', url: '/api/admin/me', cookies: adm })).statusCode).toBe(401)
  })

  it('kết thúc phiên: 204 rồi me trả 401', async () => {
    const end = await app.inject({ method: 'POST', url: '/api/session/end', cookies: sid, ...json({}) })
    expect(end.statusCode).toBe(204)
    expect((await app.inject({ method: 'GET', url: '/api/session/me', cookies: sid })).statusCode).toBe(401)
  })

  it('retention xóa phiên cũ và sự kiện của nó, giữ phiên mới', async () => {
    const old = repo.createVisitorSession('10.0.0.1', 'old')
    repo.addEvents(old.id, [{ ts: new Date().toISOString(), type: 'visit' }])
    const past = new Date(Date.now() - 100 * 86_400_000).toISOString()
    db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(past, old.id)
    const fresh = repo.createVisitorSession('10.0.0.2', 'fresh')
    const r = repo.deleteOlderThan(90)
    expect(r.sessions).toBe(1)
    expect(r.events).toBe(1)
    expect(repo.getSession(old.id)).toBeNull()
    expect(repo.getSession(fresh.id)).not.toBeNull()
  })
})

describe('giới hạn tần suất đăng nhập', () => {
  it('lần thứ 6 trong một phút bị 429', async () => {
    const { app } = await makeApp({ RATE_LIMIT: '1' })
    let last = 0
    for (let i = 0; i < 6; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/login',
        ...json({ username: 'admin', password: 'sai' }),
      })
      last = res.statusCode
    }
    expect(last).toBe(429)
    await app.close()
  })
})
