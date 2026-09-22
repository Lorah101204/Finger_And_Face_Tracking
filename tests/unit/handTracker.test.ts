import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { FingerTip } from '../../src/core/types'
import type { HandDetection } from '../../src/hands/handLandmarker'
import { HandTracker } from '../../src/hands/handTracker'

// HAND-01 bước 3 (mục 7.13): id ổn định với chuỗi tổng hợp. Camera 1280 × 720, mỗi frame 33 ms.
const W = 1280
const H = 720
const DT = 33

function det(handedness: 'left' | 'right', x: number, y: number, score = 0.95): HandDetection {
  const landmarksCam = Array.from({ length: 21 }, (_, i) => ({ x: x + i, y: y - i }))
  return {
    handedness,
    score,
    landmarksCam,
    palmCenterCam: { x, y },
    bboxCam: { x: x - 50, y: y - 50, w: 100, h: 100 },
  }
}

describe('HandTracker', () => {
  it('tay đứng yên: id giữ, lastSeenTs và frameId cập nhật, landmark là bản sao', () => {
    const tr = new HandTracker()
    const f0 = tr.update([det('left', 300, 300)], 0, 0, W, H)
    expect(f0.hands.map((h) => h.id)).toEqual([1])
    expect(f0.uncertain).toBe(false)
    const f2 = tr.update([det('left', 302, 299)], 2, 2 * DT, W, H)
    expect(f2.hands).toHaveLength(1)
    expect(f2.hands[0]).toMatchObject({ id: 1, handedness: 'left', lastSeenTs: 2 * DT, frameId: 2 })
    expect(f2.hands[0].palmCenterCam).toEqual({ x: 302, y: 299 })
    expect(tr.stats).toMatchObject({ frames: 2, created: 1, matched: 1, uncertainFrames: 0 })
    f2.hands[0].palmCenterCam.x = 999
    expect(tr.tracks[0].palmCenterCam.x).toBe(302)
  })

  it('hai tay nhãn đúng đi ngang qua nhau: id và handedness không hoán đổi, không uncertain', () => {
    const tr = new HandTracker()
    for (let k = 0; k <= 15; k++) {
      const f = tr.update(
        [det('left', 300 + 40 * k, 360), det('right', 900 - 40 * k, 360)],
        k,
        k * DT,
        W,
        H,
      )
      expect(f.uncertain).toBe(false)
      expect(f.hands.map((h) => h.id)).toEqual([1, 2])
    }
    const [a, b] = tr.tracks
    expect(a).toMatchObject({ id: 1, handedness: 'left' })
    expect(b).toMatchObject({ id: 2, handedness: 'right' })
    expect(a.palmCenterCam.x).toBeGreaterThan(b.palmCenterCam.x)
    expect(tr.stats.uncertainFrames).toBe(0)
    expect(tr.stats.created).toBe(2)
  })

  it('hai tay cùng nhãn chéo nhau: frame chéo là uncertain, track giữ nguyên, không tạo track mới', () => {
    const tr = new HandTracker()
    const f0 = tr.update([det('right', 600, 360), det('right', 700, 360)], 0, 0, W, H)
    expect(f0.hands.map((h) => h.palmCenterCam.x)).toEqual([600, 700])
    // Cả hai detection cùng tới x = 650: mỗi detection có hai ứng viên chi phí bằng nhau.
    const f1 = tr.update([det('right', 650, 360), det('right', 650, 360)], 1, DT, W, H)
    expect(f1.uncertain).toBe(true)
    expect(f1.hands.map((h) => [h.id, h.palmCenterCam.x, h.lastSeenTs])).toEqual([
      [1, 600, 0],
      [2, 700, 0],
    ])
    expect(tr.stats).toMatchObject({ uncertainFrames: 1, created: 2 })
    // Tách ra rõ ràng: ghép theo khoảng cách, không uncertain, vẫn hai id cũ.
    const f2 = tr.update([det('right', 560, 360), det('right', 740, 360)], 2, 2 * DT, W, H)
    expect(f2.uncertain).toBe(false)
    expect(f2.hands.map((h) => [h.id, h.palmCenterCam.x])).toEqual([
      [1, 560],
      [2, 740],
    ])
  })

  // D-059: trackDropMs mặc định 600 ms (bằng tuổi điểm).
  it('tay biến mất rồi hiện lại chỗ khác: trong 600 ms thì thêm track mới, quá 600 ms thì track cũ bị xóa', () => {
    const tr = new HandTracker()
    tr.update([det('left', 300, 300)], 0, 0, W, H)
    const gone = tr.update([], 1, 100, W, H)
    expect(gone.hands.map((h) => h.id)).toEqual([1])
    // Xa hơn matchCostMax (600 px / 1280 = 0,47): không ghép, track mới id 2; track 1 chưa quá 600 ms nên còn.
    const far = tr.update([det('left', 900, 300)], 2, 120, W, H)
    expect(far.hands.map((h) => [h.id, h.palmCenterCam.x])).toEqual([
      [1, 300],
      [2, 900],
    ])
    // Vắng lần ba lúc 500 ms (≤ 600): còn; 700 ms sau lần thấy cuối của track 1 (> 600 ms): xóa; track 2 vẫn được ghép.
    expect(tr.update([det('left', 902, 300)], 3, 500, W, H).hands.map((h) => h.id)).toEqual([1, 2])
    const later = tr.update([det('left', 905, 300)], 4, 700, W, H)
    expect(later.hands.map((h) => h.id)).toEqual([2])
    expect(tr.stats.dropped).toBe(1)
    // Xuất hiện lại đúng chỗ cũ sau khi đã bị xóa: id mới, không dùng lại id 1.
    const back = tr.update([det('left', 905, 300), det('left', 300, 300)], 5, 733, W, H)
    expect(back.hands.map((h) => h.id)).toEqual([2, 3])
  })

  it('nhãn model nhấp nháy một frame: giữ id và handedness; ngược liên tiếp 3 frame thì đổi handedness, giữ id', () => {
    const tr = new HandTracker()
    tr.update([det('left', 300, 300, 0.9)], 0, 0, W, H)
    const flick = tr.update([det('right', 301, 300, 0.9)], 1, DT, W, H)
    expect(flick.hands[0]).toMatchObject({ id: 1, handedness: 'left' })
    expect(flick.hands[0].score).toBeCloseTo(0.1)
    expect(tr.stats.created).toBe(1)
    const ok = tr.update([det('left', 301, 300, 0.9)], 2, 2 * DT, W, H)
    expect(ok.hands[0]).toMatchObject({ id: 1, handedness: 'left', score: 0.9 })
    tr.update([det('right', 301, 300, 0.9)], 3, 3 * DT, W, H)
    tr.update([det('right', 301, 300, 0.9)], 4, 4 * DT, W, H)
    expect(tr.tracks[0].handedness).toBe('left')
    const re = tr.update([det('right', 301, 300, 0.9)], 5, 5 * DT, W, H)
    expect(re.hands[0]).toMatchObject({ id: 1, handedness: 'right', score: 0.9 })
    expect(tr.stats.relabeled).toBe(1)
  })

  it('nhãn khác và cách xa hơn 0,05 bề rộng: không ghép (phạt 0,1 + khoảng cách ≥ 0,15)', () => {
    const tr = new HandTracker()
    tr.update([det('left', 300, 300)], 0, 0, W, H)
    const f = tr.update([det('right', 300 + 70, 300)], 1, DT, W, H)
    expect(f.hands.map((h) => h.id)).toEqual([1, 2])
  })

  it('đổi kích thước camera hoặc reset(): xóa track, id tiếp tục tăng', () => {
    const tr = new HandTracker()
    tr.update([det('left', 300, 300)], 0, 0, W, H)
    const small = tr.update([det('left', 150, 150)], 1, DT, 640, 360)
    expect(small.hands.map((h) => h.id)).toEqual([2])
    tr.reset()
    expect(tr.tracks).toEqual([])
    const again = tr.update([det('left', 150, 150)], 2, 2 * DT, 640, 360)
    expect(again.hands.map((h) => h.id)).toEqual([3])
  })

  it('pipeline chậm: vắng một lần cập nhật dù quá 600 ms vẫn giữ track (dropFrames 2); frame uncertain tính là vắng', () => {
    const tr = new HandTracker()
    tr.update([det('left', 300, 300)], 0, 0, W, H)
    // Kết quả mỗi giây: thấy lại sau 1000 ms vẫn là id 1.
    expect(tr.update([det('left', 310, 300)], 1, 1000, W, H).hands.map((h) => h.id)).toEqual([1])
    // Vắng một lần (2000 ms): giữ; vắng lần hai (3000 ms): xóa.
    expect(tr.update([], 2, 2000, W, H).hands.map((h) => h.id)).toEqual([1])
    expect(tr.update([], 3, 3000, W, H).hands).toEqual([])
    // Uncertain kéo dài: hai frame uncertain quá 600 ms thì track cũ bị xóa (không ghép theo vị trí cũ nữa).
    tr.update([det('right', 600, 300), det('right', 700, 300)], 4, 4000, W, H)
    expect(
      tr.update([det('right', 650, 300), det('right', 650, 300)], 5, 4400, W, H).uncertain,
    ).toBe(true)
    const f6 = tr.update([det('right', 650, 300), det('right', 650, 300)], 6, 4800, W, H)
    expect(f6.uncertain).toBe(true)
    expect(f6.hands).toEqual([])
    expect(
      tr
        .update([det('right', 560, 300), det('right', 740, 300)], 7, 4900, W, H)
        .hands.map((h) => h.id),
    ).toEqual([4, 5])
  })

  it('tùy chọn: dropMs, dropFrames, matchCostMax, ambiguityDelta, relabelFrames', () => {
    const tr = new HandTracker({
      dropMs: 50,
      matchCostMax: 0.5,
      ambiguityDelta: 0.2,
      relabelFrames: 1,
    })
    tr.update([det('left', 300, 300)], 0, 0, W, H)
    // matchCostMax 0,5: ghép được dù cách 400 px; relabelFrames 1: đổi nhãn ngay.
    const f = tr.update([det('right', 700, 300)], 1, DT, W, H)
    expect(f.hands.map((h) => [h.id, h.handedness])).toEqual([[1, 'right']])
    // dropMs 50 và mặc định dropFrames 2: vắng một lần (dù đã 60 ms) còn giữ, vắng lần hai thì xóa.
    expect(tr.update([], 2, DT + 60, W, H).hands).toHaveLength(1)
    expect(tr.update([], 3, DT + 120, W, H).hands).toEqual([])
    // ambiguityDelta 0,2: hai ứng viên chênh 0,08 vẫn là uncertain.
    tr.update([det('right', 600, 300), det('right', 700, 300)], 3, 200, W, H)
    const amb = tr.update([det('right', 650, 300), det('right', 750, 300)], 4, 233, W, H)
    expect(amb.uncertain).toBe(true)
  })
})

