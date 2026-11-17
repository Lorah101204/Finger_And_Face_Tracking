// CLS-06 (D-071): tín hiệu sống một chiều từ chớp mắt, thuần. Đầu vào mỗi kết quả mặt: điểm nhắm hai mắt của mặt mục
// tiêu (min(eyeBlinkLeft, eyeBlinkRight) của blendshapes, tính trên chính buffer giới hạn), ts của frame và bbox camera.
// Một lần chớp = đã thấy mắt mở (≤ openMax), rồi nhắm (≥ closedMin), rồi mở lại trong maxClosedMs; giữa hai ngưỡng giữ
// trạng thái cũ (trễ) để nhiễu quanh một ngưỡng không thành chớp. Nhắm lâu hơn maxClosedMs (nhắm mắt, cúi nhìn xuống)
// không tính. `live(now)` đúng trong holdMs sau lần chớp gần nhất. Mặt mục tiêu đổi (bbox mới không cùng mục tiêu với
// bbox cũ) hay thời gian lùi thì bắt đầu lại; vòng lặp reset khi đóng vùng hay đổi epoch, nên không mang tín hiệu sống
// của mặt cũ sang lần mở sau (mục 5.10). Chỉ cho bằng chứng "là người"; không chớp không phải bằng chứng hình nộm.
// Chỉ import core/ (I1).
import { DEFAULTS } from '../core/config'
import { rectsSameTarget } from '../core/rect'
import type { Rect } from '../core/types'

export type BlinkState = 'unknown' | 'open' | 'closed'

export type LivenessOptions = {
  openMax: number
  closedMin: number
  maxClosedMs: number
  holdMs: number
}

export type LivenessSnapshot = {
  state: BlinkState
  /** số lần chớp của mục tiêu hiện tại */
  blinks: number
  /** ts frame của lần chớp gần nhất; null khi chưa chớp */
  lastBlinkAt: number | null
  lastScore: number | null
  samples: number
  target: Rect | null
}

export type BlinkLiveness = {
  push(score: number, ts: number, bboxCam: Rect): void
  /** Mặt mục tiêu đã chớp trong holdMs tính tới `now` (cùng gốc thời gian với ts của frame). */
  live(now: number): boolean
  /** Mặt `bboxCam` là mục tiêu đang theo dõi (cùng mục tiêu với bbox mới nhất). */
  isTarget(bboxCam: Rect): boolean
  reset(): void
  snapshot(): LivenessSnapshot
}

export function createBlinkLiveness(opts: Partial<LivenessOptions> = {}): BlinkLiveness {
  const d = DEFAULTS.face.liveness
  const openMax = opts.openMax ?? d.openMax
  const closedMin = opts.closedMin ?? d.closedMin
  const maxClosedMs = opts.maxClosedMs ?? d.maxClosedMs
  const holdMs = opts.holdMs ?? d.holdMs
  let state: BlinkState = 'unknown'
  let sawOpen = false
  let closedAt = 0
  let lastTs = -Infinity
  let target: Rect | null = null
  let blinks = 0
  let lastBlinkAt: number | null = null
  let lastScore: number | null = null
  let samples = 0

  function reset(): void {
    state = 'unknown'
    sawOpen = false
    closedAt = 0
    lastTs = -Infinity
    target = null
    blinks = 0
    lastBlinkAt = null
    lastScore = null
    samples = 0
  }

  return {
    push(score, ts, bboxCam) {
      if (target && (!rectsSameTarget(target, bboxCam) || ts < lastTs)) reset()
      target = { ...bboxCam }
      lastTs = ts
      lastScore = score
      samples++
      if (score <= openMax) {
        if (state === 'closed' && sawOpen && ts - closedAt <= maxClosedMs) {
          blinks++
          lastBlinkAt = ts
        }
        state = 'open'
        sawOpen = true
      } else if (score >= closedMin && state !== 'closed') {
        state = 'closed'
        closedAt = ts
      }
    },
    live(now) {
      return lastBlinkAt !== null && now - lastBlinkAt <= holdMs
    },
    isTarget(bboxCam) {
      return target !== null && rectsSameTarget(target, bboxCam)
    },
    reset,
    snapshot() {
      return {
        state,
        blinks,
        lastBlinkAt,
        lastScore,
        samples,
        target: target ? { ...target } : null,
      }
    },
  }
}
