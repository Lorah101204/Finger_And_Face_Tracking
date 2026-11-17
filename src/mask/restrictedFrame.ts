// MASK-02: nơi duy nhất tạo RestrictedFrame (bất biến I1, I3; mục 5.9; D-012, D-030). Hai bước tách biệt:
// 1) Crop 1:1: OffscreenCanvas kích thước đúng cameraRect (tái sử dụng, chỉ đổi cỡ khi rect đổi cỡ),
//    drawImage(source, rx, ry, rw, rh, 0, 0, rw, rh): không scale nên không nội suy ở biên; canvas crop không
//    chứa pixel nào ngoài cameraRect. ROI-02 (D-038): các ô trong hộp bao mà không mở (mask.holesCam) được tô đệm
//    xám ngay trên canvas crop, nên buffer chỉ còn pixel của ô mở.
// 2) Letterbox: canvas size × size fill xám, vẽ canvas crop (không phải video) giữ tỉ lệ vào giữa rồi
//    transferToImageBitmap; bước này chỉ đọc canvas crop nên dù có nội suy cũng không với tới pixel ngoài ROI.
// Nguồn là FrameSource.drawable (video ẩn hoặc canvas tổng hợp), không bao giờ là canvas output; buffer ở không gian
// camera, không mirror. Probe (?debug=1) nhận bản sao ImageData của ảnh letterbox ngay trước transfer, nhịp do probes
// giới hạn (D-012). Cần hai bitmap (face và classifier) thì vẽ lại letterbox và transfer lần nữa.
// CLS-05 (D-070): `opts.roi` là crop con (crop quanh mặt cho classifier, classify/faceCrop.ts): rect được cắt lại theo
// cameraRect của mask trước khi đọc, nên vẫn không có pixel nào ngoài hộp bao vùng mở; ô lỗ giao crop con vẫn tô xám;
// dataset mode không nhận crop con (mẫu vẫn là crop cả vùng, kèm bbox mặt trong CropMeta.face); probe vẫn nhận nên
// gate audit của e2e đo cả buffer của classifier.
import type { FrameSource } from '../camera/frameSource'
import { DEFAULTS } from '../core/config'
import { computeLetterbox, type Letterbox } from '../core/letterbox'
import type { CropTap, FrameStamp, Rect, RestrictedFrame, RevealMask, Size } from '../core/types'
import type { Probes } from '../debug/probes'

export type RestrictedBuild =
  | { kind: 'ok'; frames: RestrictedFrame[] }
  /** Cạnh ngắn của cameraRect dưới ngưỡng: không tạo tác vụ, không động tới canvas. */
  | { kind: 'too-small'; side: number; minRoiPx: number }
  /** Nguồn chưa có frame (drawable null). */
  | { kind: 'no-frame' }

export type RestrictedStats = {
  builds: number
  bitmaps: number
  tooSmall: number
  noFrame: number
  lastTaskId: number
  lastRoiCam: Rect | null
  lastLetterbox: Letterbox | null
  lastCrop: Size | null
  lastKind: RestrictedBuild['kind'] | null
  lastBuildMs: number
  /**
   * CLS-05: số buffer dựng từ crop con (opts.roi) và crop con gần nhất. Các trường builds, lastTaskId, lastRoiCam,
   * lastCrop, lastLetterbox ở trên chỉ tính buffer cả vùng (của worker mặt), như trước CLS-05.
   */
  subBuilds: number
  lastSubRoiCam: Rect | null
}

export type RestrictedBuildOptions = {
  /** CLS-05 (D-070): crop con trong mask.cameraRect (được cắt lại theo cameraRect); thiếu hay null thì cả cameraRect. */
  roi?: Rect | null
  /** CLS-05: bbox mặt mục tiêu (px camera) ghi vào CropMeta.face cho dataset mode (chỉ khi crop cả vùng). */
  faceCam?: Rect | null
}

