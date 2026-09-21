import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULTS } from '../../src/core/config'
import type { FingerTip, HandPose, Point, Point3 } from '../../src/core/types'
import {
  classifyFingers,
  fingerMetrics,
  fingerVote,
  raisedCount,
  resolvePoseOptions,
} from '../../src/hands/fingerPose'

// ROI-04 (mục 7.32, D-055): ngón duỗi/gập từ hình học landmark trên fixture thật (tools/probe-fingers.mjs --json: hai
// bàn tay xòe của hands.jpg, ngón trỏ của pointing_up.jpg, ngón cái của thumbs_up.jpg); dải Schmitt giữ trạng thái;
// debounce ba frame; track mới phân loại ngay; thiếu landmark thì fail-open.
type FixtureHand = {
  image: string
  width: number
  height: number
  label: string
  raised: FingerTip[]
  landmarksNorm: [number, number, number][]
  worldLandmarks: [number, number, number][]
}
const FIXTURE = JSON.parse(
  readFileSync(new URL('./fixtures/hands-pose.json', import.meta.url), 'utf8'),
) as { hands: FixtureHand[] }
const ALL: FingerTip[] = [4, 8, 12, 16, 20]

function cam(h: FixtureHand): Point[] {
  return h.landmarksNorm.map(([x, y]) => ({ x: x * h.width, y: y * h.height }))
}
function world(h: FixtureHand): Point3[] {
  return h.worldLandmarks.map(([x, y, z]) => ({ x, y, z }))
}
function raisedOf(pose: HandPose): FingerTip[] {
  return ALL.filter((t) => pose[t].raised)
}

describe('fingerPose trên fixture', () => {
  it('bốn bàn tay: mọi ngón phân loại đúng ngay frame đầu (world landmarks)', () => {
    expect(FIXTURE.hands).toHaveLength(4)
    for (const h of FIXTURE.hands) {
      const pose = classifyFingers(cam(h), world(h), null)
      expect(raisedOf(pose), `${h.image} ${h.label}`).toEqual(h.raised)
      expect(raisedCount(pose)).toBe(h.raised.length)
    }
  })

  it('độ đo nằm trong khoảng đã đo (dung sai làm tròn): duỗi tỉ lệ ≥ 1,15 và góc ≥ 140°, gập tỉ lệ ≤ 0,85 và góc ≤ 106°; ngón cái theo dang và lòng bàn tay', () => {
    for (const h of FIXTURE.hands) {
      for (const tip of ALL) {
        const m = fingerMetrics(cam(h), world(h), tip)!
        expect(m).not.toBeNull()
        const raised = h.raised.includes(tip)
        if (tip === 4) {
          if (raised) {
            // Ngón cái phải của hands.jpg dang 0,918: nằm trong dải 0,85–1,0 nên giơ nhờ frame đầu fail-open.
            expect(m.abduction!).toBeGreaterThanOrEqual(0.9)
            expect(m.inPalm).toBe(false)
          } else {
            expect(m.inPalm || m.abduction! < 0.85).toBe(true)
          }
          continue
        }
        if (raised) {
          expect(m.ratio, `${h.image} ${tip}`).toBeGreaterThanOrEqual(1.15)
          expect(m.angle!, `${h.image} ${tip}`).toBeGreaterThanOrEqual(140)
          expect(m.inPalm).toBe(false)
        } else {
          expect(m.ratio, `${h.image} ${tip}`).toBeLessThanOrEqual(0.85)
          expect(m.angle!, `${h.image} ${tip}`).toBeLessThanOrEqual(106)
        }
      }
    }
  })

  it('không có world landmarks: tỉ lệ 2D với cùng ngưỡng cho bốn ngón ra cùng kết quả trên fixture', () => {
    for (const h of FIXTURE.hands) {
      const pose = classifyFingers(cam(h), undefined, null)
      for (const tip of ALL) {
        if (tip === 4) continue
        expect(pose[tip].raised, `${h.image} ${tip}`).toBe(h.raised.includes(tip))
        expect(pose[tip].angle).toBeNull()
      }
    }
  })
})

