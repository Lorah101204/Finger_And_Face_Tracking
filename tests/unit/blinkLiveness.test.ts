import { describe, expect, it } from 'vitest'
import { subjectText } from '../../src/classify/subjectRule'
import { DEFAULTS } from '../../src/core/config'
import { createBlinkLiveness } from '../../src/face/blinkLiveness'

// CLS-06 (D-071, mục 7.43): tín hiệu sống một chiều từ chớp mắt. Chớp = đã mở (≤ 0,3), nhắm (≥ 0,5), mở lại trong
// 500 ms; nhắm lâu, nhiễu giữa hai ngưỡng, mặt khác hay thời gian lùi không thành chớp; live trong 10 s sau lần chớp.
const F = { x: 500, y: 80, w: 160, h: 200 }
const feed = (l: ReturnType<typeof createBlinkLiveness>, seq: [number, number][], box = F) => {
  for (const [ts, score] of seq) l.push(score, ts, box)
}

describe('createBlinkLiveness', () => {
  it('ngưỡng mặc định theo DEFAULTS.face.liveness', () => {
    expect(DEFAULTS.face.liveness).toEqual({
      enabled: true,
      openMax: 0.3,
      closedMin: 0.5,
      maxClosedMs: 500,
      holdMs: 10_000,
    })
  })

  it('mở → nhắm → mở trong 500 ms là một lần chớp; live trong holdMs rồi hết', () => {
    const l = createBlinkLiveness()
    feed(l, [
      [0, 0.05],
      [90, 0.08],
      [180, 0.7],
      [270, 0.6],
      [360, 0.1],
    ])
    const s = l.snapshot()
    expect(s.blinks).toBe(1)
    expect(s.lastBlinkAt).toBe(360)
    expect(s.state).toBe('open')
    expect(l.live(360)).toBe(true)
    expect(l.live(360 + 10_000)).toBe(true)
    expect(l.live(360 + 10_001)).toBe(false)
    expect(l.isTarget({ x: 510, y: 85, w: 155, h: 195 })).toBe(true)
    expect(l.isTarget({ x: 900, y: 85, w: 155, h: 195 })).toBe(false)
  })

  it('mắt mở tĩnh (ảnh, hình nộm đứng yên) không bao giờ live', () => {
    const l = createBlinkLiveness()
    for (let t = 0; t < 20_000; t += 90) l.push(0.04 + 0.03 * Math.sin(t), t, F)
    expect(l.snapshot().blinks).toBe(0)
    expect(l.live(20_000)).toBe(false)
  })

  it('nhiễu giữa hai ngưỡng không thành chớp; chỉ vượt 0,5 rồi về dưới 0,3 mới tính', () => {
    const l = createBlinkLiveness()
    feed(l, [
      [0, 0.1],
      [90, 0.45],
      [180, 0.2],
      [270, 0.49],
      [360, 0.15],
    ])
    expect(l.snapshot().blinks).toBe(0)
    feed(l, [
      [450, 0.55],
      [540, 0.35],
      [630, 0.29],
    ])
    expect(l.snapshot().blinks).toBe(1)
  })

  it('nhắm lâu hơn maxClosedMs (nhắm mắt, cúi nhìn xuống) không tính; thấy nhắm trước khi thấy mở cũng không tính', () => {
    const l = createBlinkLiveness()
    feed(l, [
      [0, 0.1],
      [100, 0.8],
      [400, 0.8],
      [700, 0.1],
    ])
    expect(l.snapshot().blinks).toBe(0)
    const first = createBlinkLiveness()
    feed(first, [
      [0, 0.9],
      [100, 0.1],
    ])
    expect(first.snapshot().blinks).toBe(0)
    // Sau đó một lần chớp đúng vẫn được tính.
    feed(first, [
      [200, 0.9],
      [300, 0.1],
    ])
    expect(first.snapshot().blinks).toBe(1)
  })

  it('mặt mục tiêu đổi hay ts lùi thì bắt đầu lại: chớp của mặt cũ không mang sang mặt mới; reset xóa hết', () => {
    const l = createBlinkLiveness()
    feed(l, [
      [0, 0.1],
      [100, 0.9],
      [200, 0.1],
    ])
    expect(l.live(200)).toBe(true)
    l.push(0.1, 300, { x: 1000, y: 80, w: 160, h: 200 })
    expect(l.live(300)).toBe(false)
    expect(l.snapshot()).toMatchObject({ blinks: 0, samples: 1 })
    feed(
      l,
      [
        [400, 0.9],
        [500, 0.1],
      ],
      { x: 1000, y: 80, w: 160, h: 200 },
    )
    expect(l.live(500)).toBe(true)
    l.push(0.1, 450, { x: 1000, y: 80, w: 160, h: 200 })
    expect(l.live(500)).toBe(false)
    l.reset()
    expect(l.snapshot()).toEqual({
      state: 'unknown',
      blinks: 0,
      lastBlinkAt: null,
      lastScore: null,
      samples: 0,
      target: null,
    })
  })
})

describe('subjectText với tín hiệu sống', () => {
  it('"Người · chớp mắt" không kèm phần trăm; cờ live chỉ áp cho person', () => {
    expect(subjectText({ subjectType: 'person', confidence: 0.12, live: true }, false)).toBe(
      'Người · chớp mắt',
    )
    expect(subjectText({ subjectType: 'person', live: true }, true, 'en')).toBe(
      'Person · blinked · demo',
    )
    expect(subjectText({ subjectType: 'mannequin', confidence: 0.95, live: true }, false)).toBe(
      'Hình nộm 95 %',
    )
  })
})