export type RestrictedFrameBuilder = {
  /**
   * Tạo buffer cho một frame: `copies` bitmap (mặc định 1) từ cùng ảnh letterbox, mỗi worker một bitmap.
   * taskId do vòng lặp cấp; kết quả too-small hay no-frame không tiêu taskId.
   */
  build(
    source: FrameSource,
    mask: RevealMask,
    stamp: FrameStamp,
    epoch: number,
    taskId: number,
    copies?: number,
    opts?: RestrictedBuildOptions,
  ): RestrictedBuild
  readonly stats: RestrictedStats
  dispose(): void
}

export type RestrictedFrameOptions = {
  probes?: Probes
  /** CLS-01: dataset mode nhận crop trước letterbox. */
  crops?: CropTap
  /** Cạnh ảnh letterbox (mặc định face.inputSize). */
  inputSize?: number
  /** Mức xám đệm 0..255 (mặc định face.padGray). */
  padGray?: number
  /** Cạnh ngắn tối thiểu của cameraRect (mặc định face.minRoiPx). */
  minRoiPx?: number
  /** Unit test trong Node thay OffscreenCanvas bằng canvas giả. */
  createCanvas?: (w: number, h: number) => OffscreenCanvas
}

type Ctx = OffscreenCanvasRenderingContext2D

/** CLS-05: giao của crop con với cameraRect, làm tròn về px nguyên; rỗng thì cạnh 0 (too-small). */
function clipRect(roi: Rect, bounds: Rect): Rect {
  const x0 = Math.max(bounds.x, Math.round(roi.x))
  const y0 = Math.max(bounds.y, Math.round(roi.y))
  const x1 = Math.min(bounds.x + bounds.w, Math.round(roi.x + roi.w))
  const y1 = Math.min(bounds.y + bounds.h, Math.round(roi.y + roi.h))
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) }
}

