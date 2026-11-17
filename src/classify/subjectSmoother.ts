// CLS-05 (D-069): làm mượt xác suất phân loại, thuần. Giữ các kết quả gần nhất của cùng một mục tiêu (cùng mặt, cùng
// epoch: vòng lặp reset khi đóng vùng hay đổi epoch) và trả trung bình xác suất của các kết quả trong windowMs tính lùi
// từ kết quả mới nhất, tối đa maxResults. Mục tiêu đổi (tâm crop mới nằm ngoài crop cũ, hay cỡ đổi hơn hai lần) thì bắt
// đầu lại, để nhãn của mặt này không lẫn xác suất của mặt khác. Chỉ gộp kết quả của ảnh tĩnh, không có đầu vào chuyển
// động (mục 5.11). Chỉ import core/ (I1).
import { DEFAULTS } from '../core/config'
import { rectsSameTarget } from '../core/rect'
import type { Rect } from '../core/types'

export type SmoothedProbs = {
  /** trung bình theo nhãn của các kết quả đã gộp */
  probs: number[]
  /** số kết quả đã gộp (≥ 1) */
  count: number
}

export type SubjectSmoother = {
  /** Thêm một kết quả; mục tiêu khác mục tiêu trước thì xóa các kết quả cũ trước khi thêm. */
  push(probs: readonly number[], at: number, roiCam: Rect): void
  reset(): void
  /** Trung bình hiện tại; null khi chưa có kết quả. */
  current(): SmoothedProbs | null
  readonly size: number
}

export type SubjectSmootherOptions = { windowMs?: number; maxResults?: number }

/** Hai crop là cùng một mục tiêu (core/rect.ts): tâm mỗi crop nằm trong crop kia, cạnh ngắn không đổi quá hai lần. */
export const sameTarget = rectsSameTarget

export function createSubjectSmoother(opts: SubjectSmootherOptions = {}): SubjectSmoother {
  const windowMs = opts.windowMs ?? DEFAULTS.classifier.smoothing.windowMs
  const maxResults = Math.max(
    1,
    Math.floor(opts.maxResults ?? DEFAULTS.classifier.smoothing.maxResults),
  )
  let entries: { probs: number[]; at: number; roiCam: Rect }[] = []
  return {
    push(probs, at, roiCam) {
      const last = entries[entries.length - 1]
      if (last && (!sameTarget(last.roiCam, roiCam) || at < last.at)) entries = []
      entries.push({ probs: [...probs], at, roiCam: { ...roiCam } })
      const keep = entries.filter((e) => at - e.at <= windowMs)
      entries = keep.slice(Math.max(0, keep.length - maxResults))
    },
    reset() {
      entries = []
    },
    current() {
      if (entries.length === 0) return null
      const n = entries[0].probs.length
      const sum = new Array<number>(n).fill(0)
      for (const e of entries) for (let i = 0; i < n; i++) sum[i] += e.probs[i] ?? 0
      return { probs: sum.map((v) => v / entries.length), count: entries.length }
    },
    get size() {
      return entries.length
    },
  }
}
