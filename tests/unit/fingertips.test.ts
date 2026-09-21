import { describe, expect, it } from 'vitest'
import { DEFAULTS } from '../../src/core/config'
import { cameraToStage, computeLayout } from '../../src/core/coords'
import type { FingerPose, FingerTip, HandFrame, HandPose, HandTrack } from '../../src/core/types'
import {
  describeFingertips,
  evaluateFingertips,
  fingerLabel,
  fingertipsCloseReason,
  fingertipsGuidance,
  toPoints,
  validHands,
  validPoints,
} from '../../src/hands/fingertips'

// ROI-03 (mục 7.26, D-047): mọi đầu ngón đã chọn của mọi tay là điểm ứng viên; hợp lệ khi tươi (≤ 150 ms), trong
// bảng, không uncertain, score đủ; điểm không hợp lệ chỉ bị loại; đóng khi thiếu minPoints điểm của minHands tay với
// lý do trội theo ưu tiên mục 5.8.
const L = computeLayout({ w: 1280, h: 720 }, { cols: 32, rows: 32 }, { w: 1280, h: 720 })
const ALL: FingerTip[] = [4, 8, 12, 16, 20]

/** Track với landmark i tại (x + i, y + 2 i): tip 4 ở (x + 4, y + 8), tip 20 ở (x + 20, y + 40). */
function track(
  id: number,
  handedness: 'left' | 'right',
  x: number,
  y: number,
  opts: { score?: number; lastSeenTs?: number } = {},
): HandTrack {
  const landmarksCam = Array.from({ length: 21 }, (_, i) => ({ x: x + i, y: y + 2 * i }))
  return {
    id,
    handedness,
    score: opts.score ?? 0.95,
    palmCenterCam: { x, y },
    bboxCam: { x, y, w: 20, h: 40 },
    landmarksCam,
    lastSeenTs: opts.lastSeenTs ?? 1000,
    frameId: 1,
  }
}

function frame(hands: HandTrack[], ts = 1000, uncertain = false): HandFrame {
  return { frameId: 1, ts, hands, uncertain }
}

const LEFT = track(1, 'left', 500, 300)
const RIGHT = track(2, 'right', 800, 300)

