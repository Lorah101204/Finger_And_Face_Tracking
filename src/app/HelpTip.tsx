import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useStrings } from './useLang'

// UX-05 (D-060): nút "?" nhỏ cạnh từng mục của cột cài đặt. Di chuột (chỉ pointerType mouse) hay focus bàn phím vào thì
// hiện chú thích; bấm thì ghim (chạm trên kiosk), bấm lại, Esc hay bấm ra ngoài thì đóng. Bong bóng là role=tooltip
// render qua portal vào phần tử toàn màn hình (hay body) với position: fixed, đặt dưới nút và kẹp trong viewport: không
// bị cột cài đặt (overflow: auto, backdrop-filter ở chế độ lớp phủ) cắt và vẫn thấy khi toàn màn hình (phần tử ngoài
// fullscreenElement không được vẽ). Vị trí tính trong handler lúc mở (không setState trong effect) và tính lại khi cuộn
// hay đổi cỡ trong lúc mở. Tên trợ năng của nút là một chuỗi chung ("Chú thích") + aria-describedby tới bong bóng: không
// chứa nhãn của mục để getByLabel(nhãn) của e2e không trúng hai phần tử; data-help=key cho e2e và CSS.
const TIP_WIDTH = 260
const GAP = 6
const EDGE = 8

type Pos = { top: number; left: number }

function subscribeFullscreen(cb: () => void): () => void {
  document.addEventListener('fullscreenchange', cb)
  return () => document.removeEventListener('fullscreenchange', cb)
}

/** Nơi gắn bong bóng: phần tử đang toàn màn hình, nếu không thì body. */
function usePortalHost(): Element | null {
  return useSyncExternalStore(
    subscribeFullscreen,
    () => document.fullscreenElement ?? document.body,
    () => null,
  )
}

/** Bong bóng dưới nút, mép trái lệch vào 8 px, kẹp trong viewport. */
function placeBelow(el: Element): Pos {
  const r = el.getBoundingClientRect()
  const left = Math.max(EDGE, Math.min(r.left - EDGE, window.innerWidth - TIP_WIDTH - EDGE))
  return { top: r.bottom + GAP, left }
}

export function HelpTip({ id, text }: { id: string; text: string }) {
  const tipId = useId()
  const btn = useRef<HTMLButtonElement>(null)
  const [pinned, setPinned] = useState(false)
  const [hover, setHover] = useState(false)
  const [pos, setPos] = useState<Pos | null>(null)
  const host = usePortalHost()
  const aria = useStrings().settings.help.aria
  const open = pinned || hover

  function show(setter: (v: boolean) => void): void {
    if (btn.current) setPos(placeBelow(btn.current))
    setter(true)
  }

  // Đang mở: theo nút khi cuộn cột hay đổi cỡ cửa sổ.
  useEffect(() => {
    if (!open) return
    const follow = () => {
      if (btn.current) setPos(placeBelow(btn.current))
    }
    window.addEventListener('scroll', follow, true)
    window.addEventListener('resize', follow)
    return () => {
      window.removeEventListener('scroll', follow, true)
      window.removeEventListener('resize', follow)
    }
  }, [open])

  // Đang ghim: Esc hay bấm ngoài nút và bong bóng thì bỏ ghim (bấm trong bong bóng vẫn giữ để chọn chữ).
  useEffect(() => {
    if (!pinned) return
    const onDown = (e: PointerEvent) => {
      const t = e.target instanceof Node ? e.target : null
      if (t && btn.current?.contains(t)) return
      if (t && document.getElementById(tipId)?.contains(t)) return
      setPinned(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPinned(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [pinned, tipId])

  return (
    <>
      <button
        type="button"
        className="help-btn"
        data-help={id}
        ref={btn}
        aria-label={aria}
        aria-expanded={pinned}
        aria-describedby={open ? tipId : undefined}
        onClick={() => {
          // Bấm để đóng thì đóng ngay dù chuột còn trên nút; rời rồi vào lại mới hiện.
          if (pinned) {
            setPinned(false)
            setHover(false)
          } else show(setPinned)
        }}
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse') show(setHover)
        }}
        onPointerLeave={() => setHover(false)}
        onFocus={(e) => {
          if (e.currentTarget.matches(':focus-visible')) show(setHover)
        }}
        onBlur={() => setHover(false)}
      >
        ?
      </button>
      {open &&
        host &&
        pos &&
        createPortal(
          <span
            role="tooltip"
            id={tipId}
            className="help-tip"
            data-help-tip={id}
            style={{ top: pos.top, left: pos.left, width: TIP_WIDTH }}
          >
            {text}
          </span>,
          host,
        )}
    </>
  )
}
