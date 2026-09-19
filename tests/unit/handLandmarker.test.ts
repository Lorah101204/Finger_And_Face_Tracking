import { describe, expect, it } from 'vitest'
import { DEFAULTS } from '../../src/core/config'
import type { HandResult } from '../../src/core/types'
import {
  FINGER_TIPS,
  PALM_INDEX,
  normalizeHandedness,
  palmCenter,
  resultToDetections,
} from '../../src/hands/handLandmarker'

// HAND-01 bước 2 (D-010): normalizeHandedness là hàm đồng nhất với frame thô; đảo khi swap hoặc khi ảnh vào model đã
// lật (không xảy ra trong thiết kế); kết quả thô → detection px camera.
describe('normalizeHandedness', () => {
  it('nhãn Left/Right (không phân biệt hoa thường) giữ nguyên với frame thô; nhãn lạ trả null', () => {
    expect(DEFAULTS.hands.handednessSwap).toBe(false)
    expect(normalizeHandedness('Left')).toBe('left')
    expect(normalizeHandedness('right')).toBe('right')
    expect(normalizeHandedness(' RIGHT ')).toBe('right')
    expect(normalizeHandedness('Unknown')).toBeNull()
    expect(normalizeHandedness('')).toBeNull()
  })

  it('swap đảo; inputMirrored đảo; cả hai thì giữ nguyên', () => {
    expect(normalizeHandedness('Left', { swap: true })).toBe('right')
    expect(normalizeHandedness('Right', { swap: true })).toBe('left')
    expect(normalizeHandedness('Left', { inputMirrored: true })).toBe('right')
    expect(normalizeHandedness('Left', { inputMirrored: true, swap: true })).toBe('left')
    expect(normalizeHandedness('Left', { swap: false })).toBe('left')
  })
})

function result(hands: HandResult['hands']): HandResult {
  return { frameId: 7, ts: 1000, epoch: 3, inferMs: 40, width: 1280, height: 720, hands }
}

/** 21 landmark: điểm i tại (0.5 + 0.01 i, 0.5 − 0.005 i). */
const NORM = Array.from(
  { length: 21 },
  (_, i) => [0.5 + 0.01 * i, 0.5 - 0.005 * i, 0] as [number, number, number],
)

describe('resultToDetections', () => {
  it('landmark chuẩn hóa nhân kích thước bitmap; tâm lòng bàn tay là trung bình 0, 5, 9, 13, 17; bbox bao 21 điểm', () => {
    const [d] = resultToDetections(result([{ label: 'Right', score: 0.93, landmarksNorm: NORM }]))
    expect(d.handedness).toBe('right')
    expect(d.score).toBe(0.93)
    expect(d.landmarksCam).toHaveLength(21)
    expect(d.landmarksCam[0]).toEqual({ x: 640, y: 360 })
    expect(d.landmarksCam[20].x).toBeCloseTo(640 + 20 * 12.8)
    expect(d.landmarksCam[20].y).toBeCloseTo(360 - 20 * 3.6)
    const mean = PALM_INDEX.reduce((s, i) => s + i, 0) / PALM_INDEX.length
    expect(d.palmCenterCam.x).toBeCloseTo(640 + mean * 12.8)
    expect(d.palmCenterCam.y).toBeCloseTo(360 - mean * 3.6)
    expect(d.bboxCam.x).toBeCloseTo(640)
    expect(d.bboxCam.w).toBeCloseTo(20 * 12.8)
    expect(d.bboxCam.y).toBeCloseTo(360 - 20 * 3.6)
    expect(d.bboxCam.h).toBeCloseTo(20 * 3.6)
    expect(FINGER_TIPS).toEqual([4, 8, 12, 16, 20])
  })

  it('swap áp cho mọi tay; nhãn lạ hoặc không có landmark thì bỏ', () => {
    const out = resultToDetections(
      result([
        { label: 'Left', score: 0.9, landmarksNorm: NORM },
        { label: 'Right', score: 0.8, landmarksNorm: NORM },
        { label: '?', score: 0.5, landmarksNorm: NORM },
        { label: 'Left', score: 0.9, landmarksNorm: [] },
      ]),
      { swap: true },
    )
    expect(out.map((d) => d.handedness)).toEqual(['right', 'left'])
  })

  it('palmCenter với mảng thiếu điểm dùng các điểm có; rỗng trả (0, 0)', () => {
    expect(palmCenter([])).toEqual({ x: 0, y: 0 })
    expect(palmCenter([{ x: 10, y: 20 }])).toEqual({ x: 10, y: 20 })
  })
})
