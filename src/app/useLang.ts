import { useSyncExternalStore } from 'react'
import { langStore, readLang, t, writeLang, type Lang, type Strings } from '../core/i18n'

// I18N-01: ngôn ngữ giao diện trong React. `initLang()` chạy một lần ở main.tsx: đọc `?lang=` (query của hash route
// hoặc của trang) rồi localStorage `wct.lang`, đặt vào kho chung và <html lang>. `setLang()` đổi kho, lưu và cập nhật
// <html lang> cùng tiêu đề trang; mọi component đọc qua `useLang()` (useSyncExternalStore) nên đổi là vẽ lại ngay.
function localStore(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function applyDocument(lang: Lang): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = lang
  document.title = t(lang).meta.title
  const meta = document.querySelector('meta[name="description"]')
  if (meta) meta.setAttribute('content', t(lang).meta.description)
}

/** Query của URL: phần sau `?` trong hash (HashRouter) hoặc của trang. */
function urlQuery(): string | null {
  if (typeof window === 'undefined') return null
  const hash = window.location.hash
  const i = hash.indexOf('?')
  if (i >= 0) return hash.slice(i)
  return window.location.search || null
}

export function initLang(): Lang {
  const lang = readLang(localStore(), urlQuery())
  langStore.set(lang)
  applyDocument(lang)
  return lang
}

export function setLang(lang: Lang): void {
  langStore.set(lang)
  writeLang(localStore(), lang)
  applyDocument(lang)
}

export function useLang(): Lang {
  return useSyncExternalStore(langStore.subscribe, langStore.get, langStore.get)
}

/** Từ điển của ngôn ngữ hiện tại (re-render khi đổi). */
export function useStrings(): Strings {
  return t(useLang())
}
