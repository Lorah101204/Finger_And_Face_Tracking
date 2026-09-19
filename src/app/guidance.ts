// UX-01 (UC-08): thông điệp hướng dẫn trên màn hình cho người mới dùng: một thông điệp cho từng trạng thái
// FrameOutput.status, từng CloseReason và từng pha camera, sắp theo ba bước (camera → cửa sổ → khuôn mặt). Thuần,
// không đụng DOM: unit test trong Node liệt kê đủ mọi lý do. Dòng debug `statusMessage` (loop/frameLoop.ts) vẫn là
// mô tả kỹ thuật ngắn; ở đây là tiêu đề ngắn cộng một câu nói người dùng phải làm gì tiếp.
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
import { FINGER_NAMES, fingertipsGuidance } from '../hands/fingertips'
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

export const GUIDE_STEPS: readonly { step: GuidanceStep; label: string }[] = [
  { step: 1, label: 'Camera' },
  { step: 2, label: 'Cửa sổ' },
  { step: 3, label: 'Khuôn mặt' },
]

/** Gợi ý phím cho nguồn chuột (hiện dưới thông điệp). */
export const MOUSE_KEYS =
  'Bấm hoặc kéo trên bảng để mở · lăn chuột đổi cỡ · Esc đóng · Space mở lại'

const LIMITED = ' Cửa sổ chạm mép bảng.'

function g(
  step: GuidanceStep,
  tone: GuidanceTone,
  title: string,
  detail: string,
  reason: CloseReason | null = null,
): Guidance {
  return { step, tone, title, detail, reason }
}

const TAB_HIDDEN = g(
  1,
  'warn',
  'Tab đang ẩn',
  'Cửa sổ đã đóng và màn về trắng. Quay lại tab này để mở lại.',
  'tab-hidden',
)

export function buildGuidance(input: GuidanceInput): Guidance {
  const camera = cameraGuidance(input)
  if (camera) return camera
  const { reveal } = input
  if (reveal.kind === 'closed') {
    if (reveal.reason === 'tab-hidden') return TAB_HIDDEN
    if (reveal.reason === 'no-camera')
      return g(
        1,
        'wait',
        'Đang chờ frame đầu từ camera…',
        'Cửa sổ chỉ mở khi camera đã cấp hình.',
        'no-camera',
      )
    return input.source === 'hands'
      ? handsClosed(input, reveal.reason)
      : mouseClosed(input, reveal.reason)
  }
  return openGuidance(input)
}

function cameraGuidance(input: GuidanceInput): Guidance | null {
  const text = input.cameraText ?? ''
  switch (input.camera) {
    case 'off':
      return g(
        1,
        'info',
        'Bật camera để bắt đầu',
        'Chọn camera rồi bấm Bật camera. Màn vẫn trắng cho tới khi bạn mở cửa sổ.',
      )
    case 'requesting':
      return g(
        1,
        'wait',
        'Đang xin quyền camera…',
        'Cho phép camera trong hộp thoại của trình duyệt.',
      )
    case 'switching':
      return g(
        1,
        'wait',
        'Đang đổi camera…',
        'Cửa sổ đã đóng; mở lại sau khi camera mới chạy.',
        'no-camera',
      )
    case 'hidden':
      return TAB_HIDDEN
    case 'stalled':
      return g(
        1,
        'warn',
        'Camera không cấp hình',
        'Cửa sổ đã đóng. Kiểm tra camera có bị ứng dụng khác dùng; đổi camera nếu cần.',
        'no-camera',
      )
    case 'ended':
      return g(1, 'error', 'Camera đã dừng', text || 'Bấm Bật camera để chạy lại.', 'no-camera')
    case 'error':
      return g(
        1,
        'error',
        'Không bật được camera',
        text || 'Kiểm tra quyền camera rồi bấm lại.',
        'no-camera',
      )
    case 'active':
    case 'synthetic':
      return null
  }
}

function fingerNames(input: GuidanceInput): string {
  return (input.fingerConfig ?? DEFAULTS.hands.fingers).map((t) => FINGER_NAMES[t]).join(', ')
}

