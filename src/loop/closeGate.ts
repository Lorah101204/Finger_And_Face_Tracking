// INT-01 (mục 4.6, UC-15): lý do vùng mở phải đóng ngoài ý muốn của nguồn cửa sổ: camera dừng, đổi camera, watchdog
// không có frame (no-camera) và tab ẩn (tab-hidden). Vòng lặp hỏi `reason()` mỗi frame và còn đăng ký `subscribe`
// để đóng ngay khi có sự kiện: tab ẩn thì requestAnimationFrame không chạy nên không thể chờ frame kế. Thuần với
// đối tượng tối thiểu để unit test trong Node.
import { cameraCloseReason, type CameraSnapshot } from '../camera/cameraState'
import type { CloseReason } from '../core/types'

export type CloseGate = {
  /** Lý do phải đóng lúc này; null khi camera cấp frame bình thường và tab đang hiện. */
  reason(): CloseReason | null
  /** Báo khi lý do có thể đã đổi. Trả hàm hủy đăng ký. */
  subscribe(fn: () => void): () => void
}

export type CameraLike = {
  getSnapshot(): Pick<CameraSnapshot, 'state' | 'stalled' | 'hidden'>
  subscribe(fn: () => void): () => void
}

/** Camera thật: theo cameraCloseReason của snapshot (tab-hidden ưu tiên, rồi no-camera). */
export function cameraGate(camera: CameraLike): CloseGate {
  return {
    reason: () => cameraCloseReason(camera.getSnapshot()),
    subscribe: (fn) => camera.subscribe(fn),
  }
}

export type DocumentLike = {
  readonly visibilityState: string
  addEventListener(type: 'visibilitychange', fn: () => void): void
  removeEventListener(type: 'visibilitychange', fn: () => void): void
}

/** Nguồn tổng hợp (không có camera): chỉ còn tab ẩn. */
export function visibilityGate(doc: DocumentLike = document): CloseGate {
  return {
    reason: () => (doc.visibilityState === 'hidden' ? 'tab-hidden' : null),
    subscribe: (fn) => {
      doc.addEventListener('visibilitychange', fn)
      return () => doc.removeEventListener('visibilitychange', fn)
    },
  }
}
