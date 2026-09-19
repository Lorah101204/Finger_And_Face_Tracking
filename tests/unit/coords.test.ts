import { describe, expect, it } from 'vitest'
import {
  cameraToStage,
  computeLayout,
  pointInBoard,
  stageToCamera,
  stageToCell,
  windowAtCenter,
  windowToCameraRect,
  windowToStageRect,
  type Layout,
} from '../../src/core/coords'
import type { Point, Rect, Size } from '../../src/core/types'

// GRID-01: mục 4.1 và tiêu chí hoàn thành của gói.
const CAM: Size = { w: 1280, h: 720 }
const isInt = (r: Rect) => [r.x, r.y, r.w, r.h].every(Number.isInteger)
const inside = (r: Rect, s: Size) => r.x >= 0 && r.y >= 0 && r.x + r.w <= s.w && r.y + r.h <= s.h

describe('computeLayout', () => {
  it('64 × 36 trên stage 1280 × 720 cho c = 20, bảng phủ kín stage, camera 1:1', () => {
    const L = computeLayout({ w: 1280, h: 720 }, { cols: 64, rows: 36 }, CAM)
    expect(L.c).toBe(20)
    expect(L.board).toEqual({ x: 0, y: 0, w: 1280, h: 720 })
    expect(L.scale).toBe(1)
    expect(L.camVisibleRect).toEqual({ x: 0, y: 0, w: 1280, h: 720 })
  })

  it('32 × 32 trên 1280 × 720: bảng vuông căn giữa, camera cover cắt hai bên', () => {
    const L = computeLayout({ w: 1280, h: 720 }, { cols: 32, rows: 32 }, CAM)
    expect(L.c).toBe(22)
    expect(L.board).toEqual({ x: 288, y: 8, w: 704, h: 704 })
    expect(L.scale).toBeCloseTo(704 / 720, 10)
    expect(L.camVisibleRect.x).toBeCloseTo(280, 10)
    expect(L.camVisibleRect.y).toBeCloseTo(0, 10)
    expect(L.camVisibleRect.w).toBeCloseTo(720, 10)
    expect(L.camVisibleRect.h).toBeCloseTo(720, 10)
  })

  it('stage cao hơn tỷ lệ lưới: bảng căn giữa theo chiều dọc, camera cover cắt trên dưới khi camera cao hơn bảng', () => {
    const L = computeLayout({ w: 1000, h: 1000 }, { cols: 64, rows: 36 }, CAM)
    expect(L.c).toBe(15)
    expect(L.board).toEqual({ x: 20, y: 230, w: 960, h: 540 })
    // bảng 16:9 và camera 16:9: cover là 1:1 theo tỷ lệ, không cắt
    expect(L.camVisibleRect.w).toBeCloseTo(1280, 10)
    expect(L.camVisibleRect.h).toBeCloseTo(720, 10)
    const L2 = computeLayout({ w: 1000, h: 1000 }, { cols: 64, rows: 36 }, { w: 640, h: 640 })
    expect(L2.camVisibleRect.w).toBeCloseTo(640, 10)
    expect(L2.camVisibleRect.h).toBeCloseTo(360, 10)
    expect(L2.camVisibleRect.y).toBeCloseTo(140, 10)
  })

  it('nhiều kích thước: c nguyên, bảng nằm trong stage và căn giữa lệch tối đa 1 px', () => {
    const stages = [
      { w: 1280, h: 720 },
      { w: 1920, h: 1080 },
      { w: 800, h: 600 },
      { w: 375, h: 812 },
      { w: 2560, h: 1440 },
    ]
    const grids = [
      { cols: 32, rows: 18 },
      { cols: 64, rows: 36 },
      { cols: 128, rows: 72 },
      { cols: 4, rows: 4 },
      { cols: 256, rows: 144 },
      { cols: 10, rows: 7 },
    ]
    for (const s of stages)
      for (const g of grids) {
        const L = computeLayout(s, g, CAM)
        expect(Number.isInteger(L.c)).toBe(true)
        expect(L.c).toBe(Math.floor(Math.min(s.w / g.cols, s.h / g.rows)))
        expect(isInt(L.board)).toBe(true)
        expect(inside(L.board, s)).toBe(true)
        expect(Math.abs(s.w - L.board.w - 2 * L.board.x)).toBeLessThanOrEqual(1)
        expect(Math.abs(s.h - L.board.h - 2 * L.board.y)).toBeLessThanOrEqual(1)
        expect(inside(L.camVisibleRect, CAM)).toBe(true)
      }
  })

  it('stage 0 × 0 cho layout rỗng không lỗi', () => {
    const L = computeLayout({ w: 0, h: 0 }, { cols: 64, rows: 36 }, CAM)
    expect(L.c).toBe(0)
    expect(L.scale).toBe(0)
    expect(L.board).toEqual({ x: 0, y: 0, w: 0, h: 0 })
  })
})

