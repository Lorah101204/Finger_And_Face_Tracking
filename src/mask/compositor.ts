// GRID-01: nền trắng và vạch lưới (vẽ sau nền trắng, bất biến I4). MASK-01: render() vẽ camera chỉ trong các ô mở
// của mask (bất biến I2: dùng đúng RevealMask, không tự tính rect khác): clip bằng path hợp các ô mở (ROI-02, D-038;
// hộp đầy thì một rect) rồi drawImage cameraRect → stageRect của hộp bao. Đây là nơi duy nhất drawImage lên output;
// tools/check-invariants.mjs kiểm drawImage chỉ ở file này và restrictedFrame.ts, luôn có rect nguồn (9 tham số).
// FACE-02: overlay mặt đã validate vẽ trong cùng clip: bbox (full nét liền, partial nét đứt) và landmark (chỉ các
// điểm validate đã giữ lại, tức nằm trong ô mở lúc validate). Viền: cạnh biên của hợp ô mở; tứ giác của tay vẽ thêm
// nét đứt mảnh.
// HAND-01 bước 5: overlay debug tay (bbox, năm đầu ngón, tâm lòng bàn tay, nhãn id và trái/phải) vẽ trên nền trắng
// bằng fillRect, strokeRect, fillText: không có pixel camera, nên được vẽ cả ngoài stageRect và khi không có mask.
import { cellOutlineEdges, isFullBox, listCells } from '../core/cells'
import { cameraToStage, rectCameraToStage, type Layout } from '../core/coords'
import { DEFAULTS } from '../core/config'
import { FINGER_TIPS } from '../core/handLandmarks'
import type { FingerStatus, HandFrame, Handedness, RevealMask, ValidatedFace } from '../core/types'
import { subjectText } from '../classify/subjectRule'

/** Xám nhạt của vạch lưới. e2e coi màu này và trắng là "chưa có pixel camera" (mục 7.6). */
export const GRID_LINE_COLOR = '#e6e6e6'
export const GRID_LINE_RGBA: readonly [number, number, number, number] = [230, 230, 230, 255]
/** ROI-00: viền cửa sổ (overlay, vẽ trong stageRect); màu đỏ khi cửa sổ đang bị kẹp ở mép bảng. */
export const WINDOW_OUTLINE_COLOR = '#1a73e8'
export const WINDOW_OUTLINE_LIMITED_COLOR = '#d93025'
export const WINDOW_OUTLINE_RGBA: readonly [number, number, number, number] = [26, 115, 232, 255]
export const WINDOW_OUTLINE_LIMITED_RGBA: readonly [number, number, number, number] = [
  217, 48, 37, 255,
]
/** FACE-02: màu overlay mặt full (xanh lá đậm) và partial (hổ phách, nét đứt). */
export const FACE_FULL_COLOR = '#188038'
export const FACE_PARTIAL_COLOR = '#f9ab00'
/** CLS-02: nền nhãn phân loại theo subjectType. */
export const SUBJECT_COLOR: Record<ValidatedFace['subjectType'], string> = {
  person: '#188038',
  mannequin: '#c5221f',
  unknown: '#5f6368',
}
export const FACE_FULL_RGBA: readonly [number, number, number, number] = [24, 128, 56, 255]
export const FACE_PARTIAL_RGBA: readonly [number, number, number, number] = [249, 171, 0, 255]
/** HAND-01: màu overlay tay trái (tím) và tay phải (xanh ngọc). */
export const HAND_LEFT_COLOR = '#8e24aa'
export const HAND_RIGHT_COLOR = '#00897b'
export const HAND_LEFT_RGBA: readonly [number, number, number, number] = [142, 36, 170, 255]
export const HAND_RIGHT_RGBA: readonly [number, number, number, number] = [0, 137, 123, 255]
/** ROI-03: màu chấm đầu ngón theo tay (cùng màu overlay tay). */
export const FINGER_COLORS: Record<Handedness, string> = {
  left: HAND_LEFT_COLOR,
  right: HAND_RIGHT_COLOR,
}
export const SLOT_RGBA: readonly (readonly [number, number, number, number])[] = [
  [229, 57, 53, 255],
  [251, 140, 0, 255],
  [30, 136, 229, 255],
  [67, 160, 71, 255],
]

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/**
 * Fill trắng toàn canvas rồi vẽ vạch lưới 1 px thiết bị tại mọi ranh giới ô, kể cả biên bảng (vạch biên phải và
 * dưới nằm trong bảng để không tràn ra ngoài). Không vẽ gì khác.
 */
