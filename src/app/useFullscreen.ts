import { useCallback, useEffect, useSyncExternalStore, type RefObject } from 'react'

// UX-01: toàn màn hình cho sân khấu bằng Fullscreen API trên phần tử gốc của trang (thanh điều khiển và panel
// trở thành lớp phủ, canvas chiếm cả màn hình). Phím F bật/tắt khi không gõ trong ô nhập. Esc do trình duyệt xử lý
// (thoát toàn màn hình). Phần "không tương tác thì ẩn lớp phủ" nằm ở useIdle (UX-03) vì chế độ trình diễn cũng dùng.

export type FullscreenState = {
  /** Trình duyệt cho phép requestFullscreen (document.fullscreenEnabled). */
  supported: boolean
  active: boolean
  toggle: () => void
}

const EDIT_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA'])

function subscribe(cb: () => void): () => void {
  document.addEventListener('fullscreenchange', cb)
  return () => document.removeEventListener('fullscreenchange', cb)
}

function isActive(): boolean {
  return document.fullscreenElement !== null
}

export function useFullscreen(ref: RefObject<HTMLElement | null>): FullscreenState {
  const supported = typeof document !== 'undefined' && !!document.fullscreenEnabled
  const active = useSyncExternalStore(subscribe, isActive, () => false)

  const toggle = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {})
      return
    }
    const el = ref.current
    if (!el || !document.fullscreenEnabled) return
    void el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {})
  }, [ref])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'f' && e.key !== 'F') return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (EDIT_TAGS.has(t.tagName) || t.isContentEditable)) return
      e.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  return { supported, active, toggle }
}
