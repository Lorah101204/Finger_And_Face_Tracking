// HAND-01 bước 2: chuẩn hóa nhãn handedness (D-010) và chuyển kết quả thô của hand.worker (landmark chuẩn hóa theo
// bitmap, nhãn Left/Right) sang HandDetection px camera cho HandTracker. Thuần, unit test trong Node.
// D-010: tasks-vision 1.0.1 trả nhãn trùng tay giải phẫu trên frame CHƯA mirror; thiết kế luôn đưa frame thô vào
// model (mirror chỉ ở hiển thị) nên normalizeHandedness là hàm đồng nhất, chỉ đảo khi cờ handednessSwap bật
// (webcam thật cho nhãn ngược) hoặc khi (không xảy ra trong thiết kế này) ảnh đưa vào model đã bị lật.
import { DEFAULTS } from '../core/config'
import { PALM_INDEX } from '../core/handLandmarks'
import { bboxOfPoints } from '../core/rect'
import type { HandResult, Handedness, Point, Rect } from '../core/types'

export { FINGER_TIPS, HAND_LANDMARKS, PALM_INDEX, TIP_INDEX } from '../core/handLandmarks'

export type HandDetection = {
  handedness: Handedness
  /** điểm của nhãn model cho tay này */
  score: number
  landmarksCam: Point[]
  palmCenterCam: Point
  bboxCam: Rect
}

export type HandednessOptions = {
  /**
   * true chỉ khi ảnh đưa vào model đã bị lật ngang. Thiết kế luôn đưa frame thô nên là false; KHÔNG truyền cờ mirror
   * hiển thị vào đây.
   */
  inputMirrored?: boolean
  /** D-010: đảo trái/phải nếu webcam thật cho nhãn ngược (settings.handednessSwap); mặc định theo config. */
  swap?: boolean
}

/** Nhãn model ('Left', 'Right', không phân biệt hoa thường) → tay theo nghĩa người dùng; null khi nhãn lạ. */
export function normalizeHandedness(
  label: string,
  opts: HandednessOptions = {},
): Handedness | null {
  const l = label.trim().toLowerCase()
  if (l !== 'left' && l !== 'right') return null
  const flip = (opts.inputMirrored ?? false) !== (opts.swap ?? DEFAULTS.hands.handednessSwap)
  if (!flip) return l
  return l === 'left' ? 'right' : 'left'
}

export function palmCenter(landmarksCam: readonly Point[]): Point {
  let x = 0
  let y = 0
  let n = 0
  for (const i of PALM_INDEX) {
    const p = landmarksCam[i]
    if (!p) continue
    x += p.x
    y += p.y
    n++
  }
  if (n === 0) return { x: 0, y: 0 }
  return { x: x / n, y: y / n }
}

/** Landmark chuẩn hóa theo bitmap → px camera (bitmap là frame gốc nên cùng kích thước camera). */
export function resultToDetections(
  result: HandResult,
  opts: HandednessOptions = {},
): HandDetection[] {
  const out: HandDetection[] = []
  for (const h of result.hands) {
    const handedness = normalizeHandedness(h.label, opts)
    if (!handedness) continue
    const landmarksCam = h.landmarksNorm.map(([x, y]) => ({
      x: x * result.width,
      y: y * result.height,
    }))
    const bboxCam = bboxOfPoints(landmarksCam)
    if (!bboxCam) continue
    out.push({
      handedness,
      score: h.score,
      landmarksCam,
      palmCenterCam: palmCenter(landmarksCam),
      bboxCam,
    })
  }
  return out
}
