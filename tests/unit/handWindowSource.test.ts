import { describe, expect, it } from 'vitest'
import { computeLayout, type Layout } from '../../src/core/coords'
import type { FingerTip, HandFrame } from '../../src/core/types'
import { fakeHandFrame, type FakeHandsSpec } from '../../src/debug/fakeHands'
import {
  HandWindowSource,
  describeHandWindow,
  type HandWindowContext,
} from '../../src/reveal/handWindowSource'
import { defaultSensitivity, type Sensitivity } from '../../src/reveal/sensitivity'

// ROI-01, ROI-03 (mục 7.15, 7.26): HandWindowSource ghép đầu ngón với solver bao lồi. Stage 1280 × 720, lưới 64 × 36
// (c = 20), camera cùng cỡ, không mirror: px camera = px stage. Tay giả lập (debug/fakeHands): trái tại (440, 360),
// phải tại (840, 360), spread 200; với hai ngón cái và trỏ, bốn đầu ngón tạo hình chữ nhật 400 × 200 → bao lồi
// (440, 260) (840, 260) (840, 460) (440, 460); cạnh ngắn 10 ô. Với cả năm ngón, bao lồi thêm các đầu ngón giữa, áp út,
// út (lệch phải và cao hơn) nên rộng hơn về bên phải mỗi tay.
const L = computeLayout({ w: 1280, h: 720 }, { cols: 64, rows: 36 }, { w: 1280, h: 720 })
const HANDS: FakeHandsSpec = {
  left: { x: 440, y: 360, spread: 200 },
  right: { x: 840, y: 360, spread: 200 },
}
const POLY = {
  kind: 'polygon' as const,
  polygonStage: [
    { x: 440, y: 260 },
    { x: 840, y: 260 },
    { x: 840, y: 460 },
    { x: 440, y: 460 },
  ],
}
const TWO: FingerTip[] = [4, 8]
const ALL: FingerTip[] = [4, 8, 12, 16, 20]

function setup(sens: Partial<Sensitivity> = {}, fingers: FingerTip[] = TWO) {
  const ctx: HandWindowContext & { sensitivity: Sensitivity } = {
    layout: L as Layout,
    mirror: false,
    fingers,
    sensitivity: { ...defaultSensitivity(), ...sens },
  }
  let latest: HandFrame | null = null
  let frameId = 0
  const source = new HandWindowSource({ getContext: () => ctx, latest: () => latest })
  return {
    ctx,
    source,
    /** Đặt HandFrame mới (frameId tăng) tại thời điểm now. */
    frame(spec: FakeHandsSpec | null, now: number) {
      latest = spec ? fakeHandFrame(spec, now, ++frameId) : null
      return latest
    },
  }
}

