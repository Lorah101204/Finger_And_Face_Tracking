import { useSyncExternalStore } from 'react'
import type { StageStore } from '../loop/store'
import { SENSITIVITY_LIMITS, defaultSensitivity, type Sensitivity } from '../reveal/sensitivity'
import { useStrings } from './useLang'

// ROI-01 bước 4 (UC-09): độ nhạy của cửa sổ theo tay: One Euro (minCutoff, beta), hysteresis, nMin, tuổi điểm.
// Mọi thay đổi đi qua store.setSettings({ sensitivity }): kẹp trong giới hạn, áp dụng ở frame kế, không đổi epoch.
// Chỉ hiện khi nguồn cửa sổ là tay (StagePage). Giá trị trống hay không phải số thì bỏ qua (giữ giá trị cũ).
// UX-03 (D-049): mỗi tham số là thanh trượt kèm ô số cùng giá trị; ô số mang aria-label (e2e fill, bàn phím), thanh
// trượt là tiện ích chuột (aria-hidden, không nhận Tab) vì cùng nhãn sẽ làm getByLabel trùng hai phần tử.
const FIELDS: readonly (keyof Sensitivity)[] = [
  'minCutoff',
  'beta',
  'hysteresisCells',
  'nMin',
  'pointMaxAgeMs',
]

export function SensitivityControls({
  store,
  handDelegate,
}: {
  store: StageStore
  /** D-045: delegate tay đang dùng, quyết định tuổi điểm mặc định khi đặt lại. */
  handDelegate: 'GPU' | 'CPU'
}) {
  const { settings } = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const s = settings.sensitivity
  const txt = useStrings().settings.sensitivity

  function update(key: keyof Sensitivity, value: number): void {
    if (!Number.isFinite(value)) return
    store.setSettings({ sensitivity: { ...s, [key]: value } })
  }

  return (
    <section className="sec" data-testid="sensitivity-bar">
      <h3>
        {txt.title}
        <button
          type="button"
          className="link"
          onClick={() => store.setSettings({ sensitivity: defaultSensitivity(handDelegate) })}
        >
          {txt.reset}
        </button>
      </h3>
      {FIELDS.map((key) => {
        const { label, aria } = txt.fields[key]
        const lim = SENSITIVITY_LIMITS[key]
        return (
          <div className="slider" key={key}>
            <div className="lab">
              <span>{label}</span>
              <input
                type="number"
                aria-label={aria}
                min={lim.min}
                max={lim.max}
                step={lim.step}
                value={s[key]}
                onChange={(e) => update(key, e.target.valueAsNumber)}
              />
            </div>
            <input
              type="range"
              aria-hidden="true"
              tabIndex={-1}
              min={lim.min}
              max={lim.max}
              step={lim.step}
              value={s[key]}
              onChange={(e) => update(key, e.target.valueAsNumber)}
            />
          </div>
        )
      })}
    </section>
  )
}
