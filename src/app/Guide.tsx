import { useEffect, useState } from 'react'
import type { Lang } from '../core/i18n'
import { guideSteps, type Guidance } from './guidance'
import type { GuideMode } from './uiState'
import { useStrings } from './useLang'

// UX-01 (UC-08): lớp hướng dẫn nổi trên canvas (không nhận chuột để kéo cửa sổ vẫn qua canvas): ba bước, tiêu đề,
// một câu hướng dẫn và gợi ý phím với nguồn chuột. Vùng aria-live đọc khi thông điệp đổi; thuộc tính data-* cho e2e.
// UX-03: ba bước là pill tiến trình (bước đã xong hiện dấu tích qua CSS, bước hiện tại tô màu tone); `hud` là bản chữ
// lớn cho chế độ lớp phủ (toàn màn hình, trình diễn) để người đứng xa đọc được.
// UX-04: thẻ gọn hơn (một cột chữ nhỏ, bước là chấm số) và tự thu gọn: thông điệp mới hiện đầy đủ COLLAPSE_MS rồi còn
// một dòng (bước + tiêu đề; câu chi tiết và gợi ý phím ẩn bằng CSS nhưng vẫn trong DOM cho e2e và trình đọc màn hình);
// đổi thông điệp thì mở lại. Tone lỗi không thu gọn (người dùng cần đọc cách sửa). `mode` từ mục Giao diện: auto
// (mặc định), full (không thu gọn), hidden (không vẽ). I18N-01: nhãn bước và aria theo ngôn ngữ.
export const COLLAPSE_MS = 6000

export function Guide({
  guidance,
  keys,
  hud = false,
  mode = 'auto',
  lang,
}: {
  guidance: Guidance
  keys?: string | null
  hud?: boolean
  mode?: GuideMode
  lang?: Lang
}) {
  const s = useStrings()
  const steps = guideSteps(lang)
  const key = `${guidance.step}|${guidance.tone}|${guidance.title}|${guidance.detail}|${keys ?? ''}`
  const canCollapse = mode === 'auto' && guidance.tone !== 'error'
  const [collapsedKey, setCollapsedKey] = useState<string | null>(null)
  useEffect(() => {
    if (!canCollapse) return
    const timer = window.setTimeout(() => setCollapsedKey(key), COLLAPSE_MS)
    return () => window.clearTimeout(timer)
  }, [key, canCollapse])
  if (mode === 'hidden') return null
  const collapsed = canCollapse && collapsedKey === key
  return (
    <div
      className={`guide tone-${guidance.tone}${hud ? ' hud' : ''}${collapsed ? ' collapsed' : ''}`}
      data-testid="guide"
      data-step={guidance.step}
      data-tone={guidance.tone}
      data-reason={guidance.reason ?? ''}
      data-collapsed={collapsed ? '1' : '0'}
      aria-live="polite"
    >
      <ol className="steps" aria-label={s.guide.stepsLabel}>
        {steps.map((st) => {
          const done = st.step < guidance.step
          const current = st.step === guidance.step
          return (
            <li
              key={st.step}
              className={current ? 'current' : done ? 'done' : undefined}
              aria-current={current ? 'step' : undefined}
              title={st.label}
            >
              <span className="n" aria-hidden="true">
                {done ? '' : st.step}
              </span>
              <span className="label">{st.label}</span>
            </li>
          )
        })}
      </ol>
      <span className="body">
        <strong className="title" data-testid="guide-title">
          {guidance.title}
        </strong>
        <span className="detail" data-testid="guide-detail">
          {guidance.detail}
        </span>
        {keys && (
          <span className="keys" data-testid="guide-keys">
            {keys}
          </span>
        )}
      </span>
    </div>
  )
}
