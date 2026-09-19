import { useEffect, useState } from 'react'

// UX-03 (D-049, tách từ useFullscreen của UX-01): "không tương tác" cho chế độ lớp phủ (toàn màn hình hoặc trình
// diễn). Khi `enabled`, không có chuột, phím hay lăn trong IDLE_MS thì `idle` đúng để CSS ẩn các lớp nổi; các lớp nổi
// không đổi kích thước canvas nên epoch không tăng khi chúng hiện hay ẩn. Tắt `enabled` thì idle về sai ngay.
export const IDLE_MS = 2500

export function useIdle(enabled: boolean, ms: number = IDLE_MS): boolean {
  const [idle, setIdle] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let timer = window.setTimeout(() => setIdle(true), ms)
    const arm = () => {
      setIdle(false)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setIdle(true), ms)
    }
    const events = ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const
    for (const ev of events) window.addEventListener(ev, arm, { passive: true })
    return () => {
      window.clearTimeout(timer)
      for (const ev of events) window.removeEventListener(ev, arm)
      setIdle(false)
    }
  }, [enabled, ms])

  return enabled && idle
}
