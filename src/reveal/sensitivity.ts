// ROI-01 bước 4 (UC-09): độ nhạy điều chỉnh được lúc chạy, giữ trong StageStore.settings.sensitivity và
// HandWindowSource đọc mỗi frame (áp dụng ngay, không đổi epoch). Mặc định từ core/config.ts (mục 3, phụ lục 9.1);
// giá trị chốt lại ở QA-02. Giới hạn ở đây để UI và store kẹp cùng một cách.
import { DEFAULTS } from '../core/config'

export type Sensitivity = {
  /** One Euro, Hz */
  minCutoff: number
  /** One Euro, hệ số tốc độ */
  beta: number
  /** hysteresis khi làm tròn ô (0 là làm tròn thường) */
  hysteresisCells: number
  /** cạnh cửa sổ nhỏ nhất (ô) */
  nMin: number
  /** tuổi điểm tay tối đa (ms) */
  pointMaxAgeMs: number
}

export const SENSITIVITY_LIMITS: Record<
  keyof Sensitivity,
  { min: number; max: number; step: number }
> = {
  minCutoff: { min: 0.05, max: 20, step: 0.05 },
  beta: { min: 0, max: 1, step: 0.005 },
  hysteresisCells: { min: 0, max: 0.49, step: 0.05 },
  nMin: { min: 1, max: 64, step: 1 },
  pointMaxAgeMs: { min: 50, max: 2000, step: 50 },
}

/** D-045: tuổi điểm mặc định theo delegate tay đang dùng (CPU chậm hơn nên tuổi lớn hơn). */
export function defaultSensitivity(handDelegate: 'GPU' | 'CPU' = 'GPU'): Sensitivity {
  return {
    minCutoff: DEFAULTS.reveal.oneEuro.minCutoff,
    beta: DEFAULTS.reveal.oneEuro.beta,
    hysteresisCells: DEFAULTS.reveal.hysteresisCells,
    nMin: DEFAULTS.reveal.nMin,
    pointMaxAgeMs:
      handDelegate === 'CPU'
        ? DEFAULTS.freshness.pointMaxAgeMsCpu
        : DEFAULTS.freshness.pointMaxAgeMs,
  }
}

/** Kẹp từng giá trị vào giới hạn; NaN hoặc không hữu hạn thì lấy mặc định; nMin làm tròn xuống số nguyên. */
export function clampSensitivity(s: Partial<Sensitivity>): Sensitivity {
  const d = defaultSensitivity()
  const out = { ...d }
  for (const key of Object.keys(d) as (keyof Sensitivity)[]) {
    const v = s[key]
    const { min, max } = SENSITIVITY_LIMITS[key]
    const raw = typeof v === 'number' && Number.isFinite(v) ? v : d[key]
    out[key] = Math.min(max, Math.max(min, key === 'nMin' ? Math.floor(raw) : raw))
  }
  return out
}

export function sameSensitivity(a: Sensitivity, b: Sensitivity): boolean {
  return (
    a.minCutoff === b.minCutoff &&
    a.beta === b.beta &&
    a.hysteresisCells === b.hysteresisCells &&
    a.nMin === b.nMin &&
    a.pointMaxAgeMs === b.pointMaxAgeMs
  )
}
