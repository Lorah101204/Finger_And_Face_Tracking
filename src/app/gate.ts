// WEB-00: cổng camera (bất biến I10). CameraSource nhận assertCameraAllowed làm `gate` và gọi đồng bộ ngay trước
// navigator.mediaDevices.getUserMedia, chỉ trong handler bấm nút ở trang #/app (D-025).
import { hasConsent } from './session'

export type CameraGateReason = 'no-consent' | 'wrong-page' | 'no-user-activation'

/** Đường dẫn hiện tại theo HashRouter (D-020): "#/app?x=1" → "/app"; không có hash → "/". */
export function currentRoute(): string {
  const raw = window.location.hash.replace(/^#/, '')
  const path = raw.split('?')[0] || '/'
  return path.startsWith('/') ? path : `/${path}`
}

export function cameraGateReason(): CameraGateReason | null {
  if (!hasConsent()) return 'no-consent'
  if (currentRoute() !== '/app') return 'wrong-page'
  const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } })
    .userActivation
  if (activation && !activation.isActive) return 'no-user-activation'
  return null
}

export function assertCameraAllowed(): void {
  const reason = cameraGateReason()
  if (reason) throw new Error(`camera không được phép: ${reason}`)
}
