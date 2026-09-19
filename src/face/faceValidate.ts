// FACE-02 bước 2: validate(result, task, ctx) → ValidatedFace[] theo cây quyết định mục 5.10. Loại cả kết quả khi
// khác epoch, quá tuổi (freshness.faceResultMaxAgeMs tính từ ts của frame gửi), không còn mask, hoặc taskId đã bị
// rejectAll. Với từng mặt: bbox (không gian camera) nằm trong task.roiCam lùi vào m = 4% cạnh ngắn ROI và, đổi sang
// stage, nằm trọn trong hợp các ô mở của currentMask → full; chạm ô mở nhưng không trọn → partial; không chạm → bỏ
// mặt (ROI-02, D-038: mask là tập ô, không phải rect). landmarksStage chỉ giữ điểm nằm trong ô mở. Chỉ import core/
// và file cùng thư mục (I1).
import { stagePointInCells, stageRectInsideCells, stageRectTouchesCells } from '../core/cells'
import { DEFAULTS } from '../core/config'
import { cameraToStage, type Layout } from '../core/coords'
import type { Letterbox } from '../core/letterbox'
import { insetRect, rectContains } from '../core/rect'
import type { FaceResult, Rect, RevealMask, ValidatedFace } from '../core/types'
import { faceBboxCam, landmarksToCam, rectCamToStage } from './faceMapping'

/** Phần của tác vụ mà validate cần (PendingTask của FaceClient thỏa cấu trúc này). */
export type FaceTaskRef = {
  taskId: number
  epoch: number
  ts: number
  roiCam: Rect
  letterbox: Letterbox
}

export type RejectReason = 'epoch' | 'stale' | 'no-mask' | 'rejected-task'

export type ValidateContext = {
  currentMask: RevealMask | null
  currentEpoch: number
  now: number
  layout: Layout
  mirror: boolean
  /** Mọi taskId ≤ giá trị này đã bị rejectAll. */
  rejectedUpTo: number
  maxAgeMs?: number
  marginRatio?: number
}

export type ValidateOutcome =
  | { kind: 'ok'; faces: ValidatedFace[]; dropped: number }
  | { kind: 'rejected'; reason: RejectReason }

export function validateFace(
  result: FaceResult,
  task: FaceTaskRef,
  ctx: ValidateContext,
): ValidateOutcome {
  const maxAge = ctx.maxAgeMs ?? DEFAULTS.freshness.faceResultMaxAgeMs
  const ratio = ctx.marginRatio ?? DEFAULTS.face.fullFaceMarginRatio
  if (result.epoch !== ctx.currentEpoch) return { kind: 'rejected', reason: 'epoch' }
  if (result.taskId <= ctx.rejectedUpTo) return { kind: 'rejected', reason: 'rejected-task' }
  if (ctx.now - task.ts > maxAge) return { kind: 'rejected', reason: 'stale' }
  const mask = ctx.currentMask
  if (!mask) return { kind: 'rejected', reason: 'no-mask' }

  const margin = Math.min(task.roiCam.w, task.roiCam.h) * ratio
  const inner = insetRect(task.roiCam, margin)
  const faces: ValidatedFace[] = []
  let dropped = 0
  for (const f of result.faces) {
    const pts = landmarksToCam(f.landmarksNorm, task.letterbox, task.roiCam)
    const bbox = faceBboxCam(pts)
    if (!bbox) {
      dropped++
      continue
    }
    const bboxStage = rectCamToStage(bbox, ctx.layout, ctx.mirror)
    let status: ValidatedFace['status']
    if (rectContains(inner, bbox) && stageRectInsideCells(bboxStage, mask, ctx.layout))
      status = 'full'
    else if (stageRectTouchesCells(bboxStage, mask, ctx.layout)) status = 'partial'
    else {
      dropped++
      continue
    }
    const landmarksStage = pts
      .map((p) => cameraToStage(p, ctx.layout, ctx.mirror))
      .filter((p) => stagePointInCells(p, mask, ctx.layout))
    faces.push({
      status,
      bboxStage,
      landmarksStage,
      visible: pts.length ? landmarksStage.length / pts.length : 0,
      subjectType: 'unknown',
    })
  }
  return { kind: 'ok', faces, dropped }
}
