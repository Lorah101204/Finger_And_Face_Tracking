// FACE-02 bước 1: landmarksNorm (theo ảnh letterbox) → px crop (bỏ letterbox) → px camera (cộng roiCam của tác vụ)
// → stage qua cameraToStage. Chỉ import core/ (bất biến I1). Layout dùng để sang stage là layout hiện tại: đổi layout
// thì epoch đổi và kết quả bị loại ở validate trước khi tới bước này (D-032), nên đó cũng là layout của epoch tác vụ.
import { cameraToStage, rectCameraToStage, type Layout } from '../core/coords'
import { letterboxNormToCam, type Letterbox } from '../core/letterbox'
import { bboxOfPoints } from '../core/rect'
import type { Point, Rect } from '../core/types'

export type LandmarkNorm = readonly [number, number, number]

/** Landmark chuẩn hóa theo ảnh letterbox → px camera (z bỏ qua). */
export function landmarksToCam(
  landmarksNorm: readonly LandmarkNorm[],
  letterbox: Letterbox,
  roiCam: Rect,
): Point[] {
  return landmarksNorm.map(([x, y]) => letterboxNormToCam({ x, y }, letterbox, roiCam))
}

/** bbox trong không gian camera = min/max của các landmark. */
export function faceBboxCam(pointsCam: readonly Point[]): Rect | null {
  return bboxOfPoints(pointsCam)
}

/** Rect camera → rect stage (mirror đảo trục x nên lấy min/max của hai góc); toán ở core/coords. */
export function rectCamToStage(r: Rect, layout: Layout, mirror: boolean): Rect {
  return rectCameraToStage(r, layout, mirror)
}

export function pointsCamToStage(pts: readonly Point[], layout: Layout, mirror: boolean): Point[] {
  return pts.map((p) => cameraToStage(p, layout, mirror))
}
