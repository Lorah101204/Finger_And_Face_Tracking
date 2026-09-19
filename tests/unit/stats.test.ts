import { describe, expect, it, vi } from 'vitest'
import { createLatencyWindow } from '../../src/core/latency'
import { createStats, describeStats, type StatsSources } from '../../src/debug/stats'

// PERF-01 (mục 7.19): sampler 250 ms tính Hz trên cửa sổ 2 s từ các bộ đếm; p50/p95 lấy từ nguồn; notify sau mỗi
// mẫu; start/stop theo lịch tiêm vào. Không có timer thật: now và schedule giả.
function fixture() {
  const counters = { frames: 0, face: 0, hand: 0, cls: 0 }
  const render = createLatencyWindow(10)
  const tick = createLatencyWindow(10)
  render.push(1.5)
  tick.push(3)
  const sources: StatsSources = {
    loop: () => ({
      frames: counters.frames,
      epoch: 4,
      status: 'searching',
      render: render.stats(),
      tick: tick.stats(),
    }),
    face: () => ({
      results: counters.face,
      submitted: counters.face + 2,
      dropped: 3,
      p50: 40,
      p95: 60,
      pending: 1,
    }),
    hands: () => ({ results: counters.hand, fed: counters.hand, skipped: 5, p50: 100, p95: 180 }),
    classifier: () => ({ results: counters.cls }),
  }
  return { counters, sources }
}

describe('createStats', () => {
  it('dưới 2 mẫu thì mọi tần suất 0; Hz = Δđếm / Δt giữa mẫu cũ nhất và mới nhất; p50/p95 và pending từ nguồn', () => {
    const { counters, sources } = fixture()
    let t = 1000
    const stats = createStats(sources, { now: () => t })
    expect(stats.snapshot()).toMatchObject({
      fpsOutput: 0,
      faceHz: 0,
      handHz: 0,
      classifierHz: 0,
      samples: 0,
      windowMs: 2000,
      face: { p50: 40, p95: 60, submitted: 2, dropped: 3, pending: 1 },
      hand: { p50: 100, p95: 180, fed: 0, skipped: 5 },
      render: { p50: 1.5, n: 1 },
      epoch: 4,
      status: 'searching',
    })
    stats.sample()
    expect(stats.snapshot().fpsOutput).toBe(0)
    // 1 s sau: 60 frame, 12 kết quả mặt, 20 tay, 4 phân loại.
    t = 2000
    counters.frames = 60
    counters.face = 12
    counters.hand = 20
    counters.cls = 4
    stats.sample()
    const s = stats.snapshot()
    expect(s.fpsOutput).toBeCloseTo(60, 6)
    expect(s.faceHz).toBeCloseTo(12, 6)
    expect(s.handHz).toBeCloseTo(20, 6)
    expect(s.classifierHz).toBeCloseTo(4, 6)
    expect(s.samples).toBe(2)
    expect(s.sampledAt).toBe(2000)
  })

  it('cửa sổ 2 s giữ tối đa 9 mẫu ở 250 ms; mẫu cũ hơn bị bỏ nên tần suất theo 2 s gần nhất', () => {
    const { counters, sources } = fixture()
    let t = 0
    const stats = createStats(sources, { now: () => t })
    // 4 s đầu: 60 fps; sau đó đứng yên.
    for (let i = 0; i <= 16; i++) {
      t = i * 250
      counters.frames = i < 8 ? i * 15 : 120
      stats.sample()
    }
    expect(stats.snapshot().samples).toBe(9)
    // Cửa sổ là 2 s cuối (t = 2000..4000): frames 120 → 120 → 0 fps.
    expect(stats.snapshot().fpsOutput).toBe(0)
    const s2 = createStats(sources, { now: () => t, windowMs: 1000, intervalMs: 500 })
    counters.frames = 0
    t = 0
    s2.sample()
    t = 500
    counters.frames = 30
    s2.sample()
    t = 1000
    counters.frames = 45
    s2.sample()
    t = 1500
    counters.frames = 45
    s2.sample()
    // cap = 3 mẫu: t 500..1500, frames 30 → 45 trong 1 s → 15 fps
    expect(s2.snapshot().samples).toBe(3)
    expect(s2.snapshot().fpsOutput).toBeCloseTo(15, 6)
  })

  it('start đặt lịch một lần, stop hủy; notify sau mỗi mẫu; bộ đếm giảm (reset) không cho tần suất âm', () => {
    const { counters, sources } = fixture()
    let t = 0
    const scheduled: { fn: () => void; ms: number }[] = []
    const cancel = vi.fn()
    const stats = createStats(sources, {
      now: () => t,
      schedule: (fn, ms) => {
        scheduled.push({ fn, ms })
        return cancel
      },
    })
    const cb = vi.fn()
    stats.subscribe(cb)
    expect(stats.running).toBe(false)
    stats.start()
    stats.start()
    expect(stats.running).toBe(true)
    expect(scheduled).toHaveLength(1)
    expect(scheduled[0].ms).toBe(250)
    scheduled[0].fn()
    t = 1000
    counters.frames = 30
    scheduled[0].fn()
    expect(cb).toHaveBeenCalledTimes(2)
    expect(stats.snapshot().fpsOutput).toBeCloseTo(30, 6)
    t = 2000
    counters.frames = 0
    scheduled[0].fn()
    expect(stats.snapshot().fpsOutput).toBe(0)
    stats.stop()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(stats.running).toBe(false)
    stats.stop()
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('describeStats: một dòng với fps, Hz, p50/p95, rớt, chờ, vẽ, tick, epoch, trạng thái', () => {
    const { counters, sources } = fixture()
    let t = 0
    const stats = createStats(sources, { now: () => t })
    stats.sample()
    t = 1000
    counters.frames = 59
    counters.face = 12
    counters.hand = 20
    stats.sample()
    expect(describeStats(stats.snapshot())).toBe(
      'hiệu năng: output 59.0 fps · tay 20.0 Hz (p50 100 / p95 180 ms, bỏ 5) · mặt 12.0 Hz (p50 40 / p95 60 ms,' +
        ' rớt 3, chờ 1) · phân loại 0.0 Hz · vẽ p50 1.5 / p95 1.5 ms · tick p95 3.0 ms · epoch 4 · searching',
    )
  })
})
