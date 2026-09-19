// HAND-01 bước 3: ghép detection với track để có id tay ổn định. Mỗi frame: chi phí ghép = khoảng cách tâm lòng bàn
// tay (chia bề rộng camera) + phạt nếu handedness khác; chấp nhận khi chi phí < matchCostMax; nếu một detection (hay
// một track) có hai ứng viên chênh nhau < ambiguityDelta thì cả frame là uncertain: giữ nguyên track cũ, không tạo
// track mới (hai tay chéo nhau cho uncertain thay vì hoán đổi id). Track không thấy quá trackDropMs thì xóa;
// detection không ghép được tạo track với id mới. Nhãn model nhấp nháy một frame không tách track (phạt nhỏ hơn
// ngưỡng); nhãn ngược liên tiếp relabelFrames frame thì track đổi handedness nhưng giữ id. Xóa track cần cả hai: quá
// trackDropMs kể từ lần thấy cuối và vắng trong ít nhất trackDropFrames lần cập nhật liên tiếp (pipeline chậm hơn
// 150 ms mỗi frame không xóa track chỉ vì một lần bỏ lỡ; frame uncertain tính là một lần vắng). Thuần, unit test Node.
import { DEFAULTS } from '../core/config'
import type { HandFrame, HandTrack, Size } from '../core/types'
import type { HandDetection } from './handLandmarker'

export type HandTrackerOptions = {
  matchCostMax?: number
  ambiguityDelta?: number
  dropMs?: number
  dropFrames?: number
  handednessPenalty?: number
  relabelFrames?: number
}

export type HandTrackerStats = {
  frames: number
  uncertainFrames: number
  created: number
  dropped: number
  relabeled: number
  matched: number
}

type Internal = HandTrack & { mismatch: number; missed: number }
type Pair = { t: number; d: number; cost: number }

