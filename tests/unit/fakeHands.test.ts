import { describe, expect, it } from 'vitest'
import { HAND_LANDMARKS } from '../../src/core/handLandmarks'
import { FAKE_HAND_IDS, fakeHandFrame } from '../../src/debug/fakeHands'

// ROI-01 (TEST-00): tay giả lập có 21 landmark, đầu ngón cái và trỏ đúng vị trí, id cố định, tuổi theo ageMs,
// rung có biên và lặp lại được.
describe('fakeHandFrame', () => {
  it('hai tay: 21 landmark, tip 4 và 8 tại (x, y ± spread / 2), id 1 và 2, ts = now − ageMs', () => {
    const f = fakeHandFrame(
      { left: { x: 440, y: 360, spread: 200 }, right: { x: 840, y: 360 }, ageMs: 20 },
      1000,
      7,
    )
    expect(f).toMatchObject({ frameId: 7, ts: 980, uncertain: false })
    expect(f.hands.map((h) => [h.id, h.handedness])).toEqual([
      [FAKE_HAND_IDS.left, 'left'],
      [FAKE_HAND_IDS.right, 'right'],
    ])
    const [l, r] = f.hands
    expect(l.landmarksCam).toHaveLength(HAND_LANDMARKS)
    expect(l.landmarksCam[4]).toEqual({ x: 440, y: 460 })
    expect(l.landmarksCam[8]).toEqual({ x: 440, y: 260 })
    expect(r.landmarksCam[4]).toEqual({ x: 840, y: 420 })
    expect(r.landmarksCam[8]).toEqual({ x: 840, y: 300 })
    expect(l.lastSeenTs).toBe(980)
    expect(l.frameId).toBe(7)
    expect(l.score).toBe(0.99)
    expect(l.bboxCam.x).toBeLessThanOrEqual(440)
    expect(l.bboxCam.x + l.bboxCam.w).toBeGreaterThanOrEqual(440)
    expect(Math.abs(l.palmCenterCam.x - 440)).toBeLessThan(40)
  })

  it('một tay hoặc không tay; uncertain; rung trong ±jitter và lặp lại theo frameId', () => {
    expect(
      fakeHandFrame({ right: { x: 100, y: 100 } }, 0, 1).hands.map((h) => h.handedness),
    ).toEqual(['right'])
    expect(fakeHandFrame({}, 0, 1).hands).toEqual([])
    expect(fakeHandFrame({ left: { x: 1, y: 1 }, uncertain: true }, 0, 1).uncertain).toBe(true)
    const spec = { left: { x: 440, y: 360, spread: 200 }, jitter: 3 }
    const a = fakeHandFrame(spec, 0, 5)
    const b = fakeHandFrame(spec, 0, 5)
    const c = fakeHandFrame(spec, 0, 6)
    expect(a.hands[0].landmarksCam).toEqual(b.hands[0].landmarksCam)
    expect(a.hands[0].landmarksCam).not.toEqual(c.hands[0].landmarksCam)
    const tip = a.hands[0].landmarksCam[4]
    expect(Math.abs(tip.x - 440)).toBeLessThanOrEqual(3)
    expect(Math.abs(tip.y - 460)).toBeLessThanOrEqual(3)
    expect(tip).not.toEqual({ x: 440, y: 460 })
  })
})

// PERF-01 (soak): quỹ đạo tròn cho cả hai tay theo now, không đổi kích thước hay tuổi.
describe('fakeHandFrame orbit', () => {
  it('orbit dời cả hai tay cùng một vector (r·cos, r·sin) theo pha 2π·now / periodMs', () => {
    const spec = {
      left: { x: 400, y: 300, spread: 100 },
      right: { x: 600, y: 300, spread: 100 },
      orbit: { radius: 50, periodMs: 4000 },
    }
    const at = (now: number) => fakeHandFrame(spec, now, 1).hands.map((h) => h.landmarksCam[4])
    const [l0, r0] = at(0)
    expect(l0).toEqual({ x: 450, y: 350 })
    expect(r0).toEqual({ x: 650, y: 350 })
    const [l1, r1] = at(1000)
    expect(l1.x).toBeCloseTo(400, 6)
    expect(l1.y).toBeCloseTo(400, 6)
    expect(r1.x - l1.x).toBeCloseTo(200, 6)
    const [l2] = at(2000)
    expect(l2.x).toBeCloseTo(350, 6)
    expect(l2.y).toBeCloseTo(350, 6)
    // Không có orbit hoặc chu kỳ 0: đứng yên.
    expect(fakeHandFrame({ ...spec, orbit: undefined }, 999, 1).hands[0].landmarksCam[4]).toEqual({
      x: 400,
      y: 350,
    })
    expect(
      fakeHandFrame({ ...spec, orbit: { radius: 50, periodMs: 0 } }, 999, 1).hands[0]
        .landmarksCam[4],
    ).toEqual({ x: 450, y: 350 })
  })
})
