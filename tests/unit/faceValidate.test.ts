import { describe, expect, it } from 'vitest'
import { computeLayout } from '../../src/core/coords'
import { computeLetterbox } from '../../src/core/letterbox'
import type { FaceResult } from '../../src/core/types'
import { validateFace, type ValidateContext } from '../../src/face/faceValidate'
import { buildMask, polygonShape, windowShape } from '../../src/mask/buildMask'

// FACE-02 bước 2 (mục 7.12): 64 × 36 trên 1280 × 720, c = 20, scale 1, nên px camera = px stage khi không mirror.
const L = computeLayout({ w: 1280, h: 720 }, { cols: 64, rows: 36 }, { w: 1280, h: 720 })
const win = { col: 10, row: 5, n: 8 } // cameraRect 200,100,160,160
const mask = buildMask(windowShape(win), L, false, 7)
const roi = mask.cameraRect
const lb = computeLetterbox(roi.w, roi.h, 256)
const task = { taskId: 5, epoch: 7, ts: 1000, roiCam: { ...roi }, letterbox: lb }

/** Điểm camera → landmark chuẩn hóa theo ảnh letterbox của tác vụ. */
const norm = (x: number, y: number): [number, number, number] => [
  (lb.dx + (x - roi.x) * lb.scale) / 256,
  (lb.dy + (y - roi.y) * lb.scale) / 256,
  0,
]
/** Mặt là hình chữ nhật các điểm góc và tâm trong không gian camera. */
function face(x: number, y: number, w: number, h: number) {
  return {
    landmarksNorm: [
      norm(x, y),
      norm(x + w, y),
      norm(x, y + h),
      norm(x + w, y + h),
      norm(x + w / 2, y + h / 2),
    ],
  }
}
const result = (faces: FaceResult['faces'], epoch = 7, taskId = 5): FaceResult => ({
  taskId,
  epoch,
  frameId: 1,
  ts: 1000,
  inferMs: 10,
  faces,
})
const ctx: ValidateContext = {
  currentMask: mask,
  currentEpoch: 7,
  now: 1100,
  layout: L,
  mirror: false,
  rejectedUpTo: 0,
}