describe('HandWindowSource', () => {
  it('không có HandFrame: đóng few-points, không đầu ngón; chưa giải lần nào', () => {
    const { source } = setup()
    const s = source.current(1000)
    expect(s.shape).toBeNull()
    expect(s.reason).toBe('few-points')
    expect(s.fingers).toEqual([])
    expect(source.snapshot()).toMatchObject({
      solves: 0,
      resets: 0,
      polygon: null,
      reason: 'few-points',
    })
    expect(describeHandWindow(source.snapshot(), true)).toBe(
      'solver: đóng: few-points · giải 0 · reset 0',
    )
    expect(describeHandWindow(source.snapshot(), false)).toBe('solver: tắt')
  })

  it('hai ngón mỗi tay, tươi: đa giác là hình chữ nhật bốn đầu ngón; cùng HandFrame thì không giải lại; frame mới cùng vị trí giữ đa giác', () => {
    const { source, frame } = setup()
    frame(HANDS, 1000)
    const s1 = source.current(1000)
    expect(s1.shape).toEqual(POLY)
    expect(s1.limited).toBe(false)
    expect(s1.fingers).toHaveLength(4)
    expect(s1.fingers?.every((x) => x.valid)).toBe(true)
    expect(source.snapshot().solves).toBe(1)
    const s2 = source.current(1016)
    expect(s2.shape).toEqual(s1.shape)
    expect(source.snapshot().solves).toBe(1)
    frame(HANDS, 1033)
    const s3 = source.current(1033)
    expect(s3.shape).toEqual(POLY)
    expect(source.snapshot().solves).toBe(2)
    expect(source.snapshot().measure).toMatchObject({ points: 4, shortCells: 10, areaCells: 200 })
    expect(describeHandWindow(source.snapshot(), true)).toBe(
      'solver: mở đa giác 4 đỉnh (440, 260) (840, 260) (840, 460) (440, 460) · giải 2 · reset 0 · 4 điểm · cạnh ngắn 10.00 ô · diện tích 200.0 ô²',
    )
  })

  it('năm ngón mỗi tay: mười điểm, bao lồi chứa mọi đầu ngón và rộng hơn hình chữ nhật hai ngón', () => {
    const { source, frame } = setup({}, ALL)
    frame(HANDS, 1000)
    const s = source.current(1000)
    expect(s.fingers).toHaveLength(10)
    expect(s.fingers?.every((x) => x.valid)).toBe(true)
    expect(s.shape?.kind).toBe('polygon')
    const poly = s.shape?.kind === 'polygon' ? s.shape.polygonStage : []
    expect(poly.length).toBeGreaterThanOrEqual(4)
    const m = source.snapshot().measure!
    expect(m.points).toBe(10)
    expect(m.bbox.w).toBeGreaterThan(400)
    expect(m.areaCells).toBeGreaterThan(200)
    // Mọi điểm nằm trong hoặc trên bao lồi.
    for (const p of m.filtered) {
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[j]
        const b = poly[i]
        expect((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)).toBeGreaterThanOrEqual(-1e-6)
      }
    }
  })

  it('điểm cũ theo sensitivity.pointMaxAgeMs: 700 ms đóng stale-point với mặc định 600 (D-059), mở khi nâng lên 800', () => {
    const { source, frame, ctx } = setup()
    frame({ ...HANDS, ageMs: 700 }, 1000)
    const s = source.current(1000)
    expect(s.reason).toBe('stale-point')
    expect(s.fingers?.every((x) => x.reason === 'stale-point')).toBe(true)
    ctx.sensitivity = { ...ctx.sensitivity, pointMaxAgeMs: 800 }
    expect(source.current(1001).shape).toEqual(POLY)
  })

  it('thiếu một tay: đóng few-points dù tay còn lại đủ điểm (minHands 2); minHands 1 thì mở với bao lồi của một tay', () => {
    const { source, frame, ctx } = setup({}, ALL)
    frame({ left: HANDS.left }, 1000)
    const s = source.current(1000)
    expect(s.reason).toBe('few-points')
    expect(s.fingers).toHaveLength(5)
    ctx.minHands = 1
    frame({ left: HANDS.left }, 1033)
    const t = source.current(1033)
    expect(t.shape?.kind).toBe('polygon')
    expect(source.snapshot().measure?.points).toBe(5)
  })

  it('closed → open thì solver bắt đầu lại: cửa sổ nhảy thẳng tới vị trí mới, không kéo từ vị trí cũ như open → open', () => {
    const shifted: FakeHandsSpec = {
      left: { x: 640, y: 360, spread: 200 },
      right: { x: 1040, y: 360, spread: 200 },
    }
    // open → open: nhảy 200 px trong 33 ms thì One Euro còn trễ (đỉnh trái chưa tới 640).
    const a = setup()
    a.frame(HANDS, 1000)
    a.source.current(1000)
    a.frame(shifted, 1033)
    const sa = a.source.current(1033)
    expect(sa.shape?.kind).toBe('polygon')
    const xa = sa.shape?.kind === 'polygon' ? sa.shape.polygonStage[0].x : NaN
    expect(xa).toBeGreaterThan(500)
    expect(xa).toBeLessThan(639)
    // closed → open: mất tay một frame rồi thấy lại ở chỗ mới → đỉnh trái đúng 640 ngay, resets tăng.
    const b = setup()
    b.frame(HANDS, 1000)
    b.source.current(1000)
    b.frame(null, 1016)
    expect(b.source.current(1016).reason).toBe('few-points')
    b.frame(shifted, 1033)
    const sb = b.source.current(1033)
    expect(sb.shape?.kind === 'polygon' ? sb.shape.polygonStage[0] : null).toEqual({
      x: 640,
      y: 260,
    })
    expect(b.source.snapshot().resets).toBe(1)
  })

  it('đổi layout hay cấu hình ngón (identity mới) thì reset solver và giải lại từ frame hiện tại', () => {
    const { source, frame, ctx } = setup()
    frame(HANDS, 1000)
    source.current(1000)
    ctx.layout = computeLayout({ w: 1280, h: 720 }, { cols: 64, rows: 36 }, { w: 1280, h: 720 })
    const s = source.current(1016)
    expect(s.shape).toEqual(POLY)
    expect(source.snapshot()).toMatchObject({ resets: 1, solves: 2 })
    ctx.fingers = [...ctx.fingers]
    source.current(1033)
    expect(source.snapshot()).toMatchObject({ resets: 2, solves: 3 })
    ctx.mirror = true
    source.current(1050)
    expect(source.snapshot().resets).toBe(3)
    source.reset()
    expect(source.snapshot()).toMatchObject({ resets: 4, polygon: null })
    source.current(1066)
    expect(source.snapshot().solves).toBe(5)
  })

  it('đầu ngón quá gần: too-small từ solver (điểm vẫn hợp lệ); nMin nhỏ hơn thì mở; uncertain thì ambiguous-hands', () => {
    const { source, frame, ctx } = setup()
    const close: FakeHandsSpec = {
      left: { x: 600, y: 360, spread: 40 },
      right: { x: 680, y: 360, spread: 40 },
    }
    frame(close, 1000)
    const s = source.current(1000)
    expect(s.shape).toBeNull()
    expect(s.reason).toBe('too-small')
    expect(s.fingers?.every((x) => x.valid)).toBe(true)
    expect(source.snapshot().reason).toBe('too-small')
    ctx.sensitivity = { ...ctx.sensitivity, nMin: 2 }
    frame(close, 1033)
    expect(source.current(1033).shape?.kind).toBe('polygon')
    frame({ ...HANDS, uncertain: true }, 1066)
    expect(source.current(1066).reason).toBe('ambiguous-hands')
  })

  it('hai frame liên tiếp có cùng ts (ví dụ giả lập): One Euro bỏ qua mẫu trùng thời điểm nhưng cửa sổ vẫn giải', () => {
    const { source, frame } = setup()
    frame(HANDS, 1000)
    source.current(1000)
    frame(HANDS, 1000)
    expect(source.current(1001).shape).toEqual(POLY)
    expect(source.snapshot().solves).toBe(2)
  })
})
