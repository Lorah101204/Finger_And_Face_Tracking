import { useSyncExternalStore } from 'react'
import { DEFAULTS } from '../core/config'
import type { FingerTip } from '../core/types'
import { FINGER_NAMES, TIP_CHOICES } from '../hands/fingertips'
import type { StageStore } from '../loop/store'

// ROI-03 (D-047, thay SlotControls của HAND-02): chọn đầu ngón nào của mỗi bàn tay tham gia vùng mở (mặc định cả năm,
// áp dụng cho cả hai tay). Mọi thay đổi đi qua store.setSettings({ fingers }): epoch++ và cửa sổ đang mở đóng với
// config-changed. Không cho bỏ ngón cuối cùng. Chỉ hiện khi nguồn cửa sổ là tay (StagePage). UX-03: mục "Đầu ngón" của
// cột cài đặt, mỗi ngón là chip (label.chip chứa checkbox có aria-label "Ngón …" cho e2e).
export function FingerControls({ store }: { store: StageStore }) {
  const { settings } = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const on = new Set<FingerTip>(settings.fingers)

  function toggle(tip: FingerTip, checked: boolean): void {
    const next = TIP_CHOICES.filter((t) => (t === tip ? checked : on.has(t)))
    if (next.length === 0) return
    store.setSettings({ fingers: next })
  }

  return (
    <section className="sec" data-testid="fingers-bar">
      <h3>
        Đầu ngón dùng <span className="hint">cả hai tay</span>
      </h3>
      <div className="chips">
        {TIP_CHOICES.map((t) => (
          <label className="chip" key={t}>
            <input
              type="checkbox"
              aria-label={`Ngón ${FINGER_NAMES[t]}`}
              checked={on.has(t)}
              onChange={(e) => toggle(t, e.target.checked)}
            />
            {FINGER_NAMES[t]}
          </label>
        ))}
      </div>
      <span className="hint">
        Cửa sổ là vùng bao các đầu ngón; cần ít nhất {DEFAULTS.reveal.minPoints} đầu ngón của{' '}
        {DEFAULTS.hands.minHands} tay.
      </span>
    </section>
  )
}