export function createRestrictedFrameBuilder(
  opts: RestrictedFrameOptions = {},
): RestrictedFrameBuilder {
  const size = opts.inputSize ?? DEFAULTS.face.inputSize
  const gray = opts.padGray ?? DEFAULTS.face.padGray
  const minRoiPx = opts.minRoiPx ?? DEFAULTS.face.minRoiPx
  const createCanvas = opts.createCanvas ?? ((w: number, h: number) => new OffscreenCanvas(w, h))
  const probes = opts.probes
  const crops = opts.crops
  const padStyle = `rgb(${gray}, ${gray}, ${gray})`
  const stats: RestrictedStats = {
    builds: 0,
    bitmaps: 0,
    tooSmall: 0,
    noFrame: 0,
    lastTaskId: -1,
    lastRoiCam: null,
    lastLetterbox: null,
    lastCrop: null,
    lastKind: null,
    lastBuildMs: 0,
    subBuilds: 0,
    lastSubRoiCam: null,
  }
  let crop: OffscreenCanvas | null = null
  let cropCtx: Ctx | null = null
  let lb: OffscreenCanvas | null = null
  let lbCtx: Ctx | null = null

  function ctx2d(c: OffscreenCanvas): Ctx {
    const ctx = c.getContext('2d')
    if (!ctx) throw new Error('OffscreenCanvas không có context 2d')
    return ctx
  }

  /** Canvas crop đúng cỡ rect: tạo một lần, chỉ đổi width/height khi cỡ đổi (đổi cỡ cũng xóa nội dung cũ). */
  function cropCanvas(w: number, h: number): { canvas: OffscreenCanvas; ctx: Ctx } {
    if (!crop || !cropCtx) {
      crop = createCanvas(w, h)
      cropCtx = ctx2d(crop)
    } else if (crop.width !== w || crop.height !== h) {
      crop.width = w
      crop.height = h
    }
    return { canvas: crop, ctx: cropCtx }
  }

  function letterboxCanvas(): { canvas: OffscreenCanvas; ctx: Ctx } {
    if (!lb || !lbCtx) {
      lb = createCanvas(size, size)
      lbCtx = ctx2d(lb)
    }
    return { canvas: lb, ctx: lbCtx }
  }

  return {
    stats,
    build(source, mask, stamp, epoch, taskId, copies = 1, opts = {}) {
      const sub = opts.roi ? clipRect(opts.roi, mask.cameraRect) : null
      const r = sub ?? mask.cameraRect
      const side = Math.min(r.w, r.h)
      // Crop con không đổi các bộ đếm too-small, no-frame của buffer cả vùng (dòng debug "cửa sổ quá nhỏ cho mặt").
      if (side < minRoiPx) {
        if (!sub) {
          stats.tooSmall++
          stats.lastKind = 'too-small'
        }
        return { kind: 'too-small', side, minRoiPx }
      }
      const drawable = source.drawable
      if (!drawable) {
        if (!sub) {
          stats.noFrame++
          stats.lastKind = 'no-frame'
        }
        return { kind: 'no-frame' }
      }
      const t0 = performance.now()
      // Bước 1: crop 1:1, rect nguyên (buildMask đã làm tròn và clip), không scale.
      const c = cropCanvas(r.w, r.h)
      c.ctx.clearRect(0, 0, r.w, r.h)
      c.ctx.drawImage(drawable, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h)
      if (mask.holesCam.length > 0) {
        c.ctx.fillStyle = padStyle
        for (const hole of mask.holesCam) {
          c.ctx.fillRect(hole.x - r.x, hole.y - r.y, hole.w, hole.h)
        }
      }
      if (!sub && crops?.wants(stamp.ts)) {
        // CLS-01: crop trước letterbox cho dataset mode (I8), cùng canvas crop nên không có pixel ngoài cameraRect.
        const f = opts.faceCam
        crops.emit(c.ctx.getImageData(0, 0, r.w, r.h), {
          epoch,
          frameId: stamp.frameId,
          ts: stamp.ts,
          taskId,
          roiCam: { x: r.x, y: r.y, w: r.w, h: r.h },
          box: { w: mask.box.w, h: mask.box.h },
          cells: mask.cellCount,
          holes: mask.holesCam.length,
          face: f ? { x: f.x - r.x, y: f.y - r.y, w: f.w, h: f.h } : null,
        })
      }
      // Bước 2: letterbox từ canvas crop; kích thước đích giữ số thực để ánh xạ ngược chính xác (core/letterbox.ts).
      const letterbox = computeLetterbox(r.w, r.h, size)
      const l = letterboxCanvas()
      const paint = () => {
        l.ctx.fillStyle = padStyle
        l.ctx.fillRect(0, 0, size, size)
        l.ctx.drawImage(
          c.canvas,
          0,
          0,
          r.w,
          r.h,
          letterbox.dx,
          letterbox.dy,
          r.w * letterbox.scale,
          r.h * letterbox.scale,
        )
      }
      paint()
      const roiCam: Rect = { x: r.x, y: r.y, w: r.w, h: r.h }
      if (probes?.wantsRestrictedFrame(stamp.ts)) {
        // Bản sao đúng như gửi cho worker, đọc trước transfer (mục 5.9).
        probes.emitRestrictedFrame(l.ctx.getImageData(0, 0, size, size), {
          epoch,
          frameId: stamp.frameId,
          ts: stamp.ts,
          taskId,
          roiCam: { ...roiCam },
          ...(sub ? { sub: true } : {}),
        })
      }
      const n = Math.max(1, Math.floor(copies))
      const frames: RestrictedFrame[] = []
      for (let i = 0; i < n; i++) {
        if (i > 0) paint() // transferToImageBitmap để lại canvas trống
        frames.push({
          taskId,
          epoch,
          frameId: stamp.frameId,
          ts: stamp.ts,
          roiCam: { ...roiCam },
          input: l.canvas.transferToImageBitmap(),
          letterbox,
        })
      }
      stats.bitmaps += n
      if (sub) {
        stats.subBuilds++
        stats.lastSubRoiCam = roiCam
      } else {
        stats.builds++
        stats.lastTaskId = taskId
        stats.lastRoiCam = roiCam
        stats.lastLetterbox = letterbox
        stats.lastCrop = { w: r.w, h: r.h }
        stats.lastKind = 'ok'
        stats.lastBuildMs = performance.now() - t0
      }
      return { kind: 'ok', frames }
    },
    dispose() {
      crop = null
      cropCtx = null
      lb = null
      lbCtx = null
    },
  }
}
