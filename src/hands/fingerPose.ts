// ROI-04 (D-055): ngón đang giơ hay đang gập, quyết định thuần hình học từ landmark vì hand landmarker không điền
// `visibility` (0 cho mọi điểm, đo 2026-09-21 bằng tools/probe-fingers.mjs). Bốn ngón: tỉ lệ |cổ tay→đầu ngón| /
// |cổ tay→khớp PIP| trên world landmarks (mét, không phụ thuộc hướng và cỡ tay), góc tại khớp PIP và phép thử đầu ngón
// nằm trong đa giác lòng bàn tay 2D (landmark 0, 1, 5, 9, 13, 17). Ngón cái: góc khớp vô dụng (147° cả khi gập vào
// lòng bàn tay) nên dùng tỉ lệ dang |đầu→MCP út| / |IP→MCP út| và phép thử lòng bàn tay. Hai ngưỡng (Schmitt): trên
// ngưỡng cao là duỗi, dưới ngưỡng thấp là gập, ở giữa giữ trạng thái cũ; đổi trạng thái cần debounceFrames HandFrame
// liên tiếp ở phía kia; track mới lấy kết quả đầu ngay. Thiếu landmark hay lòng bàn tay suy biến: giữ trạng thái cũ,
// lần đầu coi là duỗi (fail-open: giữ đúng hành vi ROI-03). Không có world landmarks (tay giả cũ, kết quả cũ): tỉ lệ
// 2D với cùng ngưỡng, không xét góc. Thuần, unit test trong Node trên fixture tests/unit/fixtures/hands-pose.json.
import { pointInPolygon } from '../core/cells'
import { DEFAULTS } from '../core/config'
import { FINGER_TIPS, WRIST_INDEX } from '../core/handLandmarks'
import type { FingerPose, FingerTip, HandPose, Point, Point3 } from '../core/types'

export type FingerPoseOptions = {
  ratioRaised?: number
  ratioFolded?: number
  angleRaised?: number
  angleFolded?: number
  abductionRaised?: number
  abductionFolded?: number
  /** số HandFrame liên tiếp ở phía kia trước khi đổi trạng thái (1 = đổi ngay) */
  debounceFrames?: number
}

/** Đa giác lòng bàn tay: cổ tay, CMC ngón cái, bốn khớp MCP (theo thứ tự quanh lòng bàn tay). */
export const PALM_POLYGON_INDEX: readonly number[] = [0, 1, 5, 9, 13, 17]
const LITTLE_MCP = 17
export const THUMB_TIP: FingerTip = 4

export type FingerMetrics = {
  ratio: number
  angle: number | null
  abduction: number | null
  inPalm: boolean
}

type XYZ = { x: number; y: number; z?: number }

function dist(a: XYZ, b: XYZ): number {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0))
}

/** Góc tại b (độ) giữa ba điểm a–b–c; null khi một cạnh dài 0. */
function angleAt(a: XYZ, b: XYZ, c: XYZ): number | null {
  const v1 = [a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0)]
  const v2 = [c.x - b.x, c.y - b.y, (c.z ?? 0) - (b.z ?? 0)]
  const n = Math.hypot(v1[0], v1[1], v1[2]) * Math.hypot(v2[0], v2[1], v2[2])
  if (n === 0) return null
  const dot = v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]
  return (Math.acos(Math.max(-1, Math.min(1, dot / n))) * 180) / Math.PI
}

/**
 * Độ đo của một ngón: `ratio` và `abduction` trên world landmarks khi có (đủ 21 điểm), nếu không thì trên px camera;
 * `angle` chỉ khi có world landmarks; `inPalm` luôn theo 2D. null khi thiếu landmark hay mẫu số bằng 0.
 */
