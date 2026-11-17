// CLS-02 bước 2: quy tắc unknown, thuần. Không dùng chuyển động (mục 5.11): chỉ xác suất của ảnh tĩnh, cỡ ROI và mức
// nhìn thấy của mặt. unknown khi: chưa có kết quả; cạnh ngắn ROI < minRoiPx; mặt partial mà phần landmark còn trong vùng
// mở dưới partialMinVisible; xác suất của nhãn thắng dưới ngưỡng của chính nhãn đó; chưa đủ số kết quả mà nhãn đó cần.
// CLS-05 (D-069): ngưỡng và số kết quả tối thiểu theo từng nhãn (bất đối xứng: "Hình nộm" cần chắc hơn và nhiều bằng
// chứng hơn "Người", vì gọi nhầm người thật là hình nộm nặng hơn); `probs` là trung bình đã làm mượt (subjectSmoother).
import { DEFAULTS, isDemoClassifier } from '../core/config'
import { DEFAULT_LANG, t, type Lang } from '../core/i18n'
import type { SubjectType } from '../core/types'

type Label = Exclude<SubjectType, 'unknown'>

export type SubjectDecision = {
  subjectType: SubjectType
  /** max(prob) của xác suất đã dùng để quyết định (0 khi chưa có kết quả). */
  confidence: number
  /** Lý do unknown; null khi có nhãn. */
  reason: 'no-result' | 'low-confidence' | 'few-results' | 'roi-small' | 'partial' | null
}

export type SubjectInput = {
  /** [person, mannequin]; null khi chưa có kết quả phân loại cho epoch (và mục tiêu) này. */
  probs: readonly number[] | null
  /** CLS-05: số kết quả đã gộp vào `probs`; thiếu thì coi là 1. */
  count?: number
  /** Cạnh ngắn của ROI camera lúc suy luận (px). */
  roiShortPx: number
  faceStatus?: 'full' | 'partial'
  /** Tỉ lệ landmark còn trong vùng mở (0..1); thiếu thì coi là 1. */
  visible?: number
}

export type SubjectRuleOptions = {
  thresholds?: Partial<Record<Label, number>>
  minResults?: Partial<Record<Label, number>>
  minRoiPx?: number
  partialMinVisible?: number
  labels?: readonly Label[]
}

export function decideSubject(input: SubjectInput, opts: SubjectRuleOptions = {}): SubjectDecision {
  const c = DEFAULTS.classifier
  const minRoi = opts.minRoiPx ?? c.minRoiPx
  const minVisible = opts.partialMinVisible ?? c.partialMinVisible
  const labels = opts.labels ?? c.labels
  const probs = input.probs
  if (!probs || probs.length === 0)
    return { subjectType: 'unknown', confidence: 0, reason: 'no-result' }
  let best = 0
  for (let i = 1; i < probs.length; i++) if (probs[i] > probs[best]) best = i
  const confidence = probs[best]
  if (input.roiShortPx < minRoi) return { subjectType: 'unknown', confidence, reason: 'roi-small' }
  if (input.faceStatus === 'partial' && (input.visible ?? 1) < minVisible)
    return { subjectType: 'unknown', confidence, reason: 'partial' }
  const label = labels[best]
  if (!label) return { subjectType: 'unknown', confidence, reason: 'no-result' }
  const threshold = opts.thresholds?.[label] ?? c.thresholds[label]
  if (confidence < threshold)
    return { subjectType: 'unknown', confidence, reason: 'low-confidence' }
  const need = opts.minResults?.[label] ?? c.minResults[label]
  if ((input.count ?? 1) < need)
    return { subjectType: 'unknown', confidence, reason: 'few-results' }
  return { subjectType: label, confidence, reason: null }
}

/**
 * Chữ hiển thị (UC-07): "Người", "Hình nộm", "Khuôn mặt chưa phân loại" kèm độ tin cậy. Khi model là stub theo màu
 * (isDemoClassifier) nhãn có hậu tố " · demo" để người xem trang public không hiểu nhầm là phân loại thật. I18N-01: chữ
 * theo `lang` (mặc định tiếng Việt; compositor truyền ngôn ngữ đang chọn). CLS-06 (D-071): người do tín hiệu sống
 * (`live`) hiện "Người · chớp mắt", không kèm phần trăm vì nhãn không đến từ xác suất của classifier.
 */
export function subjectText(
  d: { subjectType: SubjectType; confidence?: number; live?: boolean },
  demo: boolean = isDemoClassifier(),
  lang: Lang = DEFAULT_LANG,
): string {
  const s = t(lang).subject
  const pct =
    d.confidence !== undefined && d.confidence > 0 ? ` ${Math.round(d.confidence * 100)} %` : ''
  const tag = demo ? s.demo : ''
  if (d.live && d.subjectType === 'person') return `${s.person}${s.live}${tag}`
  switch (d.subjectType) {
    case 'person':
      return `${s.person}${pct}${tag}`
    case 'mannequin':
      return `${s.mannequin}${pct}${tag}`
    default:
      return `${s.unknown}${tag}`
  }
}