describe('validateFace', () => {
  it('loại cả kết quả: epoch cũ, taskId đã bị rejectAll, quá tuổi 250 ms, không còn mask', () => {
    const inside = [face(240, 140, 60, 60)]
    expect(validateFace(result(inside, 6), task, ctx)).toEqual({
      kind: 'rejected',
      reason: 'epoch',
    })
    expect(validateFace(result(inside), task, { ...ctx, rejectedUpTo: 5 })).toEqual({
      kind: 'rejected',
      reason: 'rejected-task',
    })
    expect(validateFace(result(inside), task, { ...ctx, now: 1251 })).toEqual({
      kind: 'rejected',
      reason: 'stale',
    })
    expect(validateFace(result(inside), task, { ...ctx, now: 1250 }).kind).toBe('ok')
    expect(validateFace(result(inside), task, { ...ctx, currentMask: null })).toEqual({
      kind: 'rejected',
      reason: 'no-mask',
    })
  })

  it('mặt trọn trong ROI lùi 4% và trong mask: full; bboxStage và landmarksStage đúng tọa độ, giữ đủ điểm', () => {
    const out = validateFace(result([face(240, 140, 60, 60)]), task, ctx)
    expect(out.kind).toBe('ok')
    if (out.kind !== 'ok') return
    expect(out.dropped).toBe(0)
    expect(out.faces).toHaveLength(1)
    const f = out.faces[0]
    expect(f.status).toBe('full')
    expect(f.subjectType).toBe('unknown')
    expect(f.bboxStage.x).toBeCloseTo(240, 6)
    expect(f.bboxStage.y).toBeCloseTo(140, 6)
    expect(f.bboxStage.w).toBeCloseTo(60, 6)
    expect(f.bboxStage.h).toBeCloseTo(60, 6)
    expect(f.landmarksStage).toHaveLength(5)
    expect(f.landmarksStage[4].x).toBeCloseTo(270, 6)
  })

  it('mặt chạm mép ROI trong lề 4% (6.4 px): không full, còn giao mask nên partial', () => {
    const out = validateFace(result([face(202, 140, 60, 60)]), task, ctx)
    if (out.kind !== 'ok') throw new Error(out.kind)
    expect(out.faces[0].status).toBe('partial')
    const ok = validateFace(result([face(207, 140, 60, 60)]), task, ctx)
    if (ok.kind !== 'ok') throw new Error(ok.kind)
    expect(ok.faces[0].status).toBe('full')
  })

  it('cửa sổ đã dời: kết quả ánh xạ theo ROI cũ; giao mask mới thì partial và chỉ giữ landmark trong stageRect mới', () => {
    const moved = buildMask(windowShape({ col: 14, row: 5, n: 8 }), L, false, 7) // cameraRect 280..440
    const out = validateFace(result([face(240, 140, 80, 60)]), task, { ...ctx, currentMask: moved })
    if (out.kind !== 'ok') throw new Error(out.kind)
    expect(out.faces[0].status).toBe('partial')
    // bbox vẫn theo ROI cũ (240..320), không theo mask mới
    expect(out.faces[0].bboxStage.x).toBeCloseTo(240, 6)
    for (const p of out.faces[0].landmarksStage) expect(p.x).toBeGreaterThanOrEqual(280)
    // Hai góc phải (x = 320) và tâm (x = 280, đúng mép trái của mask mới nên vẫn là trong).
    expect(out.faces[0].landmarksStage).toHaveLength(3)
  })

  it('bbox không giao mask hiện tại: bỏ mặt, đếm dropped; kết quả vẫn ok (0 mặt)', () => {
    const far = buildMask(windowShape({ col: 30, row: 5, n: 8 }), L, false, 7)
    const out = validateFace(result([face(240, 140, 60, 60)]), task, { ...ctx, currentMask: far })
    expect(out).toEqual({ kind: 'ok', faces: [], dropped: 1 })
  })

  it('mirror: bboxStage đảo trục x quanh bảng, landmark lọc theo stageRect đã mirror', () => {
    const mm = buildMask(windowShape(win), L, true, 7)
    const t = { ...task, roiCam: { ...mm.cameraRect } }
    const r = mm.cameraRect
    // norm() chuẩn hóa theo ROI không mirror; validate cộng roiCam của tác vụ nên điểm về r.x + 40.
    const out = validateFace(result([face(roi.x + 40, roi.y + 40, 60, 60)]), t, {
      ...ctx,
      currentMask: mm,
      mirror: true,
    })
    if (out.kind !== 'ok') throw new Error(out.kind)
    expect(out.faces[0].status).toBe('full')
    expect(out.faces[0].bboxStage.x).toBeCloseTo(1280 - (r.x + 40) - 60, 6)
    expect(out.faces[0].landmarksStage).toHaveLength(5)
  })
})

// ROI-02 (D-038): mask tứ giác có lỗ: full khi bbox nằm trọn trong ô mở, partial khi chạm ô mở, bỏ khi chỉ nằm trong
// lỗ; landmark trong lỗ bị lọc.
describe('validateFace với mask tứ giác', () => {
  // Cùng ROI của tác vụ (200..360); mask hiện tại là tam giác gần tứ giác (200,100) (360,100) (360,260) (358,260):
  // phần dưới đường chéo từ (200,100) tới (358,260) là lỗ.
  const quad = buildMask(
    polygonShape([
      { x: 200, y: 100 },
      { x: 360, y: 100 },
      { x: 360, y: 260 },
      { x: 358, y: 260 },
    ]),
    L,
    false,
    7,
  )
  const qctx = { ...ctx, currentMask: quad }

  it('mặt trên đường chéo: partial, landmark dưới đường chéo bị lọc; mặt trong lỗ bị bỏ; mặt trên vùng mở: full', () => {
    expect(quad.holesCam.length).toBeGreaterThan(0)
    const across = validateFace(result([face(240, 140, 60, 60)]), task, qctx)
    if (across.kind !== 'ok') throw new Error(across.kind)
    expect(across.faces[0].status).toBe('partial')
    expect(across.faces[0].landmarksStage.length).toBeGreaterThan(0)
    expect(across.faces[0].landmarksStage.length).toBeLessThan(5)
    const inHole = validateFace(result([face(210, 220, 20, 20)]), task, qctx)
    expect(inHole).toEqual({ kind: 'ok', faces: [], dropped: 1 })
    const above = validateFace(result([face(300, 120, 40, 30)]), task, qctx)
    if (above.kind !== 'ok') throw new Error(above.kind)
    expect(above.faces[0].status).toBe('full')
    expect(above.faces[0].landmarksStage).toHaveLength(5)
  })
})
