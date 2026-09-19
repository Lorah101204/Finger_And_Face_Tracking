// WEB-00: client gọi backend cùng nguồn. Không có hàm nào gửi ảnh, crop hay landmark (bất biến I9).
import type { ClientEvent } from '../../shared/events'

export class ApiError extends Error {
  readonly status: number
  readonly body: unknown
  constructor(status: number, body: unknown) {
    super(`API ${status}`)
    this.status = status
    this.body = body
  }
}

export type SessionInfo = {
  sessionId: string
  createdAt: string
  consentAt: string | null
  consentVersion: string | null
  displayName: string | null
}

export type AdminSessionRow = {
  id: string
  created_at: string
  last_seen_at: string
  ended_at: string | null
  ip: string | null
  user_agent: string | null
  consent_at: string | null
  consent_version: string | null
  display_name: string | null
  event_count: number
  camera_starts: number
}

export type AdminEventRow = { id: number; session_id: string; ts: string; type: string; payload: string | null }

export type DayStats = { day: string; visits: number; consents: number; cameraStarts: number }

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  const text = await res.text()
  let body: unknown = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  if (!res.ok) throw new ApiError(res.status, body)
  return body as T
}

function qs(params: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') p.set(k, String(v))
  return p.toString()
}

export const api = {
  startSession: () => request<SessionInfo>('/api/session/start', { method: 'POST', body: '{}' }),
  me: () => request<SessionInfo>('/api/session/me'),
  consent: (displayName: string, consentVersion: string) =>
    request<SessionInfo>('/api/session/consent', {
      method: 'POST',
      body: JSON.stringify({ displayName: displayName || undefined, consentVersion }),
    }),
  events: (events: ClientEvent[]) =>
    request<{ accepted: number }>('/api/session/events', {
      method: 'POST',
      body: JSON.stringify({ events }),
      keepalive: true,
    }),
  adminLogin: (username: string, password: string) =>
    request<{ username: string; expiresAt: string }>('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  adminLogout: () => request<null>('/api/admin/logout', { method: 'POST', body: '{}' }),
  adminMe: () => request<{ username: string | null; expiresAt: string | null }>('/api/admin/me'),
  adminSessions: (params: { from?: string; to?: string; q?: string; page?: number; pageSize?: number }) =>
    request<{ rows: AdminSessionRow[]; total: number }>(`/api/admin/sessions?${qs(params)}`),
  adminEvents: (id: string) =>
    request<{ session: AdminSessionRow; events: AdminEventRow[] }>(
      `/api/admin/sessions/${encodeURIComponent(id)}/events`,
    ),
  adminStats: (days: number) => request<{ days: number; rows: DayStats[] }>(`/api/admin/stats?days=${days}`),
  adminExportUrl: (params: { from?: string; to?: string }) => `/api/admin/export.csv?${qs(params)}`,
}
