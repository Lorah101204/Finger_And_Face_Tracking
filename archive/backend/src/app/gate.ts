// WEB-00: cổng camera (bất biến I10). CAM-01 phải gọi assertCameraAllowed() ngay trước navigator.mediaDevices.getUserMedia
// và chỉ trong handler bấm nút ở trang /app.
import { getSession, hasConsent } from './session'

export type CameraGateReason = 'no-session' | 'no-consent' | 'wrong-page' | 'no-user-activation'

export function cameraGateReason(): CameraGateReason | null {
  const s = getSession()
  if (!s) return 'no-session'
  if (!hasConsent(s)) return 'no-consent'
  if (window.location.pathname !== '/app') return 'wrong-page'
  const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation
  if (activation && !activation.isActive) return 'no-user-activation'
  return null
}

export function assertCameraAllowed(): void {
  const reason = cameraGateReason()
  if (reason) throw new Error(`camera không được phép: ${reason}`)
}