describe('evaluateFingertips', () => {
  it('hai tay trong khung, tươi: 10 điểm hợp lệ đúng ngón, đúng tay, tuổi, trackId và score', () => {
    const st = evaluateFingertips(frame([LEFT, RIGHT]), ALL, L, false, 1100)
    expect(st).toHaveLength(10)
    expect(st.every((s) => s.valid && s.reason === undefined)).toBe(true)
    expect(st.map((s) => s.hand)).toEqual([...Array(5).fill('left'), ...Array(5).fill('right')])
    expect(st.map((s) => s.tip)).toEqual([...ALL, ...ALL])
    expect(st[0]).toMatchObject({
      trackId: 1,
      tip: 4,
      pCam: { x: 504, y: 308 },
      ts: 1000,
      ageMs: 100,
      score: 0.95,
    })
    expect(st[0].pStage).toEqual(cameraToStage({ x: 504, y: 308 }, L, false))
    expect(st[9]).toMatchObject({ trackId: 2, tip: 20, pCam: { x: 820, y: 340 } })
    expect(fingerLabel('left', 4)).toBe('Trái-cái')
    expect(fingerLabel('right', 16)).toBe('Phải-áp út')
    expect(validHands(st)).toBe(2)
    expect(fingertipsCloseReason(st)).toBeNull()
    expect(fingertipsGuidance(st)).toBeNull()
  })

  it('cấu hình ngón: chỉ ngón đã chọn; không HandFrame → rỗng, few-points; mirror đảo trục x', () => {
    const two = evaluateFingertips(frame([LEFT, RIGHT]), [4, 8], L, false, 1000)
    expect(two.map((s) => [s.hand, s.tip])).toEqual([
      ['left', 4],
      ['left', 8],
      ['right', 4],
      ['right', 8],
    ])
    expect(evaluateFingertips(null, ALL, L, false, 1000)).toEqual([])
    expect(fingertipsCloseReason([])).toBe('few-points')
    expect(fingertipsGuidance([])).toBe(
      'Đưa hai bàn tay vào khung hình: cửa sổ mở theo các đầu ngón (cần ít nhất 3 đầu ngón).',
    )
    const m = evaluateFingertips(frame([LEFT]), [4], L, true, 1000)
    expect(m[0].pStage).toEqual(cameraToStage({ x: 504, y: 308 }, L, true))
  })

  it('điểm cũ chỉ bị loại: 150 ms vẫn hợp lệ, 151 ms stale-point; còn đủ điểm thì vẫn mở, thiếu thì đóng stale-point', () => {
    const old = track(2, 'right', 800, 300, { lastSeenTs: 849 })
    const st = evaluateFingertips(frame([LEFT, old]), ALL, L, false, 1000)
    expect(st.slice(0, 5).every((s) => s.valid)).toBe(true)
    expect(st.slice(5).every((s) => s.reason === 'stale-point')).toBe(true)
    // Tay phải cũ hết → chỉ một tay có điểm hợp lệ: đóng, lý do trội là stale-point.
    expect(validHands(st)).toBe(1)
    expect(fingertipsCloseReason(st)).toBe('stale-point')
    expect(fingertipsGuidance(st)).toBe(
      'Đang thấy 5 đầu ngón hợp lệ, cần ít nhất 3 của 2 tay: 5 đầu ngón cũ.',
    )
    // Một tay cũ một phần vẫn mở khi mỗi tay còn điểm hợp lệ (minHands 1 thì một tay đủ).
    expect(fingertipsCloseReason(st, { minHands: 1 })).toBeNull()
    const edge = evaluateFingertips(
      frame([LEFT, track(2, 'right', 800, 300, { lastSeenTs: 850 })]),
      ALL,
      L,
      false,
      1000,
    )
    expect(edge.every((s) => s.valid)).toBe(true)
    expect(evaluateFingertips(frame([LEFT]), ALL, L, false, 1300, { maxAgeMs: 300 })[0].valid).toBe(
      true,
    )
  })

  it('điểm ngoài phần camera hiện trên bảng: out-of-board (ưu tiên trước cũ), điểm còn lại vẫn hợp lệ', () => {
    // Camera 1280 × 720 trên bảng 32 × 32 ô 22 px (cover): bảng cao 704 px, camera cắt ngang hai bên.
    const far = track(2, 'right', 1250, 300)
    const st = evaluateFingertips(frame([LEFT, far]), ALL, L, false, 1000)
    const right = st.filter((s) => s.hand === 'right')
    expect(right.every((s) => s.reason === 'out-of-board')).toBe(true)
    expect(st.filter((s) => s.hand === 'left').every((s) => s.valid)).toBe(true)
    expect(fingertipsCloseReason(st)).toBe('out-of-board')
    expect(fingertipsGuidance(st)).toMatch(/5 đầu ngón ngoài bảng/)
    // Một tay có 3 điểm ngoài bảng và 2 điểm cũ, tay kia đủ: vẫn mở vì còn ≥ 3 điểm của 2 tay.
    const mixed = [
      ...st.filter((s) => s.hand === 'left'),
      ...right.slice(0, 2).map((s) => ({ ...s, valid: true, reason: undefined })),
      ...right.slice(2),
    ]
    expect(fingertipsCloseReason(mixed)).toBeNull()
  })

  it('HandFrame uncertain: mọi điểm ambiguous-hands, ưu tiên cao nhất; score thấp → low-score tính như thiếu', () => {
    const st = evaluateFingertips(frame([LEFT, RIGHT], 1000, true), ALL, L, false, 1000)
    expect(st.every((s) => s.reason === 'ambiguous-hands')).toBe(true)
    expect(fingertipsCloseReason(st)).toBe('ambiguous-hands')
    expect(fingertipsGuidance(st)).toMatch(/chéo nhau/)
    const low = evaluateFingertips(
      frame([LEFT, track(2, 'right', 800, 300, { score: 0.3 })]),
      ALL,
      L,
      false,
      1000,
    )
    expect(low.filter((s) => s.hand === 'right').every((s) => s.reason === 'low-score')).toBe(true)
    expect(fingertipsCloseReason(low)).toBe('few-points')
    expect(fingertipsGuidance(low)).toMatch(/5 đầu ngón chưa rõ tay/)
    expect(fingertipsCloseReason(low, { minHands: 1 })).toBeNull()
  })

  it('thiếu tay: một tay đủ điểm vẫn đóng few-points với minHands 2, hướng dẫn nêu tay còn thiếu; ít ngón → few-points', () => {
    const one = evaluateFingertips(frame([LEFT]), ALL, L, false, 1000)
    expect(one.every((s) => s.valid)).toBe(true)
    expect(fingertipsCloseReason(one)).toBe('few-points')
    expect(fingertipsGuidance(one)).toBe(
      'Đang thấy 5 đầu ngón hợp lệ, cần ít nhất 3 của 2 tay: chưa thấy tay phải.',
    )
    expect(fingertipsCloseReason(one, { minHands: 1 })).toBeNull()
    // Hai tay nhưng chỉ chọn một ngón: 2 điểm < 3.
    const few = evaluateFingertips(frame([LEFT, RIGHT]), [8], L, false, 1000)
    expect(fingertipsCloseReason(few)).toBe('few-points')
    expect(fingertipsGuidance(few)).toBe(
      'Đang thấy 2 đầu ngón hợp lệ, cần ít nhất 3 của 2 tay: giơ thêm ngón.',
    )
    expect(fingertipsCloseReason(few, { minPoints: 2 })).toBeNull()
    // Hai track cùng nhãn tay: cả hai đều góp điểm nhưng chỉ tính một tay.
    const dup = evaluateFingertips(frame([LEFT, track(3, 'left', 700, 300)]), ALL, L, false, 1000)
    expect(dup).toHaveLength(10)
    expect(validHands(dup)).toBe(1)
    expect(fingertipsCloseReason(dup)).toBe('few-points')
  })

  it('toPoints giữ hand, tip, trackId, valid, reason và bản sao pStage; describeFingertips theo tay', () => {
    const st = evaluateFingertips(
      frame([LEFT, track(2, 'right', 800, 300, { lastSeenTs: 800 })]),
      [4, 8],
      L,
      false,
      1000,
    )
    const pts = toPoints(st)
    expect(pts).toHaveLength(4)
    expect(pts[0]).toEqual({ hand: 'left', tip: 4, trackId: 1, valid: true, pStage: st[0].pStage })
    expect(pts[0].pStage).not.toBe(st[0].pStage)
    expect(pts[3]).toMatchObject({ hand: 'right', tip: 8, valid: false, reason: 'stale-point' })
    expect(describeFingertips(st)).toBe('trái 2/2 ok · phải 0/2 (2 stale-point)')
    expect(describeFingertips([])).toBe('')
    expect(validPoints(st)).toHaveLength(2)
    expect(DEFAULTS.hands.fingers).toEqual(ALL)
  })
})

