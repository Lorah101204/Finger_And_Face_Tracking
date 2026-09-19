// ROI-03 (D-047, thay HAND-02 slots.ts): mọi đầu ngón đã chọn (mặc định cả năm) của mọi bàn tay đang được theo dõi
// là điểm ứng viên của vùng mở; không còn "slot" gắn cứng tay và ngón. Mỗi lần render: với từng track trong HandFrame
// mới nhất và từng ngón trong cấu hình, lấy landmark tip (px camera) → cameraToStage; điểm hợp lệ khi HandFrame không
// uncertain, điểm trong bảng, tuổi (now − lần thấy cuối của track) ≤ tuổi điểm và score đủ. Điểm không hợp lệ chỉ bị
// loại khỏi bao lồi; vùng đóng khi không còn đủ minPoints điểm hợp lệ của đủ minHands tay (mục 5.8). Thuần, unit test
// trong Node; HandWindowSource và vòng lặp dùng chung.
import { DEFAULTS } from '../core/config'
import { cameraToStage, pointInBoard, type Layout } from '../core/coords'
import type {
  CloseReason,
  FingerReason,
  FingerStatus,
  FingerTip,
  FrameOutput,
  HandFrame,
  Handedness,
} from '../core/types'

export type FingertipOptions = {
  /** mặc định freshness.pointMaxAgeMs */
  maxAgeMs?: number
  /** mặc định hands.minTrackScore */
  minScore?: number
}

export type HullRequirement = {
  /** mặc định reveal.minPoints */
  minPoints?: number
  /** mặc định hands.minHands */
  minHands?: number
}

export const FINGER_NAMES: Record<FingerTip, string> = {
  4: 'cái',
  8: 'trỏ',
  12: 'giữa',
  16: 'áp út',
  20: 'út',
}
export const TIP_CHOICES: readonly FingerTip[] = [4, 8, 12, 16, 20]
export const HAND_NAMES: Record<Handedness, string> = { left: 'Trái', right: 'Phải' }

/** Nhãn ngắn "Trái-cái", "Phải-trỏ" cho thanh debug và thông điệp. */
export function fingerLabel(hand: Handedness, tip: FingerTip): string {
  return `${HAND_NAMES[hand]}-${FINGER_NAMES[tip]}`
}

export function evaluateFingertips(
  frame: HandFrame | null,
  fingers: readonly FingerTip[],
  layout: Layout,
  mirror: boolean,
  now: number,
  opts: FingertipOptions = {},
): FingerStatus[] {
  if (!frame) return []
  const maxAge = opts.maxAgeMs ?? DEFAULTS.freshness.pointMaxAgeMs
  const minScore = opts.minScore ?? DEFAULTS.hands.minTrackScore
  const out: FingerStatus[] = []
  for (const track of frame.hands) {
    for (const tip of fingers) {
      const lm = track.landmarksCam[tip]
      if (!lm) continue
      const pCam = { x: lm.x, y: lm.y }
      const pStage = cameraToStage(pCam, layout, mirror)
      const ageMs = now - track.lastSeenTs
      const base: FingerStatus = {
        hand: track.handedness,
        trackId: track.id,
        tip,
        valid: false,
        pStage,
        pCam,
        ts: track.lastSeenTs,
        ageMs,
        score: track.score,
      }
      if (frame.uncertain) out.push({ ...base, reason: 'ambiguous-hands' })
      else if (!pointInBoard(pStage, layout)) out.push({ ...base, reason: 'out-of-board' })
      else if (ageMs > maxAge) out.push({ ...base, reason: 'stale-point' })
      else if (track.score < minScore) out.push({ ...base, reason: 'low-score' })
      else out.push({ ...base, valid: true })
    }
  }
  return out
}

/** Số tay (trái, phải) có ít nhất một điểm hợp lệ. */
export function validHands(statuses: readonly FingerStatus[]): number {
  const hands = new Set<Handedness>()
  for (const s of statuses) if (s.valid) hands.add(s.hand)
  return hands.size
}

export function validPoints(statuses: readonly FingerStatus[]): FingerStatus[] {
  return statuses.filter((s) => s.valid)
}

const REASON_ORDER: readonly FingerReason[] = ['out-of-board', 'stale-point', 'low-score']

