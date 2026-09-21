// ROI-01 (TEST-00): HandFrame giả lập cho kịch bản window.__scenario.hands(spec): hai bàn tay với 21 landmark
// tại vị trí xác định (px camera, chưa mirror) để e2e kiểm solver, hysteresis, kẹp mép và độ nhạy mà không cần
// ảnh tay thật hay worker. Đầu ngón cái (4) ở (x, y + spread / 2), đầu ngón trỏ (8) ở (x, y − spread / 2): bốn đầu ngón cái, trỏ
// mặc định của hai tay tại (lx, ly) và (rx, ry) tạo hình chữ nhật rộng |rx − lx| và cao spread. Rung (jitter) giả
// ngẫu nhiên lặp lại được theo frameId để kiểm hysteresis. Chỉ dùng khi ?debug=1; không có gì rời trình duyệt (I9).
// ROI-04 (D-055): `raised` chọn ngón đang giơ của mỗi tay (mặc định cả năm); ngón gập có PIP, DIP, đầu ngón uốn về tâm
// lòng bàn tay (đầu ngón nằm trong đa giác lòng bàn tay, tỉ lệ khoảng 0,6, góc PIP nhỏ) và mọi tay có world landmarks
// suy từ offset 2D (z = 0, theo spread) nên bộ phân loại thật (fingerPose.ts) chạy trên tay giả trong e2e; chuỗi cổ
// tay → CMC → MCP → IP của ngón cái đặt để ngón cái giả ở (x, y + spread / 2) là duỗi theo quy tắc dang ngón.
import { FINGER_TIPS, HAND_LANDMARKS, PALM_INDEX } from '../core/handLandmarks'
import { bboxOfPoints } from '../core/rect'
import type { FingerTip, HandFrame, HandTrack, Handedness, Point, Point3 } from '../core/types'
import { classifyFingers } from '../hands/fingerPose'

export type FakeHandSpec = {
  /** tâm bàn tay, px camera */
  x: number
  y: number
  /** khoảng cách đầu ngón cái tới đầu ngón trỏ, px camera; mặc định 120 */
  spread?: number
  score?: number
  /** ROI-04: ngón đang giơ (mặc định cả năm); ngón khác uốn gập vào lòng bàn tay. */
  raised?: readonly FingerTip[]
}

export type FakeHandsSpec = {
  left?: FakeHandSpec | null
  right?: FakeHandSpec | null
  uncertain?: boolean
  /** lastSeenTs = now − ageMs (mặc định 0: điểm luôn tươi) */
  ageMs?: number
  /** biên độ rung mỗi landmark, px camera (mặc định 0) */
  jitter?: number
  /** PERF-01 (soak): cả hai tay chạy trên vòng tròn bán kính radius px quanh vị trí gốc, chu kỳ periodMs theo now. */
  orbit?: { radius: number; periodMs: number }
}

/** Offset 21 landmark theo đơn vị spread: (dx, dy) tính từ tâm bàn tay. */
const OFFSETS: readonly (readonly [number, number])[] = [
  [0.3, 1],
  [0.25, 0.8],
  [0.2, 0.62],
  [0.12, 0.5],
  [0, 0.5],
  [-0.1, 0.1],
  [-0.1, -0.1],
  [-0.05, -0.3],
  [0, -0.5],
  [0.05, 0.05],
  [0.1, -0.15],
  [0.15, -0.35],
  [0.2, -0.55],
  [0.15, 0.1],
  [0.2, -0.1],
  [0.25, -0.3],
  [0.3, -0.45],
  [0.25, 0.2],
  [0.3, 0.05],
  [0.35, -0.1],
  [0.4, -0.25],
]

export const FAKE_HAND_IDS: Record<Handedness, number> = { left: 1, right: 2 }

/** Tâm lòng bàn tay theo offset (trung bình của PALM_INDEX). */
function palmCenterOffset(offsets: readonly (readonly [number, number])[]): [number, number] {
  let x = 0
  let y = 0
  for (const i of PALM_INDEX) {
    x += offsets[i][0]
    y += offsets[i][1]
  }
  return [x / PALM_INDEX.length, y / PALM_INDEX.length]
}

/**
 * Offset 21 điểm với các ngón không có trong `raised` uốn gập: PIP đi 35 % đường MCP → đầu ngón, DIP lùi nửa đường về
 * tâm lòng bàn tay, đầu ngón đúng tâm lòng bàn tay (trong đa giác lòng bàn tay). Ngón giơ giữ nguyên offset ROI-03.
 */
