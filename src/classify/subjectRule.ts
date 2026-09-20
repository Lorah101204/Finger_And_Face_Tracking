// CLS-02 bước 2: quy tắc unknown, thuần. Không dùng chuyển động (mục 5.11): chỉ xác suất của một ảnh, cỡ ROI và mức
// nhìn thấy của mặt. unknown khi: chưa có kết quả; max(prob) < unknownThreshold; cạnh ngắn ROI < minRoiPx; mặt partial
// mà phần landmark còn trong vùng mở dưới partialMinVisible.
import { DEFAULTS, isDemoClassifier } from '../core/config'
import { DEFAULT_LANG, t, type Lang } from '../core/i18n'
import type { SubjectType } from '../core/types'

export type SubjectDecision = {
  subjectType: SubjectType
  /** max(prob) của kết quả (0 khi chưa có kết quả). */
  confidence: number
  /** Lý do unknown; null khi có nhãn. */
  reason: 'no-result' | 'low-confidence' | 'roi-small' | 'partial' | null
}

export type SubjectInput = {
  /** [person, mannequin]; null khi chưa có kết quả phân loại cho epoch này. */
  probs: readonly number[] | null
  /** Cạnh ngắn của ROI camera lúc suy luận (px). */
  roiShortPx: number
  faceStatus?: 'full' | 'partial'
  /** Tỉ lệ landmark còn trong vùng mở (0..1); thiếu thì coi là 1. */
  visible?: number
}

export type SubjectRuleOptions = {
  unknownThreshold?: number
  minRoiPx?: number
  partialMinVisible?: number
  labels?: readonly SubjectType[]
}

export function decideSubject(input: SubjectInput, opts: SubjectRuleOptions = {}): SubjectDecision {
  const th = opts.unknownThreshold ?? DEFAULTS.classifier.unknownThreshold
  const minRoi = opts.minRoiPx ?? DEFAULTS.classifier.minRoiPx
  const minVisible = opts.partialMinVisible ?? DEFAULTS.classifier.partialMinVisible
  const labels = opts.labels ?? DEFAULTS.classifier.labels
  const probs = input.probs
  if (!probs || probs.length === 0)
    return { subjectType: 'unknown', confidence: 0, reason: 'no-result' }
  let best = 0
  for (let i = 1; i < probs.length; i++) if (probs[i] > probs[best]) best = i
  const confidence = probs[best]
  if (input.roiShortPx < minRoi) return { subjectType: 'unknown', confidence, reason: 'roi-small' }
  if (input.faceStatus === 'partial' && (input.visible ?? 1) < minVisible)
    return { subjectType: 'unknown', confidence, reason: 'partial' }
  if (confidence < th) return { subjectType: 'unknown', confidence, reason: 'low-confidence' }
  const label = labels[best]
  if (!label) return { subjectType: 'unknown', confidence, reason: 'no-result' }
  return { subjectType: label, confidence, reason: null }
}

/**
 * Chữ hiển thị (UC-07): "Người", "Hình nộm", "Khuôn mặt chưa phân loại" kèm độ tin cậy. Khi model là stub theo màu
 * (isDemoClassifier) nhãn có hậu tố " · demo" để người xem trang public không hiểu nhầm là phân loại thật. I18N-01: chữ
 * theo `lang` (mặc định tiếng Việt; compositor truyền ngôn ngữ đang chọn).
 */
export function subjectText(
  d: { subjectType: SubjectType; confidence?: number },
  demo: boolean = isDemoClassifier(),
  lang: Lang = DEFAULT_LANG,
): string {
  const s = t(lang).subject
  const pct =
    d.confidence !== undefined && d.confidence > 0 ? ` ${Math.round(d.confidence * 100)} %` : ''
  const tag = demo ? s.demo : ''
  switch (d.subjectType) {
    case 'person':
      return `${s.person}${pct}${tag}`
    case 'mannequin':
      return `${s.mannequin}${pct}${tag}`
    default:
      return `${s.unknown}${tag}`
  }
}
