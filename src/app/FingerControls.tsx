import { useSyncExternalStore } from 'react'
import { DEFAULTS } from '../core/config'
import type { FingerTip } from '../core/types'
import { fingerName, TIP_CHOICES } from '../hands/fingertips'
import type { StageStore } from '../loop/store'
import { HelpTip } from './HelpTip'
import { useLang, useStrings } from './useLang'

// ROI-03 (D-047, thay SlotControls của HAND-02): chọn đầu ngón nào của mỗi bàn tay tham gia vùng mở (mặc định cả năm,
// áp dụng cho cả hai tay). Mọi thay đổi đi qua store.setSettings({ fingers }): epoch++ và cửa sổ đang mở đóng với
// config-changed. Không cho bỏ ngón cuối cùng. Chỉ hiện khi nguồn cửa sổ là tay (StagePage). UX-03: mục "Đầu ngón" của
// cột cài đặt, mỗi ngón là chip (label.chip chứa checkbox có aria-label "Ngón …" cho e2e). UX-05: nút "?" cạnh tiêu đề
// mang chú thích của cả mục (thay dòng hint tĩnh).
export function FingerControls({ store }: { store: StageStore }) {
  const { settings } = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const on = new Set<FingerTip>(settings.fingers)
  const lang = useLang()
  const s = useStrings().settings
  const f = s.fingers

  function toggle(tip: FingerTip, checked: boolean): void {
    const next = TIP_CHOICES.filter((t) => (t === tip ? checked : on.has(t)))
    if (next.length === 0) return
    store.setSettings({ fingers: next })
  }

  return (
    <section className="sec" data-testid="fingers-bar">
      <h3>
        <span className="with-help">
          {f.title}
          <HelpTip
            id="fingers"
            text={s.help.fingers(DEFAULTS.reveal.minPoints, DEFAULTS.hands.minHands)}
          />
        </span>
        <span className="hint">{f.both}</span>
      </h3>
      <div className="chips">
        {TIP_CHOICES.map((t) => (
          <label className="chip" key={t}>
            <input
              type="checkbox"
              aria-label={f.aria(fingerName(t, lang))}
              checked={on.has(t)}
              onChange={(e) => toggle(t, e.target.checked)}
            />
            {fingerName(t, lang)}
          </label>
        ))}
      </div>
    </section>
  )
}