// ROI-04 (mục 7.32): pose giữ theo track qua các frame (debounce), không cập nhật ở frame uncertain, track tạo lại thì
// phân loại ngay từ frame đầu.
type FixtureHand = {
  image: string
  width: number
  height: number
  raised: FingerTip[]
  landmarksNorm: [number, number, number][]
  worldLandmarks: [number, number, number][]
}
const POSE_FIXTURE = JSON.parse(
  readFileSync(new URL('./fixtures/hands-pose.json', import.meta.url), 'utf8'),
) as { hands: FixtureHand[] }

/** Detection từ fixture, dời tới (x, y) theo tâm lòng bàn tay của nó. */
function fixtureDet(
  h: FixtureHand,
  handedness: 'left' | 'right',
  x: number,
  y: number,
): HandDetection {
  const raw = h.landmarksNorm.map(([nx, ny]) => ({ x: nx * h.width, y: ny * h.height }))
  const palm = [0, 5, 9, 13, 17].map((i) => raw[i])
  const cx = palm.reduce((a, p) => a + p.x, 0) / 5
  const cy = palm.reduce((a, p) => a + p.y, 0) / 5
  const landmarksCam = raw.map((p) => ({ x: p.x - cx + x, y: p.y - cy + y }))
  return {
    handedness,
    score: 0.95,
    landmarksCam,
    landmarksWorld: h.worldLandmarks.map(([wx, wy, wz]) => ({ x: wx, y: wy, z: wz })),
    palmCenterCam: { x, y },
    bboxCam: { x: x - 100, y: y - 100, w: 200, h: 200 },
  }
}
const raisedOf = (h: { pose?: Record<number, { raised: boolean }> }) =>
  ([4, 8, 12, 16, 20] as const).filter((t) => h.pose?.[t].raised)

