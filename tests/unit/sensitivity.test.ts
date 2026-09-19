import { describe, expect, it } from 'vitest'
import {
  SENSITIVITY_LIMITS,
  clampSensitivity,
  defaultSensitivity,
  sameSensitivity,
} from '../../src/reveal/sensitivity'

// ROI-01 bước 4 (UC-09): độ nhạy mặc định theo config; kẹp trong giới hạn; NaN lấy mặc định; nMin nguyên.
describe('sensitivity', () => {
  it('mặc định theo core/config; clamp giữ giá trị hợp lệ, kẹp giá trị ngoài giới hạn, NaN lấy mặc định', () => {
    const d = defaultSensitivity()
    expect(d).toEqual({
      minCutoff: 1,
      beta: 0.02,
      hysteresisCells: 0.25,
      nMin: 3,
      pointMaxAgeMs: 150,
    })
    expect(clampSensitivity(d)).toEqual(d)
    expect(clampSensitivity({})).toEqual(d)
    expect(
      clampSensitivity({
        minCutoff: 0,
        beta: -1,
        hysteresisCells: 2,
        nMin: 4.9,
        pointMaxAgeMs: 10,
      }),
    ).toEqual({
      minCutoff: SENSITIVITY_LIMITS.minCutoff.min,
      beta: 0,
      hysteresisCells: SENSITIVITY_LIMITS.hysteresisCells.max,
      nMin: 4,
      pointMaxAgeMs: SENSITIVITY_LIMITS.pointMaxAgeMs.min,
    })
    expect(clampSensitivity({ nMin: NaN, beta: Infinity })).toEqual(d)
  })

  it('sameSensitivity so sánh theo giá trị', () => {
    const d = defaultSensitivity()
    expect(sameSensitivity(d, { ...d })).toBe(true)
    expect(sameSensitivity(d, { ...d, beta: 0.03 })).toBe(false)
  })
})
