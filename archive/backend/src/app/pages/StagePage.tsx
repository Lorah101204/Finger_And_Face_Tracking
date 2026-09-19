import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { cameraGateReason } from '../gate'
import { getSession, hasConsent, refreshSession, useSession } from '../session'
import { logEvent } from '../telemetry'

/**
 * Sân khấu: canvas output fill trắng (bất biến I4), thanh điều khiển với nút Bật camera.
 * Chỉ vào được sau khi đồng ý (WEB-00). CAM-01 nối CameraSource.start() vào onCameraClick ngay sau assertCameraAllowed().
 */
export function StagePage() {
  const navigate = useNavigate()
  const session = useSession()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [note, setNote] = useState('Camera chưa bật.')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const s = getSession() ?? (await refreshSession())
      if (cancelled) return
      if (!hasConsent(s)) navigate('/', { replace: true })
    })()
    return () => {
      cancelled = true
    }
  }, [navigate])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const paintWhite = () => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.floor(canvas.clientWidth * dpr))
      canvas.height = Math.max(1, Math.floor(canvas.clientHeight * dpr))
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
    paintWhite()
    window.addEventListener('resize', paintWhite)
    return () => window.removeEventListener('resize', paintWhite)
  }, [])

  function onCameraClick() {
    const reason = cameraGateReason()
    if (reason) {
      setNote(`Không bật được camera: ${reason}`)
      return
    }
    logEvent('ui_action', { name: 'camera_button' })
    // CAM-01: assertCameraAllowed() rồi CameraSource.start() ở đây; cho tới đó chỉ ghi nhận thao tác.
    setNote('Cổng camera đã mở. Bật camera thật sẽ có ở gói CAM-01.')
  }

  return (
    <div className="stage">
      <header className="bar">
        <strong>Web Camera Tracking</strong>
        <span className="muted">{session?.displayName ? `Xin chào ${session.displayName}` : 'Khách'}</span>
        <button type="button" onClick={onCameraClick} disabled={!hasConsent(session)}>
          Bật camera
        </button>
        <span className="muted" aria-live="polite">
          {note}
        </span>
        <Link to="/" className="right">
          Về trang chào
        </Link>
      </header>
      <canvas id="stage" ref={canvasRef} aria-label="Màn pixel trắng" />
    </div>
  )
}
