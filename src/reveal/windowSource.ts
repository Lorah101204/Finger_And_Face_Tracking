// ROI-00: interface WindowSource (mục 4.4 bước 3). Nguồn là chuột (debug, e2e) hoặc tay (HAND-02 + ROI-01).
// `current(now)` trả hình điều khiển vùng mở (ROI-02, ROI-03: cửa sổ vuông đã kẹp trong bảng với chuột, đa giác bao
// lồi các đầu ngón với tay) kèm `limited`; hoặc null kèm lý do đóng. Nguồn tay kèm trạng thái các đầu ngón của frame
// này (vòng lặp vẽ chấm, điền FrameOutput.points, hướng dẫn thiếu điểm).
import type { CloseReason, FingerStatus, RevealShape } from '../core/types'

export type WindowSourceKind = 'mouse' | 'hands'

export type WindowSample =
  | { shape: RevealShape; limited: boolean; reason?: undefined; fingers?: FingerStatus[] }
  | { shape: null; limited: false; reason: CloseReason; fingers?: FingerStatus[] }

export interface WindowSource {
  readonly kind: WindowSourceKind
  /** Cửa sổ hợp lệ tại thời điểm `now` (ms, performance.now) hoặc null với lý do. */
  current(now: number): WindowSample
  dispose(): void
}

export function noWindow(reason: CloseReason): WindowSample {
  return { shape: null, limited: false, reason }
}
