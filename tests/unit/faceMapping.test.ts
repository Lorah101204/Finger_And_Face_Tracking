import { describe, expect, it } from 'vitest'
import { computeLayout } from '../../src/core/coords'
import { computeLetterbox } from '../../src/core/letterbox'
import { faceBboxCam, landmarksToCam, rectCamToStage } from '../../src/face/faceMapping'

// FACE-02 bước 1: landmarksNorm → camera theo letterbox và roiCam của tác vụ; rect camera → stage (có mirror).
const roi = { x: 200, y: 100, w: 160, h: 120 }
const lb = computeLetterbox(roi.w, roi.h, 256) // scale 1.6, dx 0, dy floor((256 - 192) / 2) = 32

describe('faceMapping', () => {
  it('landmark chuẩn hóa qua letterbox về đúng px camera; góc (0, dy/256) là góc trên trái roiCam', () => {
    const pts = landmarksToCam(
      [
        [0, lb.dy / 256, 0],
        [1, (lb.dy + roi.h * lb.scale) / 256, 0.5],
        [0.5, 0.5, 0],
      ],
      lb,
      roi,
    )
    expect(pts[0].x).toBeCloseTo(roi.x, 9)
    expect(pts[0].y).toBeCloseTo(roi.y, 9)
    expect(pts[1].x).toBeCloseTo(roi.x + roi.w, 9)
    expect(pts[1].y).toBeCloseTo(roi.y + roi.h, 9)
    expect(pts[2].x).toBeCloseTo(roi.x + 80, 9)
    expect(pts[2].y).toBeCloseTo(roi.y + 60, 9)
    expect(faceBboxCam(pts)).toEqual({ x: roi.x, y: roi.y, w: roi.w, h: roi.h })
  })

  it('rectCamToStage: scale và dời theo bảng; mirror đảo trục x quanh bảng', () => {
    const L = computeLayout({ w: 1280, h: 720 }, { cols: 64, rows: 36 }, { w: 1280, h: 720 })
    expect(rectCamToStage(roi, L, false)).toEqual(roi)
    const m = rectCamToStage(roi, L, true)
    expect(m).toEqual({ x: 1280 - roi.x - roi.w, y: roi.y, w: roi.w, h: roi.h })
    const L2 = computeLayout({ w: 640, h: 360 }, { cols: 64, rows: 36 }, { w: 1280, h: 720 })
    const s = rectCamToStage(roi, L2, false)
    expect(s).toEqual({
      x: L2.board.x + roi.x * L2.scale,
      y: L2.board.y + roi.y * L2.scale,
      w: 80,
      h: 60,
    })
  })
})
