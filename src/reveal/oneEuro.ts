// ROI-01 bước 1: bộ lọc One Euro (Casiez, Roussel, Vogel 2012) cho giá trị vô hướng; squareSolver dùng cho tâm
// (cx, cy) và cạnh của hình vuông. Trạng thái là record bất biến: stepOneEuro thuần (unit test trong Node),
// HandWindowSource reset bằng cách bỏ record (mục 4.6: closed → open thì reset bộ lọc). Thời gian tính bằng ms
// (ts frame camera hoặc performance.now), tần số cắt bằng Hz: alpha = 1 / (1 + tau / dt) với tau = 1 / (2 pi f).
// Ý nghĩa tham số (mục 3): minCutoff thấp thì mượt hơn khi đứng yên nhưng trễ hơn; beta cao thì bám nhanh khi
// di chuyển nhanh (tần số cắt = minCutoff + beta × |tốc độ|); dCutoff lọc đạo hàm dùng để ước lượng tốc độ.
import { DEFAULTS } from '../core/config'

export type OneEuroParams = {
  /** Hz */
  minCutoff: number
  /** đơn vị: 1 / (đơn vị giá trị mỗi giây) */
  beta: number
  /** Hz, cho đạo hàm */
  dCutoff: number
}

export type OneEuroState = {
  /** giá trị đã lọc */
  x: number
  /** tốc độ đã lọc (đơn vị giá trị mỗi giây) */
  dx: number
  /** ms của mẫu gần nhất */
  ts: number
}

export const ONE_EURO_DEFAULTS: OneEuroParams = DEFAULTS.reveal.oneEuro

function alpha(cutoffHz: number, dtS: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz)
  return 1 / (1 + tau / dtS)
}

/**
 * Một bước lọc. state null (mẫu đầu): khởi tạo tại giá trị đầu vào, tốc độ 0, không trễ. Mẫu có ts không lớn hơn
 * mẫu trước (dt ≤ 0) bị bỏ qua: trả lại trạng thái cũ. minCutoff ≤ 0 làm alpha = 0 (giá trị không bao giờ đổi)
 * nên được nâng lên 0.01 Hz.
 */
export function stepOneEuro(
  state: OneEuroState | null,
  x: number,
  ts: number,
  p: OneEuroParams = ONE_EURO_DEFAULTS,
): OneEuroState {
  if (!state) return { x, dx: 0, ts }
  const dt = (ts - state.ts) / 1000
  if (!(dt > 0)) return state
  const ad = alpha(Math.max(0.01, p.dCutoff), dt)
  const dx = ad * ((x - state.x) / dt) + (1 - ad) * state.dx
  const cutoff = Math.max(0.01, p.minCutoff) + Math.max(0, p.beta) * Math.abs(dx)
  const a = alpha(cutoff, dt)
  return { x: a * x + (1 - a) * state.x, dx, ts }
}