export class HandTracker {
  #matchCostMax: number
  #ambiguityDelta: number
  #dropMs: number
  #dropFrames: number
  #penalty: number
  #relabelFrames: number
  #tracks: Internal[] = []
  #nextId = 1
  #size: Size | null = null
  #stats: HandTrackerStats = {
    frames: 0,
    uncertainFrames: 0,
    created: 0,
    dropped: 0,
    relabeled: 0,
    matched: 0,
  }

  constructor(opts: HandTrackerOptions = {}) {
    const d = DEFAULTS.hands
    this.#matchCostMax = opts.matchCostMax ?? d.matchCostMax
    this.#ambiguityDelta = opts.ambiguityDelta ?? d.ambiguityDelta
    this.#dropMs = opts.dropMs ?? d.trackDropMs
    this.#dropFrames = opts.dropFrames ?? d.trackDropFrames
    this.#penalty = opts.handednessPenalty ?? d.handednessPenalty
    this.#relabelFrames = opts.relabelFrames ?? d.relabelFrames
  }

  get tracks(): readonly HandTrack[] {
    return this.#tracks.map(strip)
  }
  get stats(): Readonly<HandTrackerStats> {
    return this.#stats
  }

  /** Xóa mọi track (đổi camera, đổi cờ handedness); id tiếp tục tăng, không dùng lại. */
  reset(): void {
    this.#tracks = []
    this.#size = null
  }

  update(
    detections: readonly HandDetection[],
    frameId: number,
    ts: number,
    width: number,
    height: number,
  ): HandFrame {
    this.#stats.frames++
    if (!this.#size || this.#size.w !== width || this.#size.h !== height) {
      if (this.#size) this.#stats.dropped += this.#tracks.length
      this.#tracks = []
      this.#size = { w: width, h: height }
    }
    const norm = width > 0 ? width : 1
    const pairs: Pair[] = []
    this.#tracks.forEach((t, ti) => {
      detections.forEach((d, di) => {
        const dx = t.palmCenterCam.x - d.palmCenterCam.x
        const dy = t.palmCenterCam.y - d.palmCenterCam.y
        const cost = Math.hypot(dx, dy) / norm + (t.handedness === d.handedness ? 0 : this.#penalty)
        if (cost < this.#matchCostMax) pairs.push({ t: ti, d: di, cost })
      })
    })

    if (this.#ambiguous(pairs, this.#tracks.length, detections.length)) {
      this.#stats.uncertainFrames++
      for (const t of this.#tracks) t.missed++
      this.#expire(ts)
      return { frameId, ts, hands: this.tracks as HandTrack[], uncertain: true }
    }

    pairs.sort((a, b) => a.cost - b.cost)
    const usedT = new Set<number>()
    const usedD = new Set<number>()
    for (const p of pairs) {
      if (usedT.has(p.t) || usedD.has(p.d)) continue
      usedT.add(p.t)
      usedD.add(p.d)
      this.#apply(this.#tracks[p.t], detections[p.d], frameId, ts)
      this.#stats.matched++
    }
    this.#tracks.forEach((t, ti) => {
      if (!usedT.has(ti)) t.missed++
    })
    detections.forEach((d, di) => {
      if (usedD.has(di)) return
      const track: Internal = {
        id: this.#nextId++,
        handedness: d.handedness,
        score: d.score,
        palmCenterCam: { ...d.palmCenterCam },
        bboxCam: { ...d.bboxCam },
        landmarksCam: d.landmarksCam.map((p) => ({ ...p })),
        lastSeenTs: ts,
        frameId,
        mismatch: 0,
        missed: 0,
      }
      this.#tracks.push(track)
      this.#stats.created++
    })
    this.#expire(ts)
    this.#tracks.sort((a, b) => a.id - b.id)
    return { frameId, ts, hands: this.tracks as HandTrack[], uncertain: false }
  }

  /** Xóa track quá dropMs kể từ lần thấy cuối và vắng trong ít nhất dropFrames lần cập nhật liên tiếp. */
  #expire(ts: number): void {
    const before = this.#tracks.length
    this.#tracks = this.#tracks.filter(
      (t) => !(ts - t.lastSeenTs > this.#dropMs && t.missed >= this.#dropFrames),
    )
    this.#stats.dropped += before - this.#tracks.length
  }

  /** Một detection (hoặc một track) có hai ứng viên với chi phí chênh nhau < ambiguityDelta. */
  #ambiguous(pairs: Pair[], nTracks: number, nDets: number): boolean {
    const byD: number[][] = Array.from({ length: nDets }, () => [])
    const byT: number[][] = Array.from({ length: nTracks }, () => [])
    for (const p of pairs) {
      byD[p.d].push(p.cost)
      byT[p.t].push(p.cost)
    }
    for (const list of [...byD, ...byT]) {
      if (list.length < 2) continue
      list.sort((a, b) => a - b)
      if (list[1] - list[0] < this.#ambiguityDelta) return true
    }
    return false
  }

  #apply(t: Internal, d: HandDetection, frameId: number, ts: number): void {
    t.missed = 0
    if (d.handedness === t.handedness) {
      t.mismatch = 0
      t.score = d.score
    } else if (++t.mismatch >= this.#relabelFrames) {
      t.handedness = d.handedness
      t.mismatch = 0
      t.score = d.score
      this.#stats.relabeled++
    } else {
      t.score = 1 - d.score
    }
    t.palmCenterCam = { ...d.palmCenterCam }
    t.bboxCam = { ...d.bboxCam }
    t.landmarksCam = d.landmarksCam.map((p) => ({ ...p }))
    t.lastSeenTs = ts
    t.frameId = frameId
  }
}

function strip(t: Internal): HandTrack {
  return {
    id: t.id,
    handedness: t.handedness,
    score: t.score,
    palmCenterCam: { ...t.palmCenterCam },
    bboxCam: { ...t.bboxCam },
    landmarksCam: t.landmarksCam.map((p) => ({ ...p })),
    lastSeenTs: t.lastSeenTs,
    frameId: t.frameId,
  }
}
