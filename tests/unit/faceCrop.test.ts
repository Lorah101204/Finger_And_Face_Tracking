import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { faceCropRect, faceInCrop, pickTargetFace } from '../../src/classify/faceCrop'
import { DEFAULTS } from '../../src/core/config'
import type { Rect, ValidatedFace } from '../../src/core/types'

// CLS-05 (D-070, mục 7.42): crop vuông quanh bbox mặt cho classifier, luôn là rect nguyên nằm trong cameraRect của mask.
// Các ca ở fixtures/face-crop-cases.json dùng chung với tools/train/test_face_crop.py (face_crop_box của dataset.py),
// để mẫu huấn luyện được cắt đúng như app cắt lúc chạy.
const FACE_CROP_CASES = (
  JSON.parse(readFileSync(new URL('./fixtures/face-crop-cases.json', import.meta.url), 'utf8')) as {
    cases: { name: string; face: Rect; bounds: Rect; scale: number; want: Rect }[]
  }
).cases

const face = (bboxCam: Rect, status: 'full' | 'partial' = 'full'): ValidatedFace => ({
  status,
  bboxCam,
  bboxStage: bboxCam,
  landmarksStage: [],
  visible: 1,
  subjectType: 'unknown',
})

describe('faceCropRect', () => {
  it('scale mặc định 1,6; các ca chung với Python cho đúng rect', () => {
    expect(DEFAULTS.classifier.faceCropScale).toBe(1.6)
    expect(FACE_CROP_CASES.length).toBeGreaterThanOrEqual(5)
    for (const c of FACE_CROP_CASES)
      expect(faceCropRect(c.face, c.bounds, c.scale), c.name).toEqual(c.want)
  })

  it('luôn nguyên và nằm trong bounds với mọi vị trí mặt (quét lưới)', () => {
    const bounds = { x: 120, y: 60, w: 333, h: 271 }
    for (let x = -100; x < 600; x += 37)
      for (let y = -100; y < 500; y += 41)
        for (const s of [20, 90, 250, 500]) {
          const r = faceCropRect({ x, y, w: s, h: s * 1.2 }, bounds, 1.6)!
          expect(Number.isInteger(r.x) && Number.isInteger(r.y)).toBe(true)
          expect(Number.isInteger(r.w) && Number.isInteger(r.h)).toBe(true)
          expect(r.x).toBeGreaterThanOrEqual(bounds.x)
          expect(r.y).toBeGreaterThanOrEqual(bounds.y)
          expect(r.x + r.w).toBeLessThanOrEqual(bounds.x + bounds.w)
          expect(r.y + r.h).toBeLessThanOrEqual(bounds.y + bounds.h)
          expect(r.w).toBeGreaterThan(0)
          expect(r.h).toBeGreaterThan(0)
        }
  })

  it('bbox hay bounds rỗng → null', () => {
    expect(
      faceCropRect({ x: 0, y: 0, w: 0, h: 10 }, { x: 0, y: 0, w: 100, h: 100 }, 1.6),
    ).toBeNull()
    expect(faceCropRect({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 0, h: 100 }, 1.6)).toBeNull()
  })
})

describe('pickTargetFace và faceInCrop', () => {
  it('ưu tiên mặt full, rồi diện tích lớn nhất; rỗng → null', () => {
    expect(pickTargetFace([])).toBeNull()
    const small = face({ x: 0, y: 0, w: 50, h: 50 })
    const big = face({ x: 100, y: 0, w: 120, h: 120 })
    const hugePartial = face({ x: 300, y: 0, w: 400, h: 400 }, 'partial')
    expect(pickTargetFace([small, big])).toBe(big)
    expect(pickTargetFace([hugePartial, small])).toBe(small)
    expect(pickTargetFace([hugePartial])).toBe(hugePartial)
  })

  it('mặt thuộc crop khi tâm bbox nằm trong crop', () => {
    const crop = { x: 100, y: 100, w: 200, h: 200 }
    expect(faceInCrop({ x: 150, y: 150, w: 100, h: 100 }, crop)).toBe(true)
    expect(faceInCrop({ x: 260, y: 260, w: 100, h: 100 }, crop)).toBe(false)
    expect(faceInCrop({ x: 0, y: 0, w: 50, h: 50 }, crop)).toBe(false)
  })
})
