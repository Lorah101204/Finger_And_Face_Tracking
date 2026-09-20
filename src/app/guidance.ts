// UX-01 (UC-08): thông điệp hướng dẫn trên màn hình cho người mới dùng: một thông điệp cho từng trạng thái
// FrameOutput.status, từng CloseReason và từng pha camera, sắp theo ba bước (camera → cửa sổ → khuôn mặt). Thuần,
// không đụng DOM: unit test trong Node liệt kê đủ mọi lý do. Dòng debug `statusMessage` (loop/frameLoop.ts) vẫn là
// mô tả kỹ thuật ngắn; ở đây là tiêu đề ngắn cộng một câu nói người dùng phải làm gì tiếp.
// I18N-01: mọi câu lấy từ từ điển `t(lang)`; `buildGuidance(input, lang)` mặc định tiếng Việt.
import type { CameraSnapshot } from '../camera/cameraState'
import { DEFAULTS } from '../core/config'
import type {
  CloseReason,
  FingerStatus,
  FingerTip,
  FrameOutput,
  RevealState,
  SubjectType,
} from '../core/types'
import { subjectText } from '../classify/subjectRule'
import { isDemoClassifier } from '../core/config'
import { DEFAULT_LANG, t, type Lang, type Strings } from '../core/i18n'
import { fingertipsGuidance } from '../hands/fingertips'
import type { WindowSourceKind } from '../reveal/windowSource'

/** Pha camera nhìn từ người dùng (gộp từ CameraSnapshot và lý do đóng của vòng lặp). */
export type CameraPhase =
  | 'off'
  | 'requesting'
  | 'switching'
  | 'active'
  | 'stalled'
  | 'hidden'
  | 'ended'
  | 'error'
  | 'synthetic'

export type WorkerPhase = 'off' | 'loading' | 'ready' | 'error'

export type GuidanceInput = {
  camera: CameraPhase
  /** Câu lỗi hay lý do dừng camera đã định dạng (cameraMessage), dùng khi camera là error hay ended. */
  cameraText?: string
  source: WindowSourceKind
  /** Worker tay khi nguồn là tay; bỏ qua khi tay đang giả lập (debug). */
  hands: WorkerPhase
  /** Số bàn tay đang thấy trong HandFrame mới nhất. */
  handsSeen: number
  face: WorkerPhase
  reveal: RevealState
  status: FrameOutput['status']
  limited: boolean
  /** ROI-03: trạng thái các đầu ngón của frame gần nhất (rỗng với nguồn chuột). */
  fingers: readonly FingerStatus[]
  /** Đầu ngón đã chọn (để nêu tên khi chưa thấy tay). */
  fingerConfig?: readonly FingerTip[]
  /** CLS-02 (UC-07): nhãn của mặt đầu tiên khi có; null khi không có mặt. */
  subject?: { subjectType: SubjectType; confidence?: number } | null
}

export type GuidanceStep = 1 | 2 | 3
export type GuidanceTone = 'info' | 'wait' | 'ok' | 'warn' | 'error'

export type Guidance = {
  step: GuidanceStep
  tone: GuidanceTone
  title: string
  detail: string
  /** Lý do đóng đang được giải thích; null khi vùng mở hoặc thông điệp thuộc bước camera. */
  reason: CloseReason | null
}

export const GUIDE_STEP_IDS: readonly GuidanceStep[] = [1, 2, 3]

/** Ba bước với nhãn theo ngôn ngữ (Guide, trang chào). */
export function guideSteps(lang: Lang = DEFAULT_LANG): { step: GuidanceStep; label: string }[] {
  const s = t(lang)
  return GUIDE_STEP_IDS.map((step) => ({ step, label: s.guide.steps[step] }))
}

/** Gợi ý phím cho nguồn chuột (hiện dưới thông điệp). */
export function mouseKeys(lang: Lang = DEFAULT_LANG): string {
  return t(lang).guide.mouseKeys
}

function g(
  step: GuidanceStep,
  tone: GuidanceTone,
  msg: { title: string; detail?: unknown },
  reason: CloseReason | null = null,
  detail?: string,
): Guidance {
  const d = detail ?? (typeof msg.detail === 'string' ? msg.detail : '')
  return { step, tone, title: msg.title, detail: d, reason }
}

export function buildGuidance(input: GuidanceInput, lang: Lang = DEFAULT_LANG): Guidance {
  const s = t(lang)
  const camera = cameraGuidance(input, s)
  if (camera) return camera
  const { reveal } = input
  if (reveal.kind === 'closed') {
    if (reveal.reason === 'tab-hidden') return g(1, 'warn', s.guide.tabHidden, 'tab-hidden')
    if (reveal.reason === 'no-camera') return g(1, 'wait', s.guide.noCameraWait, 'no-camera')
    return input.source === 'hands'
      ? handsClosed(input, reveal.reason, s, lang)
      : mouseClosed(reveal.reason, s)
  }
  return openGuidance(input, s, lang)
}