export function paintBackground(ctx: Ctx2D, layout: Layout, showLines: boolean): void {
  const { stage, board, c, cols, rows } = layout
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, stage.w, stage.h)
  if (!showLines || c === 0) return
  ctx.fillStyle = GRID_LINE_COLOR
  for (let k = 0; k <= cols; k++) {
    const x = k === cols ? board.x + board.w - 1 : board.x + k * c
    ctx.fillRect(x, board.y, 1, board.h)
  }
  for (let k = 0; k <= rows; k++) {
    const y = k === rows ? board.y + board.h - 1 : board.y + k * c
    ctx.fillRect(board.x, y, board.w, 1)
  }
}

export type RenderOptions = {
  showLines: boolean
  mirror: boolean
  /** Frame camera gốc (video ẩn của CameraSource hoặc canvas của SyntheticCameraSource); null khi chưa có camera. */
  drawable: CanvasImageSource | null
  mask: RevealMask | null
  /** FACE-02: mặt đã validate theo mask hiện tại; vẽ trong clip(stageRect). */
  faces?: ValidatedFace[]
  /** HAND-01: HandFrame mới nhất để vẽ overlay debug tay; null hoặc bỏ trống thì không vẽ. */
  hands?: HandFrame | null
  /** Thời điểm vẽ (performance.now) để làm mờ tay cũ hơn freshness.pointMaxAgeMs. */
  now?: number
  /** ROI-03: đầu ngón đã chọn của mọi tay; chấm màu theo tay, mờ khi không hợp lệ. */
  fingers?: readonly FingerStatus[]
}

/**
 * MASK-01: một frame output = nền trắng → vạch lưới → (chỉ khi có mask và có camera) drawImage từ cameraRect vào
 * stageRect trong ctx.clip(stageRect); mirror bằng translate + scale(-1, 1) chỉ trong phạm vi stageRect → overlay
 * (viền cửa sổ; bốn chấm và mặt ở các gói sau). Không tích lũy: mỗi frame vẽ lại toàn bộ nên ô cũ tự đóng khi cửa sổ
 * dời. Không có mask thì không vẽ video (I4); không có đường nào drawImage toàn khung. Thứ tự: video → mặt → viền.
 */
export function render(ctx: Ctx2D, layout: Layout, opts: RenderOptions): void {
  paintBackground(ctx, layout, opts.showLines)
  const { mask, drawable } = opts
  if (mask && mask.cellCount > 0) drawWindow(ctx, layout, mask, drawable, opts)
  if (opts.hands && opts.hands.hands.length > 0)
    drawHands(ctx, layout, opts.mirror, opts.hands, opts.now ?? opts.hands.ts)
  if (opts.fingers && opts.fingers.length > 0) drawFingertips(ctx, opts.fingers)
}

/**
 * ROI-03 (thay chấm slot của HAND-02): chấm 8 px màu theo tay tại pStage của từng đầu ngón; điểm cũ, ngoài bảng,
 * chưa rõ tay hoặc uncertain vẽ mờ. Chỉ fillRect trên nền trắng: không có pixel camera.
 */
export function drawFingertips(ctx: Ctx2D, fingers: readonly FingerStatus[]): void {
  ctx.save()
  for (const s of fingers) {
    ctx.globalAlpha = s.valid ? 1 : 0.4
    ctx.fillStyle = FINGER_COLORS[s.hand]
    const x = Math.round(s.pStage.x)
    const y = Math.round(s.pStage.y)
    ctx.fillRect(x - 4, y - 4, 8, 8)
  }
  ctx.restore()
}