describe('fingerVote và debounce', () => {
  const opts = resolvePoseOptions()

  it('dải giữa hai ngưỡng bỏ phiếu null; ngoài dải bỏ phiếu rõ; ngón cái theo dang và lòng bàn tay', () => {
    const base = { angle: 160, abduction: 1.1, inPalm: false }
    expect(fingerVote(8, { ...base, ratio: 1.3 }, opts)).toBe(true)
    expect(fingerVote(8, { ...base, ratio: 0.97 }, opts)).toBeNull()
    expect(fingerVote(8, { ...base, ratio: 0.6 }, opts)).toBe(false)
    expect(fingerVote(8, { ...base, ratio: 1.3, angle: 100 }, opts)).toBe(false)
    expect(fingerVote(8, { ...base, ratio: 1.3, angle: 128 }, opts)).toBeNull()
    expect(fingerVote(8, { ...base, ratio: 1.3, inPalm: true }, opts)).toBe(false)
    expect(fingerVote(8, { ...base, ratio: 1.3, angle: null }, opts)).toBe(true)
    expect(fingerVote(4, { ...base, ratio: 0.5, abduction: 1.2 }, opts)).toBe(true)
    expect(fingerVote(4, { ...base, ratio: 2, abduction: 0.9 }, opts)).toBeNull()
    expect(fingerVote(4, { ...base, ratio: 2, abduction: 0.7 }, opts)).toBe(false)
    expect(fingerVote(4, { ...base, ratio: 2, abduction: 1.2, inPalm: true }, opts)).toBe(false)
    expect(fingerVote(4, { ...base, ratio: 2, abduction: null }, opts)).toBeNull()
    expect(DEFAULTS.hands.pose.ratioFolded).toBeLessThan(DEFAULTS.hands.pose.ratioRaised)
    expect(DEFAULTS.hands.pose.angleFolded).toBeLessThan(DEFAULTS.hands.pose.angleRaised)
    expect(DEFAULTS.hands.pose.abductionFolded).toBeLessThan(DEFAULTS.hands.pose.abductionRaised)
  })

  it('đổi trạng thái cần debounceFrames frame liên tiếp ở phía kia (mặc định 3); track mới đổi ngay; streak về 0 khi phiếu quay lại', () => {
    const open = FIXTURE.hands[0]
    const point = FIXTURE.hands.find((h) => h.image === 'pointing_up.jpg')!
    let pose = classifyFingers(cam(open), world(open), null)
    expect(raisedOf(pose)).toEqual(ALL)
    // Hai frame gập: giữ duỗi, streak tăng; frame thứ ba đổi.
    pose = classifyFingers(cam(point), world(point), pose)
    expect(raisedOf(pose)).toEqual(ALL)
    expect(pose[12].streak).toBe(1)
    pose = classifyFingers(cam(point), world(point), pose)
    expect(raisedOf(pose)).toEqual(ALL)
    expect(pose[12].streak).toBe(2)
    pose = classifyFingers(cam(point), world(point), pose)
    expect(raisedOf(pose)).toEqual([8])
    expect(pose[12].streak).toBe(0)
    // Một frame xòe lại rồi gập: streak về 0 (đếm lại từ đầu).
    pose = classifyFingers(cam(open), world(open), pose)
    expect(raisedOf(pose)).toEqual([8])
    expect(pose[12].streak).toBe(1)
    pose = classifyFingers(cam(point), world(point), pose)
    expect(pose[12].streak).toBe(0)
    expect(raisedOf(pose)).toEqual([8])
    // debounceFrames 1: đổi ngay.
    const fast = classifyFingers(cam(open), world(open), pose, { debounceFrames: 1 })
    expect(raisedOf(fast)).toEqual(ALL)
    // Track mới (prev null) lấy kết quả frame đầu.
    expect(raisedOf(classifyFingers(cam(point), world(point), null))).toEqual([8])
  })

  it('thiếu landmark hay lòng bàn tay suy biến: lần đầu là duỗi (fail-open), có prev thì giữ prev; không sửa prev', () => {
    const few: Point[] = [{ x: 0, y: 0 }]
    expect(raisedOf(classifyFingers(few, undefined, null))).toEqual(ALL)
    const point = FIXTURE.hands.find((h) => h.image === 'pointing_up.jpg')!
    const prev = classifyFingers(cam(point), world(point), null)
    const snapshot = JSON.stringify(prev)
    expect(raisedOf(classifyFingers(few, undefined, prev))).toEqual([8])
    const flat = Array.from({ length: 21 }, () => ({ x: 5, y: 5 }))
    expect(raisedOf(classifyFingers(flat, undefined, prev))).toEqual([8])
    expect(JSON.stringify(prev)).toBe(snapshot)
    expect(raisedCount(undefined)).toBe(5)
  })
})
