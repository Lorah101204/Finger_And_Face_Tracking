import { describe, expect, it } from 'vitest'
import { ONE_EURO_DEFAULTS, stepOneEuro, type OneEuroState } from '../../src/reveal/oneEuro'

// ROI-01 (mục 7.15): One Euro thuần. Mẫu đầu không trễ; đứng yên thì giữ nguyên; bước nhảy hội tụ đơn điệu; tốc độ
// cao thì bám sát hơn (beta); mẫu trùng thời điểm bị bỏ qua.
function run(values: number[], dtMs: number, p = ONE_EURO_DEFAULTS): number[] {
  let st: OneEuroState | null = null
  const out: number[] = []
  values.forEach((v, i) => {
    st = stepOneEuro(st, v, i * dtMs, p)
    out.push(st.x)
  })
  return out
}

describe('stepOneEuro', () => {
  it('mẫu đầu khởi tạo tại giá trị đầu vào, tốc độ 0; đứng yên thì giữ nguyên', () => {
    const s0 = stepOneEuro(null, 42, 1000)
    expect(s0).toEqual({ x: 42, dx: 0, ts: 1000 })
    const out = run(Array(30).fill(42), 16)
    expect(out.every((v) => v === 42)).toBe(true)
  })

  it('bước nhảy hội tụ đơn điệu về giá trị mới: minCutoff 1 Hz ở 60 Hz đạt trên 95 % sau 0,5 s', () => {
    const out = run([0, ...Array(60).fill(100)], 1000 / 60)
    for (let i = 2; i < out.length; i++) expect(out[i]).toBeGreaterThanOrEqual(out[i - 1])
    expect(out[out.length - 1]).toBeLessThan(100)
    expect(out[30]).toBeGreaterThan(95)
    expect(out[1]).toBeGreaterThan(0)
    expect(out[1]).toBeLessThan(100)
  })

  it('beta: di chuyển nhanh thì trễ ít hơn beta = 0; di chuyển chậm thì hai bản gần nhau', () => {
    const fast = Array.from({ length: 60 }, (_, i) => i * 20) // 1200 px/s ở 60 Hz
    const lagBeta = fast[59] - run(fast, 1000 / 60)[59]
    const lagNoBeta = fast[59] - run(fast, 1000 / 60, { ...ONE_EURO_DEFAULTS, beta: 0 })[59]
    expect(lagBeta).toBeLessThan(lagNoBeta / 2)
    const slow = Array.from({ length: 60 }, (_, i) => i / 30) // 2 px/s
    const a = run(slow, 1000 / 60)[59]
    const b = run(slow, 1000 / 60, { ...ONE_EURO_DEFAULTS, beta: 0 })[59]
    expect(Math.abs(a - b)).toBeLessThan(0.1)
  })

  it('rung ±3 px quanh một giá trị bị giảm biên độ nhiều lần', () => {
    const vals = Array.from({ length: 120 }, (_, i) => 100 + (i % 2 === 0 ? 3 : -3))
    const out = run(vals, 1000 / 30)
    const tail = out.slice(60)
    const amp = Math.max(...tail) - Math.min(...tail)
    expect(amp).toBeLessThan(1.5)
    expect(Math.abs(tail[tail.length - 1] - 100)).toBeLessThan(1)
  })

  it('mẫu có ts không tăng bị bỏ qua (trả trạng thái cũ); minCutoff 0 vẫn lọc được (nâng lên 0,01 Hz)', () => {
    const s0 = stepOneEuro(null, 10, 100)
    expect(stepOneEuro(s0, 50, 100)).toBe(s0)
    expect(stepOneEuro(s0, 50, 90)).toBe(s0)
    const s1 = stepOneEuro(s0, 50, 116, { minCutoff: 0, beta: 0, dCutoff: 1 })
    expect(s1.x).toBeGreaterThan(10)
    expect(s1.x).toBeLessThan(11)
  })
})