/** Path clip = hợp các ô mở: một rect khi hộp đầy (chuột), từng ô khi đa giác. Gọi sau beginPath. */
function cellPath(ctx: Ctx2D, layout: Layout, mask: RevealMask): void {
  const s = mask.stageRect
  if (isFullBox(mask)) {
    ctx.rect(s.x, s.y, s.w, s.h)
    return
  }
  const { board, c } = layout
  for (const { col, row } of listCells(mask)) ctx.rect(board.x + col * c, board.y + row * c, c, c)
}

function drawWindow(
  ctx: Ctx2D,
  layout: Layout,
  mask: RevealMask,
  drawable: CanvasImageSource | null,
  opts: RenderOptions,
): void {
  const s = mask.stageRect
  const r = mask.cameraRect
  if (drawable && s.w > 0 && s.h > 0 && r.w > 0 && r.h > 0) {
    ctx.save()
    ctx.beginPath()
    cellPath(ctx, layout, mask)
    ctx.clip()
    if (opts.mirror) {
      ctx.translate(s.x + s.w, s.y)
      ctx.scale(-1, 1)
      ctx.drawImage(drawable, r.x, r.y, r.w, r.h, 0, 0, s.w, s.h)
    } else {
      ctx.drawImage(drawable, r.x, r.y, r.w, r.h, s.x, s.y, s.w, s.h)
    }
    ctx.restore()
  }
  if (opts.faces && opts.faces.length > 0) drawFaces(ctx, layout, mask, opts.faces)
  drawWindowOutline(ctx, layout, mask)
}

/**
 * FACE-02 bước 3: overlay mặt trong clip hợp các ô mở của mask hiện tại. full: bbox nét liền; partial: bbox nét đứt.
 * Landmark là chấm 2 px; validate đã lọc điểm ngoài ô mở, clip bảo đảm không có pixel overlay dưới vùng trắng kể cả
 * khi bbox tràn ra ngoài.
 */
export function drawFaces(
  ctx: Ctx2D,
  layout: Layout,
  mask: RevealMask,
  faces: readonly ValidatedFace[],
): void {
  const s = mask.stageRect
  if (s.w <= 0 || s.h <= 0) return
  ctx.save()
  ctx.beginPath()
  cellPath(ctx, layout, mask)
  ctx.clip()
  ctx.lineWidth = 2
  for (const f of faces) {
    const color = f.status === 'full' ? FACE_FULL_COLOR : FACE_PARTIAL_COLOR
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.setLineDash(f.status === 'partial' ? [6, 4] : [])
    const b = f.bboxStage
    ctx.strokeRect(Math.round(b.x), Math.round(b.y), Math.round(b.w), Math.round(b.h))
    for (const p of f.landmarksStage) ctx.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 1, 2, 2)
    // CLS-02 bước 6 (UC-07): nhãn "Người", "Hình nộm" hay "Khuôn mặt chưa phân loại" kèm độ tin cậy, chữ trên nền
    // đặc trong bbox (fillRect + fillText, không có pixel camera), cùng clip nên không ra ngoài vùng mở.
    const text = subjectText(f)
    ctx.font = 'bold 12px system-ui, sans-serif'
    const tw = ctx.measureText(text).width
    const tx = Math.round(b.x) + 3
    const ty = Math.round(b.y) + 15
    ctx.fillStyle = SUBJECT_COLOR[f.subjectType]
    ctx.fillRect(tx - 3, ty - 13, Math.ceil(tw) + 6, 17)
    ctx.fillStyle = '#fff'
    ctx.fillText(text, tx, ty)
    ctx.fillStyle = color
  }
  ctx.setLineDash([])
  ctx.restore()
}

/**
 * HAND-01 bước 5: overlay debug tay. Với mỗi track: bbox 1 px (nét đứt khi frame uncertain), năm đầu ngón là ô 4 px,
 * tâm lòng bàn tay là vòng 6 px, nhãn "Trái #id" hoặc "Phải #id" phía trên bbox (viền trắng cho dễ đọc). Tay cũ hơn
 * freshness.pointMaxAgeMs vẽ mờ. Chỉ fillRect, strokeRect, fillText: không vẽ pixel camera.
 */
