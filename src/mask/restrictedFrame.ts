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
    build(source, mask, stamp, epoch, taskId, copies = 1) {
      const r = mask.cameraRect
      const side = Math.min(r.w, r.h)
      if (side < minRoiPx) {
        stats.tooSmall++
        stats.lastKind = 'too-small'
        return { kind: 'too-small', side, minRoiPx }
      }
      const drawable = source.drawable
      if (!drawable) {
        stats.noFrame++
        stats.lastKind = 'no-frame'
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
      if (crops?.wants(stamp.ts)) {
        // CLS-01: crop trước letterbox cho dataset mode (I8), cùng canvas crop nên không có pixel ngoài cameraRect.
        crops.emit(c.ctx.getImageData(0, 0, r.w, r.h), {
          epoch,
          frameId: stamp.frameId,
          ts: stamp.ts,
          taskId,
          roiCam: { x: r.x, y: r.y, w: r.w, h: r.h },
          box: { w: mask.box.w, h: mask.box.h },
          cells: mask.cellCount,
          holes: mask.holesCam.length,
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
      stats.builds++
      stats.bitmaps += n
      stats.lastTaskId = taskId
      stats.lastRoiCam = roiCam
      stats.lastLetterbox = letterbox
      stats.lastCrop = { w: r.w, h: r.h }
      stats.lastKind = 'ok'
      stats.lastBuildMs = performance.now() - t0
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
