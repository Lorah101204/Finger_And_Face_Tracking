import { LANGS, type Lang } from '../core/i18n'
import { setLang, useLang, useStrings } from './useLang'

// I18N-01: nút chuyển ngôn ngữ dạng phân đoạn (Tiếng Việt | English), dùng ở trang chào (góc trên) và mục Giao diện
// của cột cài đặt. Nút đang chọn có aria-pressed; nhóm mang aria-label "Ngôn ngữ" (theo ngôn ngữ hiện tại).
export function LanguageSwitch({ className }: { className?: string }) {
  const lang = useLang()
  const s = useStrings()
  return (
    <div
      className={`lang-switch${className ? ` ${className}` : ''}`}
      role="group"
      aria-label={s.lang.label}
      data-testid="lang-switch"
    >
      {LANGS.map((l: Lang) => (
        <button
          key={l}
          type="button"
          className="sm"
          lang={l}
          aria-pressed={lang === l}
          onClick={() => setLang(l)}
        >
          {s.lang.names[l]}
        </button>
      ))}
    </div>
  )
}