describe('cameraToStage và stageToCamera', () => {
  const layouts: Layout[] = [
    computeLayout({ w: 1280, h: 720 }, { cols: 64, rows: 36 }, CAM),
    computeLayout({ w: 1280, h: 720 }, { cols: 32, rows: 32 }, CAM),
    computeLayout({ w: 1000, h: 1000 }, { cols: 64, rows: 36 }, { w: 640, h: 640 }),
  ]
  const points: Point[] = [
    { x: 0, y: 0 },
    { x: 640, y: 360 },
    { x: 1279, y: 719 },
    { x: 300.5, y: 12.25 },
  ]

  it('cameraToStage(stageToCamera(p)) ≈ p và ngược lại, có và không mirror', () => {
    for (const L of layouts)
      for (const mirror of [false, true])
        for (const p of points) {
          const back = stageToCamera(cameraToStage(p, L, mirror), L, mirror)
          expect(back.x).toBeCloseTo(p.x, 9)
          expect(back.y).toBeCloseTo(p.y, 9)
          const pStage = { x: L.board.x + p.x / 2, y: L.board.y + p.y / 2 }
          const back2 = cameraToStage(stageToCamera(pStage, L, mirror), L, mirror)
          expect(back2.x).toBeCloseTo(pStage.x, 9)
          expect(back2.y).toBeCloseTo(pStage.y, 9)
        }
  })

  it('mirror đảo trái phải quanh tâm bảng, không đổi chiều dọc', () => {
    for (const L of layouts) {
      const left = { x: L.camVisibleRect.x, y: L.camVisibleRect.y }
      const noMirror = cameraToStage(left, L, false)
      const mirrored = cameraToStage(left, L, true)
      expect(noMirror.x).toBeCloseTo(L.board.x, 9)
      expect(mirrored.x).toBeCloseTo(L.board.x + L.board.w, 9)
      expect(noMirror.y).toBeCloseTo(L.board.y, 9)
      expect(mirrored.y).toBeCloseTo(L.board.y, 9)
    }
  })
})

describe('windowToStageRect', () => {
  const L = computeLayout({ w: 1280, h: 720 }, { cols: 32, rows: 32 }, CAM)

  it('các ô kề nhau chung cạnh: không chồng, không hở; rect nguyên', () => {
    const a = windowToStageRect({ col: 3, row: 4, n: 5 }, L)
    const right = windowToStageRect({ col: 8, row: 4, n: 5 }, L)
    const below = windowToStageRect({ col: 3, row: 9, n: 5 }, L)
    expect(isInt(a)).toBe(true)
    expect(a).toEqual({ x: L.board.x + 3 * 22, y: L.board.y + 4 * 22, w: 110, h: 110 })
    expect(right.x).toBe(a.x + a.w)
    expect(below.y).toBe(a.y + a.h)
  })

  it('cửa sổ phủ toàn bảng cho đúng board', () => {
    expect(windowToStageRect({ col: 0, row: 0, n: 32 }, L)).toEqual(L.board)
  })
})