function handsClosed(input: GuidanceInput, reason: CloseReason): Guidance {
  if (input.hands === 'loading')
    return g(
      2,
      'wait',
      'Đang nạp bộ nhận diện tay…',
      'Chỉ mất vài giây lần đầu. Chuẩn bị hai bàn tay trước camera.',
      reason,
    )
  if (input.hands === 'error')
    return g(
      2,
      'error',
      'Bộ nhận diện tay không chạy được',
      'Tải lại trang; nếu vẫn lỗi, chọn nguồn cửa sổ Chuột trong Cài đặt.',
      reason,
    )
  switch (reason) {
    case 'few-points':
    case 'user':
    case 'no-camera':
    case 'tab-hidden': {
      if (input.handsSeen === 0)
        return g(
          2,
          'info',
          'Đưa hai bàn tay vào trước camera',
          `Giơ hai tay cách nhau một khoảng, lòng bàn tay hướng về camera. Cửa sổ là vùng bao các đầu ngón (${fingerNames(input)}); cần ít nhất ${DEFAULTS.reveal.minPoints} đầu ngón của ${DEFAULTS.hands.minHands} tay.`,
          reason,
        )
      const guide = fingertipsGuidance(input.fingers)
      return g(
        2,
        'info',
        'Còn thiếu đầu ngón',
        guide ?? 'Giơ thêm đầu ngón hoặc đưa tay còn lại vào khung hình để mở cửa sổ.',
        reason,
      )
    }
    case 'stale-point':
      return g(
        2,
        'warn',
        'Mất dấu đầu ngón',
        'Giữ các đầu ngón trong khung hình và di chuyển chậm hơn; điểm cũ bị bỏ khỏi vùng, thiếu điểm thì cửa sổ đóng.',
        reason,
      )
    case 'out-of-board':
      return g(2, 'warn', 'Đầu ngón ra ngoài bảng', 'Đưa các đầu ngón vào trong vùng lưới.', reason)
    case 'too-small':
      return g(
        2,
        'warn',
        'Các đầu ngón quá gần nhau',
        `Xòe ngón hoặc tách hai tay xa nhau hơn để cửa sổ đủ cỡ (tối thiểu ${DEFAULTS.reveal.nMin} ô mỗi cạnh).`,
        reason,
      )
    case 'ambiguous-hands':
      return g(
        2,
        'warn',
        'Hai tay chéo nhau',
        'Đặt tay trái bên trái, tay phải bên phải và không để hai tay chồng lên nhau.',
        reason,
      )
    case 'config-changed':
      return g(
        2,
        'info',
        'Cài đặt vừa đổi, cửa sổ đã đóng',
        'Đưa các đầu ngón vào lại để mở cửa sổ mới.',
        reason,
      )
  }
}

function mouseClosed(_input: GuidanceInput, reason: CloseReason): Guidance {
  switch (reason) {
    case 'user':
    case 'few-points':
    case 'stale-point':
    case 'out-of-board':
    case 'ambiguous-hands':
    case 'no-camera':
    case 'tab-hidden':
      return g(
        2,
        'info',
        'Mở cửa sổ bằng chuột',
        'Bấm hoặc kéo trên bảng để mở một cửa sổ vuông. Chọn nguồn cửa sổ Tay trong Cài đặt để mở theo các đầu ngón.',
        reason,
      )
    case 'too-small':
      return g(2, 'warn', 'Cửa sổ quá nhỏ', 'Lăn chuột để phóng to cửa sổ.', reason)
    case 'config-changed':
      return g(
        2,
        'info',
        'Cài đặt vừa đổi, cửa sổ đã đóng',
        'Bấm trên bảng hoặc nhấn Space để mở lại.',
        reason,
      )
  }
}

function openGuidance(input: GuidanceInput): Guidance {
  const hands = input.source === 'hands'
  const lim = input.limited ? LIMITED : ''
  if (input.face === 'loading')
    return g(
      3,
      'wait',
      'Đang nạp bộ nhận diện mặt…',
      `Cửa sổ đã mở; khuôn mặt sẽ được tìm ngay khi nạp xong.${lim}`,
    )
  if (input.face === 'error')
    return g(
      3,
      'error',
      'Bộ nhận diện mặt không chạy được',
      'Cửa sổ vẫn mở nhưng không tìm được khuôn mặt. Tải lại trang.',
    )
  switch (input.status) {
    case 'searching':
      return g(
        3,
        'wait',
        'Đang tìm khuôn mặt trong cửa sổ',
        `Đưa khuôn mặt vào vùng đang mở. Chỉ phần này của camera được xử lý.${lim}`,
      )
    case 'too-small':
      return g(
        3,
        'warn',
        'Cửa sổ quá nhỏ cho khuôn mặt',
        (hands
          ? 'Xòe ngón hoặc tách hai tay xa hơn để cửa sổ rộng hơn.'
          : 'Lăn chuột để phóng to cửa sổ.') + lim,
      )
    case 'face-candidate': {
      const label = input.subject ? subjectText(input.subject) : null
      // Model phân loại đang là stub theo màu: nói rõ trong hướng dẫn, không chỉ ở hậu tố nhãn.
      const demo =
        label && isDemoClassifier()
          ? ' Nhãn người/hình nộm đến từ model demo theo màu, chưa phải model huấn luyện.'
          : ''
      return g(
        3,
        'ok',
        label ? `Khuôn mặt trong cửa sổ: ${label}` : 'Khuôn mặt trong cửa sổ',
        `Nhận diện chỉ chạy trên vùng mở. Dời hoặc thu nhỏ cửa sổ để thấy vùng ngoài đóng lại.${demo}${lim}`,
      )
    }
    case 'partial-face':
      return g(
        3,
        'warn',
        'Khuôn mặt bị cắt',
        (hands
          ? 'Mở rộng hoặc dời cửa sổ để khuôn mặt nằm trọn trong vùng mở.'
          : 'Kéo cửa sổ hoặc lăn chuột để phóng to.') + lim,
      )
    case 'covered':
      return g(2, 'wait', 'Đang mở cửa sổ…', `Vùng mở sẽ hiện ở frame kế.${lim}`)
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
