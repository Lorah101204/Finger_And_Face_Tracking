// ROI-01 bước 3, sửa ở ROI-03 (D-047): WindowSource theo tay. Mỗi current(now): đánh giá mọi đầu ngón đã chọn của
// mọi tay trong HandFrame mới nhất (hands/fingertips.ts, tuổi điểm theo sensitivity.pointMaxAgeMs); chưa đủ minPoints
// điểm hợp lệ của minHands tay thì trả lý do theo mục 5.8 kèm fingers; đủ thì giải bao lồi (hullSolver: lọc One Euro
// theo khóa điểm, too-small) đúng một lần cho mỗi HandFrame mới với mốc thời gian là ts của frame (One Euro lọc theo
// nhịp kết quả tay, không theo nhịp render); các frame render giữa hai kết quả trả lại đa giác vừa giải; buildMask
// rasterize thành tập ô với hysteresis theo ô. Trạng thái solver reset khi closed → open (mục 4.6), khi layout, mirror
// hay cấu hình ngón đổi (giá trị px stage không còn so sánh được) và khi reset(). Không đụng DOM: unit test trong Node.
import { DEFAULTS } from '../core/config'
import type { Layout } from '../core/coords'
import type { CloseReason, FingerTip, HandFrame, Point } from '../core/types'
import { evaluateFingertips, fingertipsCloseReason, validPoints } from '../hands/fingertips'
import { defaultSensitivity, type Sensitivity } from './sensitivity'
import { INITIAL_HULL_STATE, solveHull, type HullMeasure, type HullSolverState } from './hullSolver'
import { noWindow, type WindowSample, type WindowSource } from './windowSource'

export type HandWindowContext = {
  layout: Layout
  mirror: boolean
  /** Đầu ngón dùng cho mọi tay (chỉ số landmark). */
  fingers: readonly FingerTip[]
  /** Số tay tối thiểu (mặc định hands.minHands). */
  minHands?: number
  sensitivity?: Sensitivity
  /** ROI-04: chỉ ngón đang giơ (mặc định hands.raisedOnly). */
  raisedOnly?: boolean
}

export type HandWindowOptions = {
  /** Layout, mirror, cấu hình ngón và độ nhạy hiện tại (đọc mỗi frame; đổi identity của layout hay fingers thì reset). */
  getContext: () => HandWindowContext
  /** HandFrame mới nhất của hand pipeline. */
  latest: () => HandFrame | null
}

export type HandWindowSnapshot = {
  /** số lần giải (mỗi HandFrame mới khi đủ điểm) */
  solves: number
  /** số lần bỏ trạng thái solver đang có (closed → open sau khi đã mở, đổi cấu hình, reset()) */
  resets: number
  lastFrameId: number
  /** đa giác đã giải (bao lồi, px stage); null khi đóng */
  polygon: Point[] | null
  reason: CloseReason | null
  measure: HullMeasure | null
}

export class HandWindowSource implements WindowSource {
  readonly kind = 'hands' as const
  #getContext: () => HandWindowContext
  #latest: () => HandFrame | null
  #state: HullSolverState = INITIAL_HULL_STATE
  #lastFrameId = -1
  /** kết quả giải gần nhất (không kèm fingers); null khi chưa giải kể từ lần reset */
  #solved: WindowSample | null = null
  #open = false
  #lastLayout: Layout | null = null
  #lastMirror: boolean | null = null
  #lastFingers: readonly FingerTip[] | null = null
  #lastRaisedOnly: boolean | null = null
  #measure: HullMeasure | null = null
  #lastReason: CloseReason | null = null
  #solves = 0
  #resets = 0

  constructor(opts: HandWindowOptions) {
    this.#getContext = opts.getContext
    this.#latest = opts.latest
  }