/**
 * Lý do đóng theo ưu tiên của mục 5.8; null khi đủ minPoints điểm hợp lệ của đủ minHands tay. Chưa đủ: lý do trội
 * trong các điểm không hợp lệ (ngoài bảng > cũ > chưa rõ tay, chưa rõ tay tính như thiếu); mọi điểm đều hợp lệ mà vẫn
 * thiếu (thiếu tay, chọn ít ngón) hay không thấy tay nào → few-points.
 */
export function fingertipsCloseReason(
  statuses: readonly FingerStatus[],
  req: HullRequirement = {},
): CloseReason | null {
  const minPoints = req.minPoints ?? DEFAULTS.reveal.minPoints
  const minHands = req.minHands ?? DEFAULTS.hands.minHands
  if (statuses.length === 0) return 'few-points'
  if (statuses.some((s) => s.reason === 'ambiguous-hands')) return 'ambiguous-hands'
  if (validPoints(statuses).length >= minPoints && validHands(statuses) >= minHands) return null
  let best: FingerReason | null = null
  let bestN = 0
  for (const r of REASON_ORDER) {
    const n = statuses.filter((s) => s.reason === r).length
    if (n > bestN) {
      best = r
      bestN = n
    }
  }
  if (best === null || best === 'low-score') return 'few-points'
  return best
}

export function toPoints(statuses: readonly FingerStatus[]): FrameOutput['points'] {
  return statuses.map((s) => ({
    hand: s.hand,
    tip: s.tip,
    trackId: s.trackId,
    valid: s.valid,
    ...(s.reason ? { reason: s.reason } : {}),
    pStage: { x: s.pStage.x, y: s.pStage.y },
  }))
}

/** Hướng dẫn khi chưa đủ điểm: số đầu ngón hợp lệ, tay còn thiếu, điểm ngoài bảng, cũ, chưa rõ tay; null khi đủ. */
export function fingertipsGuidance(
  statuses: readonly FingerStatus[],
  req: HullRequirement = {},
): string | null {
  const reason = fingertipsCloseReason(statuses, req)
  if (reason === null) return null
  const minPoints = req.minPoints ?? DEFAULTS.reveal.minPoints
  const minHands = req.minHands ?? DEFAULTS.hands.minHands
  if (statuses.length === 0) {
    return `Đưa ${minHands >= 2 ? 'hai bàn tay' : 'bàn tay'} vào khung hình: cửa sổ mở theo các đầu ngón (cần ít nhất ${minPoints} đầu ngón).`
  }
  const valid = validPoints(statuses)
  const seen = new Set(statuses.map((s) => s.hand))
  const parts: string[] = []
  if (reason === 'ambiguous-hands') parts.push('hai tay chéo nhau, chưa phân biệt được')
  if (minHands >= 2) {
    for (const h of ['left', 'right'] as const)
      if (!seen.has(h)) parts.push(`chưa thấy tay ${HAND_NAMES[h].toLowerCase()}`)
  }
  const count = (r: FingerReason) => statuses.filter((s) => s.reason === r).length
  const out = count('out-of-board')
  if (out) parts.push(`${out} đầu ngón ngoài bảng`)
  const stale = count('stale-point')
  if (stale) parts.push(`${stale} đầu ngón cũ`)
  const low = count('low-score')
  if (low) parts.push(`${low} đầu ngón chưa rõ tay`)
  if (parts.length === 0) parts.push('giơ thêm ngón')
  return `Đang thấy ${valid.length} đầu ngón hợp lệ, cần ít nhất ${minPoints} của ${minHands} tay: ${parts.join('; ')}.`
}

/** Dòng cho thanh debug: "trái 5/5 ok · phải 3/5 (2 stale-point)". */
export function describeFingertips(statuses: readonly FingerStatus[]): string {
  if (statuses.length === 0) return ''
  const hands: Handedness[] = []
  for (const s of statuses) if (!hands.includes(s.hand)) hands.push(s.hand)
  return hands
    .map((h) => {
      const mine = statuses.filter((s) => s.hand === h)
      const ok = mine.filter((s) => s.valid).length
      const reasons = new Map<FingerReason, number>()
      for (const s of mine) if (s.reason) reasons.set(s.reason, (reasons.get(s.reason) ?? 0) + 1)
      const bad = [...reasons.entries()].map(([r, n]) => `${n} ${r}`).join(', ')
      return `${HAND_NAMES[h].toLowerCase()} ${ok}/${mine.length}${bad ? ` (${bad})` : ' ok'}`
    })
    .join(' · ')
}
