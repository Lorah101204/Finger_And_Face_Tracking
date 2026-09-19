import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { DEFAULTS } from '../../core/config'
import { BrandMark } from '../BrandMark'
import { GUIDE_STEPS } from '../guidance'
import { LandingPreview } from '../LandingPreview'
import { CONSENT_VERSION, consentScopeNote, giveConsent, useConsent } from '../session'
import '../landing.css'

// WEB-00: trang chào và nút đồng ý. Không gọi getUserMedia ở đây (bất biến I10); không gửi gì ra ngoài trình duyệt
// (D-019). UX-02 (D-023): màn hình bắt đầu một màn: tên, một câu giới thiệu, minh họa, ba dòng cam kết, hộp đồng ý
// có phiên bản, nút Bắt đầu; cấu trúc form và hành vi của WEB-00 giữ nguyên (nút chỉ bật khi đã tích, giveConsent()
// rồi #/app, khối "đã đồng ý trước đó"); chế độ kiosk (D-021) hiện dòng phạm vi đồng ý.
// UX-03 (D-049): dòng eyebrow, ba bước thành stepper, hộp đồng ý đổi viền khi đã tích, minh họa động bằng canvas
// (LandingPreview, không camera, không ảnh); `?mode=present` là màn hình bắt đầu kiosk: lưới phủ cả màn với cửa sổ mẫu
// trôi, thẻ đồng ý nổi giữa, nút lớn, rồi vào `#/app?mode=present` (chế độ trình diễn của sân khấu).
export function LandingPage() {
  const navigate = useNavigate()
  const consented = useConsent()
  const [searchParams] = useSearchParams()
  const present = searchParams.get('mode') === 'present'
  const [agreed, setAgreed] = useState(false)
  const scopeNote = consentScopeNote(DEFAULTS.consent.scope)
  const appPath = present ? '/app?mode=present' : '/app'

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!agreed) return
    giveConsent()
    navigate(appPath)
  }

  const consentCard = (
    <form onSubmit={onSubmit} className={`consent-card${agreed ? ' agreed' : ''}`}>
      <label className="consent">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <span>Tôi đã đọc và đồng ý (văn bản đồng ý phiên bản {CONSENT_VERSION}).</span>
      </label>
      {scopeNote && (
        <p className="muted small" data-testid="consent-scope">
          {scopeNote}
        </p>
      )}
      <div className="actions">
        <button type="submit" className="primary" disabled={!agreed}>
          Bắt đầu
        </button>
        {consented && (
          <span className="muted">
            Bạn đã đồng ý trước đó. <Link to={appPath}>Vào thẳng màn hình</Link>.
          </span>
        )}
      </div>
    </form>
  )
  const steps = (
    <ol className="steps" aria-label="Ba bước">
      {GUIDE_STEPS.map((s) => (
        <li key={s.step}>
          <span className="num" aria-hidden="true">
            {s.step}
          </span>
          {STEP_TEXT[s.step]}
        </li>
      ))}
    </ol>
  )

  if (present) {
    return (
      <main className="landing kiosk" data-testid="landing-kiosk">
        <LandingPreview variant="window" anchorX={0.74} className="kiosk-bg" />
        <div className="kiosk-card">
          <p className="eyebrow">
            <BrandMark size={16} />
            Chạy hoàn toàn trong trình duyệt · không tải lên
          </p>
          <h1>Web Camera Tracking</h1>
          <p className="lead">
            Giơ hai tay trước camera để mở một cửa sổ trên màn trắng; khuôn mặt chỉ được nhận diện
            trong cửa sổ đó.
          </p>
          <ul className="pledges compact" aria-label="Cam kết riêng tư">
            <li>Xử lý trong trình duyệt</li>
            <li>Không tải lên, không lưu video</li>
            <li>Camera chỉ bật khi bạn bấm</li>
          </ul>
          {consentCard}
          {steps}
        </div>
        <span className="kiosk-corner" aria-hidden="true">
          Ngoài cửa sổ luôn trắng
        </span>
      </main>
    )
  }

  return (
    <main className="landing">
      <div className="landing-copy">
        <p className="eyebrow">
          <span className="dot" aria-hidden="true" />
          Chạy hoàn toàn trong trình duyệt · không tải lên
        </p>
        <h1>Web Camera Tracking</h1>
        <p className="lead">
          Màn hình trắng chia ô. Các đầu ngón tay của bạn mở một cửa sổ nhìn vào camera; nhận diện
          khuôn mặt chỉ chạy trên phần đang mở, phần còn lại luôn trắng.
        </p>
        <ul className="pledges" aria-label="Cam kết riêng tư">
          <li>
            Hình ảnh camera được xử lý ngay trong trình duyệt. Không có máy chủ nhận dữ liệu; không
            tải lên gì.
          </li>
          <li>Không lưu video. Chỉ lưu lựa chọn đồng ý này trong trình duyệt của bạn.</li>
          <li>Camera chỉ bật khi bạn bấm nút ở màn hình kế tiếp.</li>
        </ul>
        {consentCard}
        {steps}
      </div>
      <figure className="landing-art">
        <LandingPreview />
        <figcaption>
          Các đầu ngón tay đóng khung cửa sổ (bao lồi). Chỉ các ô trong cửa sổ hiện camera và được
          nhận diện; minh họa động, không dùng camera.
        </figcaption>
      </figure>
    </main>
  )
}

/** Câu ngắn cho từng bước của lớp hướng dẫn (UX-01) trên màn hình bắt đầu. */
const STEP_TEXT: Record<number, string> = {
  1: 'Bật camera',
  2: 'Giơ hai tay để mở cửa sổ',
  3: 'Khuôn mặt trong cửa sổ',
}
