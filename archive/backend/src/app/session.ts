// WEB-00: trạng thái phiên khách ở client. ensureSession gọi start một lần; hasConsent dùng cho cổng camera (gate.ts).
import { useSyncExternalStore } from 'react'
import { CONSENT_VERSION } from '../../shared/events'
import { ApiError, api, type SessionInfo } from './api'

let current: SessionInfo | null = null
let pending: Promise<SessionInfo | null> | null = null
const listeners = new Set<() => void>()

function set(s: SessionInfo | null) {
  current = s
  for (const l of listeners) l()
}

export function getSession(): SessionInfo | null {
  return current
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function useSession(): SessionInfo | null {
  return useSyncExternalStore(subscribe, getSession, getSession)
}

/** Tạo hoặc dùng lại phiên (POST /api/session/start); ghi sự kiện visit ở server. */
export function ensureSession(): Promise<SessionInfo | null> {
  if (current) return Promise.resolve(current)
  if (!pending) {
    pending = api
      .startSession()
      .then((s) => {
        set(s)
        return s
      })
      .catch(() => null)
      .finally(() => {
        pending = null
      })
  }
  return pending
}

/** Đọc lại phiên từ cookie (GET /api/session/me), dùng khi tải thẳng /app. */
export async function refreshSession(): Promise<SessionInfo | null> {
  try {
    const s = await api.me()
    set(s)
    return s
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) set(null)
    return null
  }
}

export async function giveConsent(displayName: string): Promise<SessionInfo> {
  const s = await api.consent(displayName, CONSENT_VERSION)
  set(s)
  return s
}

export function hasConsent(s: SessionInfo | null = current): boolean {
  return !!s?.consentAt && s.consentVersion === CONSENT_VERSION
}
