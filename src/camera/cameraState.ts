// CAM-01: máy trạng thái camera thuần (mục 5.5, D-025), không đụng DOM để unit test được trong Node.
// idle → requesting → active → (ended | error); active → requesting khi đổi camera; ended, error → requesting khi thử lại.
import type { CloseReason } from '../core/types'

export type CameraErrorKind =
  'not-allowed' | 'not-found' | 'overconstrained' | 'not-readable' | 'gate' | 'unknown'

export type CameraEndReason = 'track-ended' | 'device-removed'

export type CameraState =
  | { status: 'idle' }
  | { status: 'requesting'; deviceId: string | null }
  | {
      status: 'active'
      deviceId: string
      label: string
      width: number
      height: number
      frameRate: number | null
    }
  | { status: 'ended'; reason: CameraEndReason }
  | { status: 'error'; kind: CameraErrorKind; message: string }

export type CameraEvent =
  | { type: 'start'; deviceId: string | null }
  | {
      type: 'stream'
      deviceId: string
      label: string
      width: number
      height: number
      frameRate: number | null
    }
  | { type: 'dimensions'; width: number; height: number }
  | { type: 'fail'; kind: CameraErrorKind; message: string }
  | { type: 'track-ended' }
  | { type: 'device-removed' }
  | { type: 'stop' }

export const IDLE: CameraState = { status: 'idle' }

/** Sự kiện không hợp lệ ở trạng thái hiện tại thì bỏ qua (trả về đúng đối tượng cũ). */
export function reduceCamera(state: CameraState, event: CameraEvent): CameraState {
  switch (event.type) {
    case 'start':
      return { status: 'requesting', deviceId: event.deviceId }
    case 'stream':
      if (state.status !== 'requesting') return state
      return {
        status: 'active',
        deviceId: event.deviceId,
        label: event.label,
        width: event.width,
        height: event.height,
        frameRate: event.frameRate,
      }
    case 'dimensions':
      if (state.status !== 'active') return state
      if (state.width === event.width && state.height === event.height) return state
      return { ...state, width: event.width, height: event.height }
    case 'fail':
      if (state.status !== 'requesting') return state
      return { status: 'error', kind: event.kind, message: event.message }
    case 'track-ended':
      return state.status === 'active' ? { status: 'ended', reason: 'track-ended' } : state
    case 'device-removed':
      return state.status === 'active' ? { status: 'ended', reason: 'device-removed' } : state
    case 'stop':
      return IDLE
  }
}

/** Đúng ở mọi lối ra khỏi active (đổi camera, rút thiết bị, dừng): vòng lặp phải đưa RevealState về Closed. */
export function leftActive(prev: CameraState, next: CameraState): boolean {
  return prev.status === 'active' && next.status !== 'active'
}

export type CameraDevice = { deviceId: string; label: string }

export type CameraSnapshot = {
  state: CameraState
  /** D-011: không có FrameStamp quá camera.noFrameWatchdogMs trong khi active. */
  stalled: boolean
  /** document.visibilityState là hidden. */
  hidden: boolean
  devices: CameraDevice[]
  epoch: number
}

/** Lý do vùng mở phải đóng theo camera (mục 4.6); null khi camera đang cấp frame bình thường. */
export function cameraCloseReason(
  s: Pick<CameraSnapshot, 'state' | 'stalled' | 'hidden'>,
): CloseReason | null {
  if (s.hidden) return 'tab-hidden'
  if (s.state.status !== 'active' || s.stalled) return 'no-camera'
  return null
}

/** Ánh xạ lỗi getUserMedia (tên DOMException) sang loại lỗi của app. */
export function classifyCameraError(err: unknown): { kind: CameraErrorKind; message: string } {
  const name = typeof err === 'object' && err !== null && 'name' in err ? String(err.name) : ''
  const message = err instanceof Error ? err.message : String(err)
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return { kind: 'not-allowed', message }
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return { kind: 'not-found', message }
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return { kind: 'overconstrained', message }
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return { kind: 'not-readable', message }
    default:
      return { kind: 'unknown', message }
  }
}