function cameraGuidance(input: GuidanceInput, s: Strings): Guidance | null {
  const text = input.cameraText ?? ''
  switch (input.camera) {
    case 'off':
      return g(1, 'info', s.guide.camOff)
    case 'requesting':
      return g(1, 'wait', s.guide.camRequesting)
    case 'switching':
      return g(1, 'wait', s.guide.camSwitching, 'no-camera')
    case 'hidden':
      return g(1, 'warn', s.guide.tabHidden, 'tab-hidden')
    case 'stalled':
      return g(1, 'warn', s.guide.camStalled, 'no-camera')
    case 'ended':
      return g(1, 'error', s.guide.camEnded, 'no-camera', text || s.guide.camEnded.detail)
    case 'error':
      return g(1, 'error', s.guide.camError, 'no-camera', text || s.guide.camError.detail)
    case 'active':
    case 'synthetic':
      return null
  }
}

function fingerNames(input: GuidanceInput, s: Strings): string {
  return (input.fingerConfig ?? DEFAULTS.hands.fingers)
    .map((tip) => s.fingers.names[tip])
    .join(', ')
}

function handsClosed(input: GuidanceInput, reason: CloseReason, s: Strings, lang: Lang): Guidance {
  if (input.hands === 'loading') return g(2, 'wait', s.guide.handsLoading, reason)
  if (input.hands === 'error') return g(2, 'error', s.guide.handsError, reason)
  switch (reason) {
    case 'few-points':
    case 'user':
    case 'no-camera':
    case 'tab-hidden': {
      if (input.handsSeen === 0)
        return g(
          2,
          'info',
          s.guide.handsNone,
          reason,
          s.guide.handsNone.detail(
            fingerNames(input, s),
            DEFAULTS.reveal.minPoints,
            DEFAULTS.hands.minHands,
          ),
        )
      const guide = fingertipsGuidance(input.fingers, {}, lang)
      return g(2, 'info', s.guide.handsMissing, reason, guide ?? s.guide.handsMissing.detail)
    }
    case 'stale-point':
      return g(2, 'warn', s.guide.stalePoint, reason)
    case 'out-of-board':
      return g(2, 'warn', s.guide.outOfBoard, reason)
    case 'too-small':
      return g(
        2,
        'warn',
        s.guide.tooSmallHands,
        reason,
        s.guide.tooSmallHands.detail(DEFAULTS.reveal.nMin),
      )
    case 'ambiguous-hands':
      return g(2, 'warn', s.guide.ambiguous, reason)
    case 'config-changed':
      return g(2, 'info', s.guide.configChangedHands, reason)
  }
}

function mouseClosed(reason: CloseReason, s: Strings): Guidance {
  switch (reason) {
    case 'user':
    case 'few-points':
    case 'stale-point':
    case 'out-of-board':
    case 'ambiguous-hands':
    case 'no-camera':
    case 'tab-hidden':
      return g(2, 'info', s.guide.mouseOpen, reason)
    case 'too-small':
      return g(2, 'warn', s.guide.mouseTooSmall, reason)
    case 'config-changed':
      return g(2, 'info', s.guide.configChangedMouse, reason)
  }
}

function openGuidance(input: GuidanceInput, s: Strings, lang: Lang): Guidance {
  const hands = input.source === 'hands'
  const lim = input.limited ? s.guide.limited : ''
  if (input.face === 'loading')
    return g(3, 'wait', s.guide.faceLoading, null, s.guide.faceLoading.detail + lim)
  if (input.face === 'error') return g(3, 'error', s.guide.faceError)
  switch (input.status) {
    case 'searching':
      return g(3, 'wait', s.guide.searching, null, s.guide.searching.detail + lim)
    case 'too-small':
      return g(
        3,
        'warn',
        s.guide.tooSmallFace,
        null,
        (hands ? s.guide.tooSmallFace.hands : s.guide.tooSmallFace.mouse) + lim,
      )
    case 'face-candidate': {
      const label = input.subject ? subjectText(input.subject, isDemoClassifier(), lang) : null
      // Model phân loại đang là stub theo màu: nói rõ trong hướng dẫn, không chỉ ở hậu tố nhãn.
      const demo = label && isDemoClassifier() ? s.guide.faceCandidate.demo : ''
      return {
        step: 3,
        tone: 'ok',
        title: label ? s.guide.faceCandidate.titleWith(label) : s.guide.faceCandidate.title,
        detail: `${s.guide.faceCandidate.detail}${demo}${lim}`,
        reason: null,
      }
    }
    case 'partial-face':
      return g(
        3,
        'warn',
        s.guide.partialFace,
        null,
        (hands ? s.guide.partialFace.hands : s.guide.partialFace.mouse) + lim,
      )
    case 'covered':
      return g(2, 'wait', s.guide.covered, null, s.guide.covered.detail + lim)
  }
}

/** Pha camera từ CameraSnapshot; `wasActive` phân biệt đổi camera (requesting ngay sau active) với xin quyền lần đầu. */
export function cameraPhase(s: CameraSnapshot, wasActive: boolean): CameraPhase {
  switch (s.state.status) {
    case 'idle':
      return 'off'
    case 'requesting':
      return wasActive ? 'switching' : 'requesting'
    case 'active':
      if (s.hidden) return 'hidden'
      if (s.stalled) return 'stalled'
      return 'active'
    case 'ended':
      return 'ended'
    case 'error':
      return 'error'
  }
}
