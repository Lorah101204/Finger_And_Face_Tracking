import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { DEFAULTS } from '../../core/config'
import { BrandMark } from '../BrandMark'
import { GUIDE_STEP_IDS } from '../guidance'
import { LandingPreview } from '../LandingPreview'
import { LanguageSwitch } from '../LanguageSwitch'
import { CONSENT_VERSION, consentScopeNote, giveConsent, useConsent } from '../session'
import { useLang, useStrings } from '../useLang'
import '../landing.css'

// WEB-00: trang chào và nút đồng ý. Không gọi getUserMedia ở đây (bất biến I10); không gửi gì ra ngoài trình duyệt
// (D-019). UX-02 (D-023): màn hình bắt đầu một màn: tên, một câu giới thiệu, minh họa, ba dòng cam kết, hộp đồng ý
// có phiên bản, nút Bắt đầu; cấu trúc form và hành vi của WEB-00 giữ nguyên (nút chỉ bật khi đã tích, giveConsent()
// rồi #/app, khối "đã đồng ý trước đó"); chế độ kiosk (D-021) hiện dòng phạm vi đồng ý.
// UX-03 (D-049): dòng eyebrow, ba bước thành stepper, hộp đồng ý đổi viền khi đã tích, minh họa động bằng canvas
// (LandingPreview, không camera, không ảnh); `?mode=present` là màn hình bắt đầu kiosk: lưới phủ cả màn với cửa sổ mẫu
// trôi, thẻ đồng ý nổi giữa, nút lớn, rồi vào `#/app?mode=present` (chế độ trình diễn của sân khấu).
// I18N-01: mọi chữ theo useStrings(); nút chuyển ngôn ngữ (LanguageSwitch) ở góc trên phải của trang và trên thẻ kiosk,
// đặt cuối DOM (vị trí bằng CSS) để thứ tự Tab vẫn là hộp đồng ý → Bắt đầu (mục 7.21).
export function LandingPage() {
  const navigate = useNavigate()
  const consented = useConsent()
  const [searchParams] = useSearchParams()
  const present = searchParams.get('mode') === 'present'
  const [agreed, setAgreed] = useState(false)
  const lang = useLang()
  const s = useStrings()
  const scopeNote = consentScopeNote(DEFAULTS.consent.scope, lang)
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
        <span>{s.landing.consent(CONSENT_VERSION)}</span>
      </label>
      {scopeNote && (
        <p className="muted small" data-testid="consent-scope">
          {scopeNote}
        </p>
      )}
      <div className="actions">
        <button type="submit" className="primary" disabled={!agreed}>
          {s.landing.start}
        </button>
        {consented && (
          <span className="muted">
            {s.landing.consentedBefore} <Link to={appPath}>{s.landing.goStraight}</Link>.
          </span>
        )}
      </div>
    </form>
  )
  const steps = (
    <ol className="steps" aria-label={s.landing.stepsLabel}>
      {GUIDE_STEP_IDS.map((step) => (
        <li key={step}>
          <span className="num" aria-hidden="true">
            {step}
          </span>
          {s.landing.steps[step]}
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
            {s.landing.eyebrow}
          </p>
          <h1>{s.landing.title}</h1>
          <p className="lead">{s.landing.leadKiosk}</p>
          <ul className="pledges compact" aria-label={s.landing.pledgesLabel}>
            {s.landing.pledgesCompact.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          {consentCard}
          {steps}
          <LanguageSwitch className="corner" />
        </div>
        <span className="kiosk-corner" aria-hidden="true">
          {s.landing.kioskCorner}
        </span>
      </main>
    )
  }

  return (
    <main className="landing">
      <div className="landing-copy">
        <p className="eyebrow">
          <span className="dot" aria-hidden="true" />
          {s.landing.eyebrow}
        </p>
        <h1>{s.landing.title}</h1>
        <p className="lead">{s.landing.lead}</p>
        <ul className="pledges" aria-label={s.landing.pledgesLabel}>
          {s.landing.pledges.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        {consentCard}
        {steps}
      </div>
      <figure className="landing-art">
        <LandingPreview lang={lang} />
        <figcaption>{s.landing.figcaption}</figcaption>
      </figure>
      <LanguageSwitch className="corner" />
    </main>
  )
}
