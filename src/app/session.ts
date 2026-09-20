// WEB-00: đồng ý trước khi bật camera, lưu trong trình duyệt. Không có backend (D-019): không có gì rời trình duyệt.
// Phạm vi lưu theo DEFAULTS.consent.scope (D-021): device = localStorage, tab = sessionStorage (kiosk).
// Đổi văn bản đồng ý thì tăng CONSENT_VERSION và người dùng phải đồng ý lại.
import { useSyncExternalStore } from 'react'
import { DEFAULTS } from '../core/config'
import { DEFAULT_LANG, t, type Lang } from '../core/i18n'

export const CONSENT_VERSION = '2026-09-17'
export const CONSENT_KEY = 'wct.consent'

let cached: string | null | undefined
const listeners = new Set<() => void>()

function storage(): Storage {
  return DEFAULTS.consent.scope === 'tab' ? window.sessionStorage : window.localStorage
}

function read(): string | null {
  if (cached === undefined) {
    try {
      cached = storage().getItem(CONSENT_KEY)
    } catch {
      cached = null
    }
  }
  return cached
}

function write(value: string | null): void {
  cached = value
  try {
    if (value === null) storage().removeItem(CONSENT_KEY)
    else storage().setItem(CONSENT_KEY, value)
  } catch {
    // Storage bị chặn (chế độ riêng tư): chỉ giữ trong bộ nhớ cho phiên này.
  }
  for (const l of listeners) l()
}

/** UX-02 bước 4 (D-021): dòng phạm vi đồng ý trên màn hình bắt đầu; chỉ chế độ kiosk (tab) cần nói rõ. */
export function consentScopeNote(
  scope: typeof DEFAULTS.consent.scope,
  lang: Lang = DEFAULT_LANG,
): string | null {
  return scope === 'tab' ? t(lang).landing.scopeTab : null
}

/** Đã đồng ý với đúng phiên bản văn bản hiện tại; dùng cho cổng camera (gate.ts). */
export function hasConsent(): boolean {
  return read() === CONSENT_VERSION
}

export function giveConsent(): void {
  write(CONSENT_VERSION)
}

export function revokeConsent(): void {
  write(null)
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  // Sự kiện storage chỉ bắn giữa các tab với localStorage; với sessionStorage không có gì để đồng bộ (đúng ý D-021).
  const onStorage = (e: StorageEvent) => {
    if (e.key === CONSENT_KEY || e.key === null) {
      cached = undefined
      fn()
    }
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(fn)
    window.removeEventListener('storage', onStorage)
  }
}

export function useConsent(): boolean {
  return useSyncExternalStore(subscribe, hasConsent, () => false)
}