describe('pose theo track (ROI-04)', () => {
  const open = POSE_FIXTURE.hands[1]
  const point = POSE_FIXTURE.hands.find((h) => h.image === 'pointing_up.jpg')!

  it('track mới phân loại ngay; đổi tư thế cần ba frame; landmarksWorld là bản sao', () => {
    const tr = new HandTracker()
    const f0 = tr.update([fixtureDet(open, 'right', 640, 360)], 0, 0, W, H)
    expect(raisedOf(f0.hands[0])).toEqual([4, 8, 12, 16, 20])
    expect(f0.hands[0].landmarksWorld).toHaveLength(21)
    f0.hands[0].landmarksWorld![0].x = 999
    expect(tr.tracks[0].landmarksWorld![0].x).not.toBe(999)
    for (let k = 1; k <= 2; k++) {
      const f = tr.update([fixtureDet(point, 'right', 640, 360)], k, k * DT, W, H)
      expect(f.hands[0].id).toBe(1)
      expect(raisedOf(f.hands[0])).toEqual([4, 8, 12, 16, 20])
    }
    const f3 = tr.update([fixtureDet(point, 'right', 640, 360)], 3, 3 * DT, W, H)
    expect(f3.hands[0].id).toBe(1)
    expect(raisedOf(f3.hands[0])).toEqual([8])
  })

  it('frame uncertain không cập nhật pose; track bị xóa rồi tạo lại thì phân loại ngay theo tư thế mới', () => {
    const tr = new HandTracker({ dropMs: 100, dropFrames: 1 })
    tr.update([fixtureDet(open, 'left', 300, 360), fixtureDet(open, 'right', 340, 360)], 0, 0, W, H)
    // Hai detection cùng nhãn, cùng vị trí giữa hai track: track trái có hai ứng viên chi phí bằng nhau → uncertain,
    // pose giữ nguyên.
    const fu = tr.update(
      [fixtureDet(point, 'left', 320, 360), fixtureDet(point, 'left', 320, 360)],
      1,
      DT,
      W,
      H,
    )
    expect(fu.uncertain).toBe(true)
    expect(fu.hands.map(raisedOf)).toEqual([
      [4, 8, 12, 16, 20],
      [4, 8, 12, 16, 20],
    ])
    // Vắng 200 ms: track xóa; xuất hiện lại với tư thế chỉ trỏ → id mới, pose theo frame đầu.
    tr.update([], 2, 200, W, H)
    expect(tr.tracks).toHaveLength(0)
    const fn = tr.update([fixtureDet(point, 'right', 640, 360)], 3, 233, W, H)
    expect(fn.hands[0].id).toBeGreaterThan(2)
    expect(raisedOf(fn.hands[0])).toEqual([8])
  })
})
