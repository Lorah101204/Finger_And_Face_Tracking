import { useSyncExternalStore } from 'react'
import type { Recorder } from '../dataset/recorder'
import type { StageStore } from '../loop/store'
import { DatasetControls, type DatasetControlsProps } from './DatasetControls'
import { LogControls, type LogControlsProps } from './LogControls'
import { GridControls } from './GridControls'
import { LanguageSwitch } from './LanguageSwitch'
import { SensitivityControls } from './SensitivityControls'
import { FingerControls } from './FingerControls'
import { GUIDE_MODES, isGuideMode, type UiState } from './uiState'
import { useStrings } from './useLang'

// UX-01: panel cài đặt thu gọn được (nút "Cài đặt" trên thanh trên, aria-expanded). UX-03 (D-049): là cột bên phải
// 320 px chia mục dọc: Lưới, Cửa sổ (GRID-01, HAND-01), Đầu ngón (ROI-03) và Độ nhạy (ROI-01) chỉ khi nguồn là tay,
// Thu dữ liệu (CLS-01), Nhật ký cục bộ (LOG-02). Camera ở thanh trên vì luôn cần. Thu gọn bằng thuộc tính hidden:
// các ô nhập vẫn trong DOM (không mất giá trị), canvas nhận lại chỗ theo chiều rộng (epoch++, D-041); ở chế độ lớp
// phủ (toàn màn hình, trình diễn) cột thành tấm nổi và không đổi cỡ canvas.
// UX-04, I18N-01: mục Giao diện (ngôn ngữ, chế độ lớp hướng dẫn) ở đầu cột; `ui` và `setUi` từ StagePage.
export function SettingsPanel({
  store,
  handDelegate,
  open,
  id,
  ui,
  setUi,
  recorder,
  dataset,
  log,
}: {
  store: StageStore
  /** D-045: delegate tay đã quyết (độ nhạy mặc định). */
  handDelegate: 'GPU' | 'CPU'
  open: boolean
  id: string
  /** UX-04: trạng thái giao diện (chế độ lớp hướng dẫn). */
  ui?: Pick<UiState, 'guide'>
  setUi?: (patch: Partial<UiState>) => void
  /** CLS-01: dataset mode (thu crop vùng mở); thiếu thì không có mục thu dữ liệu. */
  recorder?: Recorder
  dataset?: Omit<DatasetControlsProps, 'recorder'>
  /** LOG-02: nhật ký cục bộ (công tắc, bảng, CSV). */
  log?: LogControlsProps
}) {
  const { settings } = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const s = useStrings()
  const hands = settings.windowSource === 'hands'
  const guideText = {
    auto: s.settings.ui.guideAuto,
    full: s.settings.ui.guideFull,
    hidden: s.settings.ui.guideHidden,
  }
  return (
    <aside
      id={id}
      className="panel settings"
      aria-label={s.settings.title}
      hidden={!open}
      data-testid="settings-panel"
    >
      <h2 className="panel-title">{s.settings.title}</h2>
      <section className="sec" data-testid="ui-section">
        <h3>{s.settings.ui.title}</h3>
        <div className="lbl">
          <span>{s.settings.ui.language}</span>
          <LanguageSwitch />
        </div>
        {ui && setUi && (
          <div className="lbl">
            <span>{s.settings.ui.guide}</span>
            <select
              aria-label={s.settings.ui.guideAria}
              value={ui.guide}
              onChange={(e) => {
                if (isGuideMode(e.target.value)) setUi({ guide: e.target.value })
              }}
            >
              {GUIDE_MODES.map((m) => (
                <option key={m} value={m}>
                  {guideText[m]}
                </option>
              ))}
            </select>
            <span className="hint">{s.settings.ui.guideHint}</span>
          </div>
        )}
      </section>
      <GridControls store={store} />
      {hands && <FingerControls store={store} />}
      {hands && <SensitivityControls store={store} handDelegate={handDelegate} />}
      {recorder && dataset && <DatasetControls recorder={recorder} {...dataset} />}
      {log && <LogControls {...log} />}
    </aside>
  )
}