// ROI-04 (mục 7.32, D-055): ngón gập theo track.pose là `folded`, bị loại như điểm cũ; thiếu điểm vì gập → few-points;
// hướng dẫn nêu số ngón gập; raisedOnly false thì như ROI-03; không có pose thì mọi ngón coi là giơ.
function poseOf(raised: FingerTip[]): HandPose {
  const one = (t: FingerTip): FingerPose => ({
    raised: raised.includes(t),
    ratio: raised.includes(t) ? 1.3 : 0.6,
    angle: null,
    abduction: null,
    inPalm: !raised.includes(t),
    streak: 0,
  })
  return { 4: one(4), 8: one(8), 12: one(12), 16: one(16), 20: one(20) }
}

describe('folded (ROI-04)', () => {
  it('ngón gập là folded và bị loại; ngón giơ hợp lệ; raisedOnly false thì mọi ngón hợp lệ; không có pose thì như giơ', () => {
    const left = { ...LEFT, pose: poseOf([4, 8, 12]) }
    const right = { ...RIGHT, pose: poseOf([8, 12]) }
    const out = evaluateFingertips(frame([left, right]), ALL, L, true, 1000)
    expect(out).toHaveLength(10)
    expect(validPoints(out).map((s) => `${s.hand}:${s.tip}`)).toEqual([
      'left:4',
      'left:8',
      'left:12',
      'right:8',
      'right:12',
    ])
    expect(out.filter((s) => s.reason === 'folded').map((s) => `${s.hand}:${s.tip}`)).toEqual([
      'left:16',
      'left:20',
      'right:4',
      'right:16',
      'right:20',
    ])
    expect(fingertipsCloseReason(out)).toBeNull()
    expect(describeFingertips(out)).toBe('trái 3/5 (2 folded) · phải 2/5 (3 folded)')
    const all = evaluateFingertips(frame([left, right]), ALL, L, true, 1000, { raisedOnly: false })
    expect(validPoints(all)).toHaveLength(10)
    expect(validPoints(evaluateFingertips(frame([LEFT, RIGHT]), ALL, L, true, 1000))).toHaveLength(
      10,
    )
  })

  it('cũ và ngoài bảng đứng trước gập; gập tính là thiếu (few-points) với hướng dẫn nêu số ngón gập; mọi ngón gập thì bảo xòe ngón', () => {
    const left = { ...LEFT, pose: poseOf([8]) }
    const right = { ...RIGHT, pose: poseOf([8]) }
    const out = evaluateFingertips(frame([left, right]), ALL, L, true, 1000)
    expect(validPoints(out)).toHaveLength(2)
    expect(fingertipsCloseReason(out)).toBe('few-points')
    expect(fingertipsGuidance(out)).toBe(
      'Đang thấy 2 đầu ngón hợp lệ, cần ít nhất 3 của 2 tay: 8 đầu ngón đang gập.',
    )
    expect(fingertipsGuidance(out, {}, 'en')).toBe(
      'Seeing 2 valid fingertips, need at least 3 from 2 hands: 8 folded fingertips.',
    )
    // Điểm cũ đứng trước gập: track cũ 300 ms → mọi điểm stale-point, không còn folded.
    const stale = evaluateFingertips(
      frame([{ ...left, lastSeenTs: 700 }, right]),
      ALL,
      L,
      true,
      1000,
    )
    expect(stale.filter((s) => s.hand === 'left').every((s) => s.reason === 'stale-point')).toBe(
      true,
    )
    expect(fingertipsCloseReason(stale)).toBe('stale-point')
    // Mọi ngón gập: câu riêng.
    const fists = evaluateFingertips(
      frame([
        { ...LEFT, pose: poseOf([]) },
        { ...RIGHT, pose: poseOf([]) },
      ]),
      ALL,
      L,
      true,
      1000,
    )
    expect(validPoints(fists)).toHaveLength(0)
    expect(fingertipsCloseReason(fists)).toBe('few-points')
    expect(fingertipsGuidance(fists)).toBe(
      'Mọi đầu ngón đang gập: xòe các ngón muốn dùng ra (cần ít nhất 3 đầu ngón của 2 tay).',
    )
    expect(toPoints(fists).every((p) => p.reason === 'folded' && !p.valid)).toBe(true)
  })
})