describe('windowToCameraRect', () => {
  const L = computeLayout({ w: 1280, h: 720 }, { cols: 32, rows: 32 }, CAM)

  it('rect nguyên, nằm trong camera, kể cả cửa sổ sát mép, có và không mirror', () => {
    const wins = [
      { col: 0, row: 0, n: 3 },
      { col: 29, row: 29, n: 3 },
      { col: 0, row: 29, n: 3 },
      { col: 29, row: 0, n: 3 },
      { col: 0, row: 0, n: 32 },
      { col: 10, row: 12, n: 8 },
    ]
    for (const mirror of [false, true])
      for (const w of wins) {
        const r = windowToCameraRect(w, L, mirror)
        expect(isInt(r)).toBe(true)
        expect(inside(r, CAM)).toBe(true)
        expect(r.w).toBeGreaterThan(0)
        expect(r.h).toBeGreaterThan(0)
      }
  })

  it('không mirror: cửa sổ góc trên trái bảng là phần camera bắt đầu từ camVisibleRect; mirror: từ mép phải', () => {
    const w = { col: 0, row: 0, n: 32 }
    expect(windowToCameraRect(w, L, false)).toEqual({ x: 280, y: 0, w: 720, h: 720 })
    expect(windowToCameraRect(w, L, true)).toEqual({ x: 280, y: 0, w: 720, h: 720 })
    const tl = windowToCameraRect({ col: 0, row: 0, n: 4 }, L, false)
    const tlMirror = windowToCameraRect({ col: 0, row: 0, n: 4 }, L, true)
    expect(tl.x).toBe(280)
    expect(tlMirror.x + tlMirror.w).toBe(1000)
    expect(tl.y).toBe(0)
    expect(tlMirror.y).toBe(0)
  })

  it('cửa sổ kề nhau chung cạnh trong không gian camera', () => {
    const a = windowToCameraRect({ col: 3, row: 4, n: 5 }, L, false)
    const b = windowToCameraRect({ col: 8, row: 4, n: 5 }, L, false)
    expect(b.x).toBe(a.x + a.w)
    const am = windowToCameraRect({ col: 3, row: 4, n: 5 }, L, true)
    const bm = windowToCameraRect({ col: 8, row: 4, n: 5 }, L, true)
    expect(am.x).toBe(bm.x + bm.w)
  })
})

describe('windowAtCenter (ROI-00)', () => {
  const L = computeLayout({ w: 1280, h: 720 }, { cols: 32, rows: 32 }, CAM)

  it('cửa sổ n ô có tâm gần điểm nhất; tâm bảng cho cửa sổ căn giữa', () => {
    const center = { x: L.board.x + L.board.w / 2, y: L.board.y + L.board.h / 2 }
    expect(windowAtCenter(center, 8, L)).toEqual({ col: 12, row: 12, n: 8 })
    expect(windowAtCenter({ x: L.board.x, y: L.board.y }, 8, L)).toEqual({ col: -4, row: -4, n: 8 })
    const r = windowToStageRect(windowAtCenter(center, 6, L), L)
    expect(Math.abs(r.x + r.w / 2 - center.x)).toBeLessThanOrEqual(L.c / 2)
  })
})

describe('stageToCell và pointInBoard', () => {
  const L = computeLayout({ w: 1280, h: 720 }, { cols: 64, rows: 36 }, CAM)

  it('tọa độ ô số thực', () => {
    expect(stageToCell({ x: 0, y: 0 }, L)).toEqual({ colF: 0, rowF: 0 })
    expect(stageToCell({ x: 30, y: 45 }, L)).toEqual({ colF: 1.5, rowF: 2.25 })
  })

  it('điểm trong bảng, biên phải và dưới không tính', () => {
    expect(pointInBoard({ x: 0, y: 0 }, L)).toBe(true)
    expect(pointInBoard({ x: 1279, y: 719 }, L)).toBe(true)
    expect(pointInBoard({ x: 1280, y: 0 }, L)).toBe(false)
    expect(pointInBoard({ x: -1, y: 0 }, L)).toBe(false)
  })
})
