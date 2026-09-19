import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { CONSENT_VERSION, DISPLAY_NAME_MAX } from '../../../shared/events'
import { ensureSession, giveConsent, hasConsent, useSession } from '../session'
import { logEvent } from '../telemetry'

// WEB-00: trang chào. Không gọi getUserMedia ở đây (bất biến I10). Mở trang tạo phiên và sự kiện visit ở server.
export function LandingPage() {
  const navigate = useNavigate()
  const session = useSession()
  const [name, setName] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void ensureSession()
  }, [])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!agreed || busy) return
    setBusy(true)
    setError(null)
    try {
      if (!(await ensureSession())) throw new Error('không tạo được phiên, kiểm tra backend')
      await giveConsent(name.trim())
      logEvent('ui_action', { name: 'start' })
      navigate('/app')
    } catch (err) {
      setError(`Không gửi được đồng ý: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page landing">
      <h1>Web Camera Tracking</h1>
      <p>
        Màn hình trắng chia ô. Bạn dùng bốn đầu ngón tay để mở một cửa sổ vuông nhìn vào camera; nhận diện khuôn mặt
        chỉ chạy trên phần đang mở.
      </p>
      <form onSubmit={onSubmit} className="card">
        <label>
          Tên hiển thị (tùy chọn)
          <input
            value={name}
            maxLength={DISPLAY_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ví dụ: Huy"
            autoComplete="nickname"
          />
        </label>
        <ul className="notes">
          <li>Hình ảnh camera được xử lý ngay trong trình duyệt và không được tải lên máy chủ.</li>
          <li>
            Chỉ lưu nhật ký kỹ thuật: thời điểm vào, trình duyệt, địa chỉ mạng, thao tác bật hoặc tắt camera. Xóa sau
            90 ngày.
          </li>
          <li>Camera chỉ bật khi bạn bấm nút ở màn hình kế tiếp.</li>
        </ul>
        <label className="consent">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>Tôi đã đọc và đồng ý (văn bản đồng ý phiên bản {CONSENT_VERSION}).</span>
        </label>
        <button type="submit" disabled={!agreed || busy}>
          Bắt đầu
        </button>
        {session && hasConsent(session) && (
          <p className="muted">
            Bạn đã đồng ý trước đó. <Link to="/app">Vào thẳng màn hình</Link>.
          </p>
        )}
        {error && <p className="error">{error}</p>}
      </form>
      <p className="muted">
        <Link to="/admin">Quản trị</Link>
      </p>
    </main>
  )
}
