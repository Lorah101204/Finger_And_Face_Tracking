// Máy trạng thái vùng mở (mục 4.6, sơ đồ 5.7). Thuần, unit test trong Node. Vòng lặp gọi stepReveal mỗi frame.
// Epoch: closed → open luôn tăng; open → closed tăng với tab-hidden, no-camera, user; config-changed KHÔNG tăng ở đây
// vì store đã tăng đúng một lần khi đổi cấu hình (D-027); các lý do do tay (few-points, stale-point, out-of-board,
// too-small, ambiguous-hands) không tăng: kết quả đang chạy vẫn được validate theo ROI lúc gửi và mask hiện tại.
import type { EpochCounter } from './epoch'
import type { CloseReason, RevealMask, RevealState } from './types'

export const EPOCH_BUMP_CLOSE_REASONS: ReadonlySet<CloseReason> = new Set<CloseReason>([
  'tab-hidden',
  'no-camera',
  'user',
])

export type RevealInput =
  /** Có cửa sổ hợp lệ: `build` nhận epoch sau khi đã tăng (nếu mở từ closed) và trả mask mang epoch đó. */
  { kind: 'open'; build: (epoch: number) => RevealMask } | { kind: 'close'; reason: CloseReason }

export type RevealStep = {
  state: RevealState
  /** closed → open ở bước này: reset One Euro, accepting = true. */
  opened: boolean
  /** open → closed ở bước này: xóa mặt và nhãn, accepting = false, rejectAll. */
  closed: boolean
  epochBumped: boolean
}

export function closedState(reason: CloseReason): RevealState {
  return { kind: 'closed', reason }
}

export function stepReveal(prev: RevealState, input: RevealInput, epoch: EpochCounter): RevealStep {
  if (input.kind === 'open') {
    const opened = prev.kind === 'closed'
    if (opened) epoch.bump()
    const mask = input.build(epoch.current)
    return { state: { kind: 'open', mask }, opened, closed: false, epochBumped: opened }
  }
  if (prev.kind === 'closed') {
    const state = prev.reason === input.reason ? prev : closedState(input.reason)
    return { state, opened: false, closed: false, epochBumped: false }
  }
  const bump = EPOCH_BUMP_CLOSE_REASONS.has(input.reason)
  if (bump) epoch.bump()
  return { state: closedState(input.reason), opened: false, closed: true, epochBumped: bump }
}