export function fingerMetrics(
  landmarksCam: readonly Point[],
  landmarksWorld: readonly Point3[] | undefined,
  tip: FingerTip,
): FingerMetrics | null {
  const pip = tip - 2
  const dip = tip - 1
  const mcp = tip - 3
  const has3d = landmarksWorld !== undefined && landmarksWorld.length >= 21
  const pts: readonly XYZ[] = has3d ? landmarksWorld : landmarksCam
  const w = pts[WRIST_INDEX]
  const t = pts[tip]
  const p = pts[pip]
  const d = pts[dip]
  const m = pts[mcp]
  const little = pts[LITTLE_MCP]
  const tipCam = landmarksCam[tip]
  if (!w || !t || !p || !d || !m || !little || !tipCam) return null
  const palm = PALM_POLYGON_INDEX.map((i) => landmarksCam[i])
  if (palm.some((q) => !q)) return null
  const denom = dist(w, p)
  if (denom === 0) return null
  const ratio = dist(w, t) / denom
  const angle = has3d ? angleAt(m, p, d) : null
  const abdDenom = dist(d, little)
  const abduction = abdDenom === 0 ? null : dist(t, little) / abdDenom
  return { ratio, angle, abduction, inPalm: pointInPolygon(tipCam, palm) }
}

/** Phiếu của một frame: duỗi, gập, hay null khi nằm trong dải giữa hai ngưỡng. */
export function fingerVote(
  tip: FingerTip,
  m: FingerMetrics,
  opts: Required<FingerPoseOptions>,
): boolean | null {
  if (tip === THUMB_TIP) {
    if (m.abduction === null) return null
    if (m.inPalm || m.abduction < opts.abductionFolded) return false
    if (m.abduction >= opts.abductionRaised) return true
    return null
  }
  if (m.inPalm || m.ratio < opts.ratioFolded || (m.angle !== null && m.angle < opts.angleFolded))
    return false
  if (m.ratio >= opts.ratioRaised && (m.angle === null || m.angle >= opts.angleRaised)) return true
  return null
}

export function resolvePoseOptions(opts: FingerPoseOptions = {}): Required<FingerPoseOptions> {
  const d = DEFAULTS.hands.pose
  return {
    ratioRaised: opts.ratioRaised ?? d.ratioRaised,
    ratioFolded: opts.ratioFolded ?? d.ratioFolded,
    angleRaised: opts.angleRaised ?? d.angleRaised,
    angleFolded: opts.angleFolded ?? d.angleFolded,
    abductionRaised: opts.abductionRaised ?? d.abductionRaised,
    abductionFolded: opts.abductionFolded ?? d.abductionFolded,
    debounceFrames: Math.max(1, opts.debounceFrames ?? d.debounceFrames),
  }
}

/**
 * Trạng thái năm ngón của một track cho HandFrame này từ trạng thái frame trước (null với track mới). Không sửa
 * `prev`; trả về đối tượng mới.
 */
export function classifyFingers(
  landmarksCam: readonly Point[],
  landmarksWorld: readonly Point3[] | undefined,
  prev: HandPose | null,
  options: FingerPoseOptions = {},
): HandPose {
  const opts = resolvePoseOptions(options)
  const out = {} as HandPose
  for (const tip of FINGER_TIPS as readonly FingerTip[]) {
    const m = fingerMetrics(landmarksCam, landmarksWorld, tip)
    const before = prev?.[tip] ?? null
    const vote = m ? fingerVote(tip, m, opts) : null
    const metrics = m ?? { ratio: before?.ratio ?? 0, angle: null, abduction: null, inPalm: false }
    let pose: FingerPose
    if (!before) pose = { raised: vote ?? true, streak: 0, ...metrics }
    else if (vote === null || vote === before.raised)
      pose = { raised: before.raised, streak: 0, ...metrics }
    else if (before.streak + 1 >= opts.debounceFrames)
      pose = { raised: vote, streak: 0, ...metrics }
    else pose = { raised: before.raised, streak: before.streak + 1, ...metrics }
    out[tip] = pose
  }
  return out
}

/** Số ngón đang giơ của một track (5 khi chưa có pose: fail-open). */
export function raisedCount(pose: HandPose | undefined): number {
  if (!pose) return FINGER_TIPS.length
  let n = 0
  for (const tip of FINGER_TIPS as readonly FingerTip[]) if (pose[tip].raised) n++
  return n
}