export function drawHands(
  ctx: Ctx2D,
  layout: Layout,
  mirror: boolean,
  frame: HandFrame,
  now: number,
): void {
  if (layout.c === 0 || layout.scale === 0) return
  const stale = now - frame.ts > DEFAULTS.freshness.pointMaxAgeMs
  ctx.save()
  ctx.globalAlpha = stale ? 0.45 : 1
  ctx.lineWidth = 1
  ctx.font = '12px system-ui, sans-serif'
  ctx.textBaseline = 'alphabetic'
  ctx.setLineDash(frame.uncertain ? [4, 3] : [])
  for (const h of frame.hands) {
    const color = h.handedness === 'left' ? HAND_LEFT_COLOR : HAND_RIGHT_COLOR
    ctx.strokeStyle = color
    ctx.fillStyle = color
    const b = rectCameraToStage(h.bboxCam, layout, mirror)
    ctx.strokeRect(Math.round(b.x) + 0.5, Math.round(b.y) + 0.5, Math.round(b.w), Math.round(b.h))
    for (const i of FINGER_TIPS) {
      const lm = h.landmarksCam[i]
      if (!lm) continue
      const p = cameraToStage(lm, layout, mirror)
      ctx.fillRect(Math.round(p.x) - 2, Math.round(p.y) - 2, 4, 4)
    }
    const pc = cameraToStage(h.palmCenterCam, layout, mirror)
    ctx.strokeRect(Math.round(pc.x) - 3 + 0.5, Math.round(pc.y) - 3 + 0.5, 6, 6)
    const label = `${h.handedness === 'left' ? 'Trái' : 'Phải'} #${h.id}${frame.uncertain ? ' ?' : ''}`
    const tx = Math.round(b.x)
    const ty = Math.round(b.y) - 4
    ctx.lineWidth = 3
    ctx.strokeStyle = '#ffffff'
    ctx.strokeText(label, tx, ty)
    ctx.fillText(label, tx, ty)
    ctx.lineWidth = 1
  }
  ctx.setLineDash([])
  ctx.restore()
}

/**
 * Viền 2 px thiết bị nằm trọn trong vùng mở (không vẽ ra ngoài). Hộp đầy: strokeRect lùi 1 px. Tứ giác: mỗi cạnh biên
 * của hợp ô mở là một đoạn lùi 1 px vào trong ô (cùng phủ pixel như strokeRect với hộp đầy), rồi tứ giác của bốn đầu
 * ngón bằng nét đứt mảnh. Không vẽ pixel camera nào.
 */
export function drawWindowOutline(ctx: Ctx2D, layout: Layout, mask: RevealMask): void {
  const r = mask.stageRect
  if (r.w < 4 || r.h < 4) return
  ctx.save()
  ctx.strokeStyle = mask.limited ? WINDOW_OUTLINE_LIMITED_COLOR : WINDOW_OUTLINE_COLOR
  ctx.lineWidth = 2
  if (isFullBox(mask)) {
    ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2)
  } else {
    ctx.beginPath()
    for (const e of cellOutlineEdges(mask, layout)) {
      // Lùi 1 px vào trong ô (nét 2 px phủ đúng 2 px trong ô như strokeRect với hộp đầy).
      switch (e.side) {
        case 'left':
          ctx.moveTo(e.x0 + 1, e.y0)
          ctx.lineTo(e.x1 + 1, e.y1)
          break
        case 'right':
          ctx.moveTo(e.x0 - 1, e.y0)
          ctx.lineTo(e.x1 - 1, e.y1)
          break
        case 'top':
          ctx.moveTo(e.x0, e.y0 + 1)
          ctx.lineTo(e.x1, e.y1 + 1)
          break
        case 'bottom':
          ctx.moveTo(e.x0, e.y0 - 1)
          ctx.lineTo(e.x1, e.y1 - 1)
          break
      }
    }
    ctx.stroke()
  }
  if (mask.shape.kind === 'polygon' && mask.shape.polygonStage.length >= 3) {
    ctx.lineWidth = 1
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    mask.shape.polygonStage.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y)
      else ctx.lineTo(p.x, p.y)
    })
    ctx.closePath()
    ctx.stroke()
    ctx.setLineDash([])
  }
  ctx.restore()
}
