import { describe, expect, it } from 'vitest'
import {
  camToLetterbox,
  computeLetterbox,
  cropToLetterbox,
  letterboxNormToCam,
  letterboxToCrop,
} from '../../src/core/letterbox'

// MASK-02: toán letterbox thuần (mục 7.10). Cạnh dài chạm đúng size; dx, dy nguyên; ánh xạ khứ hồi chính xác.
describe('computeLetterbox', () => {
  it('crop vuông: scale = size / cạnh, không đệm', () => {
    expect(computeLetterbox(100, 100, 256)).toEqual({ scale: 2.56, dx: 0, dy: 0, size: 256 })
  })

  it('crop ngang: cạnh dài chạm 256, đệm trên dưới, dy làm tròn xuống', () => {
    const lb = computeLetterbox(400, 300, 256)
    expect(lb.scale).toBe(0.64)
    expect(lb.dx).toBe(0)
    expect(lb.dy).toBe(32)
    expect(400 * lb.scale).toBe(256)
  })

  it('crop dọc: đệm trái phải', () => {
    const lb = computeLetterbox(65, 130, 256)
    expect(lb.dy).toBe(0)
    expect(lb.dx).toBe(Math.floor((256 - 65 * lb.scale) / 2))
    expect(130 * lb.scale).toBeCloseTo(256, 12)
  })
})

describe('ánh xạ letterbox, crop, camera', () => {
  const roi = { x: 300, y: 120, w: 401, h: 399 }
  const lb = computeLetterbox(roi.w, roi.h, 256)

  it('góc dưới phải của crop qua letterbox rồi ngược lại về đúng góc dưới phải cameraRect', () => {
    const corner = cropToLetterbox({ x: roi.w, y: roi.h }, lb)
    expect(Math.max(corner.x - lb.dx, corner.y - lb.dy)).toBeCloseTo(256, 9)
    const back = letterboxToCrop(corner, lb)
    expect(back.x).toBeCloseTo(roi.w, 9)
    expect(back.y).toBeCloseTo(roi.h, 9)
    const cam = letterboxNormToCam({ x: corner.x / lb.size, y: corner.y / lb.size }, lb, roi)
    expect(cam.x).toBeCloseTo(roi.x + roi.w, 9)
    expect(cam.y).toBeCloseTo(roi.y + roi.h, 9)
  })

  it('camToLetterbox là nghịch đảo của letterboxNormToCam', () => {
    const p = { x: 333, y: 222 }
    const l = camToLetterbox(p, lb, roi)
    const q = letterboxNormToCam({ x: l.x / lb.size, y: l.y / lb.size }, lb, roi)
    expect(q.x).toBeCloseTo(p.x, 9)
    expect(q.y).toBeCloseTo(p.y, 9)
  })

  it('điểm chuẩn hóa (0, 0) nằm trong phần đệm khi crop ngang: y crop âm', () => {
    const wide = computeLetterbox(400, 200, 256)
    const top = letterboxToCrop({ x: 0, y: 0 }, wide)
    expect(top.x).toBe(0)
    expect(top.y).toBeLessThan(0)
  })
})
