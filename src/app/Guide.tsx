import { GUIDE_STEPS, type Guidance } from './guidance'

// UX-01 (UC-08): lớp hướng dẫn nổi trên canvas (không nhận chuột để kéo cửa sổ vẫn qua canvas): ba bước, tiêu đề,
// một câu hướng dẫn và gợi ý phím với nguồn chuột. Vùng aria-live đọc khi thông điệp đổi; thuộc tính data-* cho e2e.
// UX-03: ba bước là pill tiến trình (bước đã xong hiện dấu tích qua CSS, bước hiện tại tô màu tone); `hud` là bản chữ
// lớn cho chế độ lớp phủ (toàn màn hình, trình diễn) để người đứng xa đọc được.
export function Guide({
  guidance,
  keys,
  hud = false,
}: {
  guidance: Guidance
  keys?: string | null
  hud?: boolean
}) {
  return (
    <div
      className={`guide tone-${guidance.tone}${hud ? ' hud' : ''}`}
      data-testid="guide"
      data-step={guidance.step}
      data-tone={guidance.tone}
      data-reason={guidance.reason ?? ''}
      aria-live="polite"
    >
      <ol className="steps" aria-label="Các bước">
        {GUIDE_STEPS.map((s) => {
          const done = s.step < guidance.step
          const current = s.step === guidance.step
          return (
            <li
              key={s.step}
              className={current ? 'current' : done ? 'done' : undefined}
              aria-current={current ? 'step' : undefined}
            >
              <span className="n" aria-hidden="true">
                {done ? '' : s.step}
              </span>
              {s.label}
            </li>
          )
        })}
      </ol>
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
    </div>
  )
}