export function fakeOffsets(raised: readonly FingerTip[]): (readonly [number, number])[] {
  const out = OFFSETS.map((o) => [o[0], o[1]] as [number, number])
  const center = palmCenterOffset(OFFSETS)
  for (const tip of FINGER_TIPS as readonly FingerTip[]) {
    if (raised.includes(tip)) continue
    const m = OFFSETS[tip - 3]
    const t = OFFSETS[tip]
    const pip: [number, number] = [m[0] + 0.35 * (t[0] - m[0]), m[1] + 0.35 * (t[1] - m[1])]
    const dip: [number, number] = [
      pip[0] + 0.5 * (center[0] - pip[0]),
      pip[1] + 0.5 * (center[1] - pip[1]),
    ]
    out[tip - 2] = pip
    out[tip - 1] = dip
    out[tip] = center
  }
  return out
}

/** Giả ngẫu nhiên trong [−1, 1], lặp lại được theo (frameId, tay, landmark, trục). */
function noise(frameId: number, hand: number, i: number, axis: number): number {
  let h = (frameId * 73856093) ^ (hand * 19349663) ^ (i * 83492791) ^ (axis * 2654435761)
  h = Math.imul(h ^ (h >>> 15), 2246822519)
  h = Math.imul(h ^ (h >>> 13), 3266489917)
  h ^= h >>> 16
  return ((h >>> 0) % 20001) / 10000 - 1
}

function fakeTrack(
  handedness: Handedness,
  spec: FakeHandSpec,
  frameId: number,
  lastSeenTs: number,
  jitter: number,
): HandTrack {
  const spread = spec.spread ?? 120
  const hand = handedness === 'left' ? 0 : 1
  const offsets = spec.raised ? fakeOffsets(spec.raised) : OFFSETS
  const landmarksCam: Point[] = Array.from({ length: HAND_LANDMARKS }, (_, i) => {
    const [dx, dy] = offsets[i]
    return {
      x: spec.x + dx * spread + jitter * noise(frameId, hand, i, 0),
      y: spec.y + dy * spread + jitter * noise(frameId, hand, i, 1),
    }
  })
  // World landmarks giả: cùng hình dạng theo mét (spread px ≈ spread mm), z = 0, không rung.
  const landmarksWorld: Point3[] = offsets.map(([dx, dy]) => ({
    x: (dx * spread) / 1000,
    y: (dy * spread) / 1000,
    z: 0,
  }))
  const palm = PALM_INDEX.map((i) => landmarksCam[i])
  const palmCenterCam = {
    x: palm.reduce((a, p) => a + p.x, 0) / palm.length,
    y: palm.reduce((a, p) => a + p.y, 0) / palm.length,
  }
  return {
    id: FAKE_HAND_IDS[handedness],
    handedness,
    score: spec.score ?? 0.99,
    palmCenterCam,
    bboxCam: bboxOfPoints(landmarksCam) ?? { x: spec.x, y: spec.y, w: 0, h: 0 },
    landmarksCam,
    landmarksWorld,
    // Tay giả không đi qua tracker nên phân loại tại đây, không debounce (mỗi frame độc lập).
    pose: classifyFingers(landmarksCam, landmarksWorld, null),
    lastSeenTs,
    frameId,
  }
}

export function fakeHandFrame(spec: FakeHandsSpec, now: number, frameId: number): HandFrame {
  const ts = now - (spec.ageMs ?? 0)
  const jitter = spec.jitter ?? 0
  const o = spec.orbit
  const phase = o && o.periodMs > 0 ? (2 * Math.PI * now) / o.periodMs : 0
  const ox = o ? o.radius * Math.cos(phase) : 0
  const oy = o ? o.radius * Math.sin(phase) : 0
  const moved = (h: FakeHandSpec): FakeHandSpec => (o ? { ...h, x: h.x + ox, y: h.y + oy } : h)
  const hands: HandTrack[] = []
  if (spec.left) hands.push(fakeTrack('left', moved(spec.left), frameId, ts, jitter))
  if (spec.right) hands.push(fakeTrack('right', moved(spec.right), frameId, ts, jitter))
  return { frameId, ts, hands, uncertain: spec.uncertain ?? false }
}
