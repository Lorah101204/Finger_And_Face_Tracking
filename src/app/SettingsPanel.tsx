import { useSyncExternalStore } from 'react'
import type { Recorder } from '../dataset/recorder'
import type { StageStore } from '../loop/store'
import { DatasetControls, type DatasetControlsProps } from './DatasetControls'
import { LogControls, type LogControlsProps } from './LogControls'
import { GridControls } from './GridControls'
import { SensitivityControls } from './SensitivityControls'
import { FingerControls } from './FingerControls'

// UX-01: panel cài đặt thu gọn được (nút "Cài đặt" trên thanh trên, aria-expanded). UX-03 (D-049): là cột bên phải
// 320 px chia mục dọc: Lưới, Cửa sổ (GRID-01, HAND-01), Đầu ngón (ROI-03) và Độ nhạy (ROI-01) chỉ khi nguồn là tay,
// Thu dữ liệu (CLS-01), Nhật ký cục bộ (LOG-02). Camera ở thanh trên vì luôn cần. Thu gọn bằng thuộc tính hidden:
// các ô nhập vẫn trong DOM (không mất giá trị), canvas nhận lại chỗ theo chiều rộng (epoch++, D-041); ở chế độ lớp
// phủ (toàn màn hình, trình diễn) cột thành tấm nổi và không đổi cỡ canvas.
export function SettingsPanel({
  store,
  handDelegate,
  open,
  id,
  recorder,
  dataset,
  log,
}: {
  store: StageStore
  /** D-045: delegate tay đã quyết (độ nhạy mặc định). */
  handDelegate: 'GPU' | 'CPU'
  open: boolean
  id: string
  /** CLS-01: dataset mode (thu crop vùng mở); thiếu thì không có mục thu dữ liệu. */
  recorder?: Recorder
  dataset?: Omit<DatasetControlsProps, 'recorder'>
  /** LOG-02: nhật ký cục bộ (công tắc, bảng, CSV). */
  log?: LogControlsProps
}) {
  const { settings } = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const hands = settings.windowSource === 'hands'
  return (
    <aside
      id={id}
      className="panel settings"
      aria-label="Cài đặt"
      hidden={!open}
      data-testid="settings-panel"
    >
      <h2 className="panel-title">Cài đặt</h2>
      <GridControls store={store} />
      {hands && <FingerControls store={store} />}
      {hands && <SensitivityControls store={store} handDelegate={handDelegate} />}
      {recorder && dataset && <DatasetControls recorder={recorder} {...dataset} />}
      {log && <LogControls {...log} />}
    </aside>
  )
}