  current(now: number): WindowSample {
    const ctx = this.#getContext()
    const { layout, mirror, fingers: configs } = ctx
    const sens = ctx.sensitivity ?? defaultSensitivity()
    const minHands = ctx.minHands ?? DEFAULTS.hands.minHands
    const raisedOnly = ctx.raisedOnly ?? DEFAULTS.hands.raisedOnly
    const changed =
      this.#lastLayout !== null &&
      (layout !== this.#lastLayout ||
        mirror !== this.#lastMirror ||
        configs !== this.#lastFingers ||
        raisedOnly !== this.#lastRaisedOnly)
    this.#lastLayout = layout
    this.#lastMirror = mirror
    this.#lastFingers = configs
    this.#lastRaisedOnly = raisedOnly
    if (changed) this.#reset()
    const frame = this.#latest()
    const fingers = evaluateFingertips(frame, configs, layout, mirror, now, {
      maxAgeMs: sens.pointMaxAgeMs,
      raisedOnly,
    })
    const reason = fingertipsCloseReason(fingers, { minHands })
    if (!frame || reason !== null) {
      this.#open = false
      this.#lastReason = reason ?? 'few-points'
      return { ...noWindow(this.#lastReason), fingers }
    }
    if (frame.frameId !== this.#lastFrameId || !this.#solved) {
      // closed → open: bộ lọc và mốc hysteresis bắt đầu lại từ frame này (không kéo từ vị trí cũ).
      if (!this.#open) this.#reset()
      const r = solveHull(
        validPoints(fingers).map((s) => ({ id: `${s.trackId}:${s.tip}`, p: s.pStage })),
        layout,
        this.#state,
        frame.ts,
        {
          nMin: sens.nMin,
          hysteresisCells: sens.hysteresisCells,
          oneEuro: {
            minCutoff: sens.minCutoff,
            beta: sens.beta,
            dCutoff: DEFAULTS.reveal.oneEuro.dCutoff,
          },
        },
      )
      this.#state = r.state
      this.#lastFrameId = frame.frameId
      this.#measure = r.measure
      this.#solves++
      this.#solved = r.polygon
        ? { shape: { kind: 'polygon', polygonStage: r.polygon }, limited: false }
        : noWindow(r.reason)
      this.#open = r.polygon !== null
      this.#lastReason = r.polygon ? null : r.reason
    }
    return { ...this.#solved, fingers }
  }

  /** Bỏ trạng thái solver và cửa sổ đã giải (đổi camera, rời nguồn tay). */
  reset(): void {
    this.#reset()
    this.#open = false
  }

  dispose(): void {
    this.reset()
  }

  snapshot(): HandWindowSnapshot {
    return {
      solves: this.#solves,
      resets: this.#resets,
      lastFrameId: this.#lastFrameId,
      polygon:
        this.#solved?.shape?.kind === 'polygon'
          ? this.#solved.shape.polygonStage.map((p) => ({ x: p.x, y: p.y }))
          : null,
      reason: this.#lastReason,
      measure: this.#measure,
    }
  }

  #reset(): void {
    // Chỉ đếm khi có trạng thái để bỏ (lần mở đầu tiên không tính).
    if (this.#state !== INITIAL_HULL_STATE) this.#resets++
    this.#state = INITIAL_HULL_STATE
    this.#lastFrameId = -1
    this.#solved = null
    this.#measure = null
  }
}

/** Dòng cho thanh debug. */
export function describeHandWindow(s: HandWindowSnapshot, active: boolean): string {
  if (!active) return 'solver: tắt'
  const m = s.measure
  const geo = m
    ? ` · ${m.points} điểm · cạnh ngắn ${m.shortCells.toFixed(2)} ô · diện tích ${m.areaCells.toFixed(1)} ô²`
    : ''
  const win = s.polygon
    ? `mở đa giác ${s.polygon.length} đỉnh ${s.polygon.map((p) => `(${Math.round(p.x)}, ${Math.round(p.y)})`).join(' ')}`
    : `đóng: ${s.reason ?? '?'}`
  return `solver: ${win} · giải ${s.solves} · reset ${s.resets}${geo}`
}
