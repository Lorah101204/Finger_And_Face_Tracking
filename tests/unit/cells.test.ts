import { describe, expect, it } from 'vitest'
import {
  boxCells,
  cellAt,
  cellOutlineEdges,
  cellRangeOfStageRect,
  isFullBox,
  listCells,
  orderPolygon,
  pointInPolygon,
  polygonArea,
  polygonOverlapsRect,
  rasterizePolygon,
  segmentCrossesOpenRect,
  stagePointInCells,
  stageRectInsideCells,
  stageRectTouchesCells,
} from '../../src/core/cells'

// ROI-02 (D-038, mục 7.17): toán tứ giác → tập ô. Lưới 10 × 10 ô 20 px, bảng tại (0, 0).
const G = { cols: 10, rows: 10, c: 20, board: { x: 0, y: 0, w: 200, h: 200 } }

describe('đa giác', () => {
  it('orderPolygon sắp theo góc quanh tâm: bốn đỉnh đưa vào lộn xộn thành hình chữ nhật không tự cắt', () => {
    const q = orderPolygon([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ])
    expect(polygonArea(q)).toBe(100)
    // Đa giác tự cắt (hình nơ) có diện tích shoelace 0.
    expect(
      polygonArea([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
      ]),
    ).toBe(0)
  })

  it('pointInPolygon và segmentCrossesOpenRect', () => {
    const tri = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 0, y: 20 },
    ]
    expect(pointInPolygon({ x: 5, y: 5 }, tri)).toBe(true)
    expect(pointInPolygon({ x: 15, y: 15 }, tri)).toBe(false)
    const r = { x: 10, y: 10, w: 10, h: 10 }
    expect(segmentCrossesOpenRect({ x: 0, y: 15 }, { x: 30, y: 15 }, r)).toBe(true)
    expect(segmentCrossesOpenRect({ x: 0, y: 10 }, { x: 30, y: 10 }, r)).toBe(false) // dọc cạnh
    expect(segmentCrossesOpenRect({ x: 0, y: 0 }, { x: 5, y: 5 }, r)).toBe(false)
    expect(segmentCrossesOpenRect({ x: 12, y: 12 }, { x: 18, y: 18 }, r)).toBe(true) // nằm trọn trong
  })

  it('polygonOverlapsRect: đỉnh trong ô, góc ô trong đa giác, cạnh cắt qua; chạm cạnh không tính', () => {
    const tri = [
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 0, y: 60 },
    ]
    expect(polygonOverlapsRect(tri, { x: 20, y: 20, w: 20, h: 20 })).toBe(true) // cạnh chéo cắt
    expect(polygonOverlapsRect(tri, { x: 40, y: 40, w: 20, h: 20 })).toBe(false) // ngoài, chạm đỉnh (40,20)? không
    expect(polygonOverlapsRect(tri, { x: 0, y: 0, w: 20, h: 20 })).toBe(true) // ô trong đa giác
    expect(polygonOverlapsRect(tri, { x: 60, y: 0, w: 20, h: 20 })).toBe(false) // chỉ chạm đỉnh
    expect(polygonOverlapsRect(tri, { x: -20, y: 0, w: 20, h: 60 })).toBe(false) // chung cạnh
    const big = [
      { x: -100, y: -100 },
      { x: 300, y: -100 },
      { x: 300, y: 300 },
      { x: -100, y: 300 },
    ]
    expect(polygonOverlapsRect(big, { x: 0, y: 0, w: 20, h: 20 })).toBe(true) // ô trong đa giác lớn
  })
})

describe('rasterizePolygon', () => {
  it('hình chữ nhật trùng lưới mở đúng các ô phủ; ô chỉ chạm cạnh không mở', () => {
    const set = rasterizePolygon(
      [
        { x: 20, y: 20 },
        { x: 80, y: 20 },
        { x: 80, y: 60 },
        { x: 20, y: 60 },
      ],
      G,
    )
    expect(set.box).toEqual({ col: 1, row: 1, w: 3, h: 2 })
    expect(set.cellCount).toBe(6)
    expect(isFullBox(set)).toBe(true)
    expect(listCells(set)).toHaveLength(6)
  })

  it('tứ giác lệch: ô bị cạnh cắt qua mở, ô ngoài tắt; rỗng khi không có ô nào', () => {
    const set = rasterizePolygon(
      [
        { x: 10, y: 10 },
        { x: 110, y: 10 },
        { x: 110, y: 110 },
        { x: 105, y: 110 },
      ],
      G,
    )
    expect(set.box).toEqual({ col: 0, row: 0, w: 6, h: 6 })
    expect(cellAt(set, 0, 0)).toBe(true)
    expect(cellAt(set, 5, 5)).toBe(true)
    expect(cellAt(set, 0, 5)).toBe(false)
    expect(cellAt(set, 2, 2)).toBe(true) // đường chéo (10,10)-(105,110) cắt qua
    expect(isFullBox(set)).toBe(false)
    expect(rasterizePolygon([{ x: 1, y: 1 }], G).cellCount).toBe(0)
    expect(
      rasterizePolygon(
        [
          { x: 1, y: 1 },
          { x: 2, y: 2 },
          { x: 3, y: 3 },
        ],
        { ...G, c: 0 },
      ).cellCount,
    ).toBe(0)
  })

  it('hysteresis: ô đang mở giữ khi còn chạm ô nới rộng h; ô tắt chỉ bật khi lấn sâu hơn h; kẹp trong lưới', () => {
    const rect = (x1: number) => [
      { x: 20, y: 20 },
      { x: x1, y: 20 },
      { x: x1, y: 60 },
      { x: 20, y: 60 },
    ]
    const a = rasterizePolygon(rect(84), G, { hysteresisCells: 0.25 }) // lấn ô 4 đúng 4 px = 0,2 ô: chưa bật
    expect(cellAt(a, 4, 1)).toBe(false)
    const b = rasterizePolygon(rect(86), G, { prev: a, hysteresisCells: 0.25 }) // 0,3 ô: bật
    expect(cellAt(b, 4, 1)).toBe(true)
    const c = rasterizePolygon(rect(76), G, { prev: b, hysteresisCells: 0.25 }) // rút về 3,8 ô: ô 4 nới tới 75 → giữ
    expect(cellAt(c, 4, 1)).toBe(true)
    const d = rasterizePolygon(rect(74), G, { prev: c, hysteresisCells: 0.25 }) // 3,7 → tắt
    expect(cellAt(d, 4, 1)).toBe(false)
    // Đa giác tràn ngoài lưới: chỉ ô trong lưới.
    const big = rasterizePolygon(
      [
        { x: -50, y: -50 },
        { x: 250, y: -50 },
        { x: 250, y: 250 },
        { x: -50, y: 250 },
      ],
      G,
    )
    expect(big.box).toEqual({ col: 0, row: 0, w: 10, h: 10 })
    expect(big.cellCount).toBe(100)
  })
})

describe('tra cứu theo ô', () => {
  const set = boxCells({ col: 2, row: 2, w: 3, h: 3 }) // px 40..100
  it('cellRangeOfStageRect, stageRectInsideCells, stageRectTouchesCells, stagePointInCells', () => {
    expect(cellRangeOfStageRect({ x: 45, y: 45, w: 10, h: 10 }, G)).toEqual({
      c0: 2,
      c1: 2,
      r0: 2,
      r1: 2,
    })
    expect(cellRangeOfStageRect({ x: 40, y: 40, w: 60, h: 60 }, G)).toEqual({
      c0: 2,
      c1: 4,
      r0: 2,
      r1: 4,
    })
    expect(cellRangeOfStageRect({ x: 40, y: 40, w: 0, h: 60 }, G)).toBeNull()
    expect(stageRectInsideCells({ x: 40, y: 40, w: 60, h: 60 }, set, G)).toBe(true)
    expect(stageRectInsideCells({ x: 39, y: 40, w: 60, h: 60 }, set, G)).toBe(false)
    expect(stageRectTouchesCells({ x: 0, y: 0, w: 41, h: 41 }, set, G)).toBe(true)
    expect(stageRectTouchesCells({ x: 0, y: 0, w: 40, h: 40 }, set, G)).toBe(false) // chạm góc
    expect(stagePointInCells({ x: 40, y: 40 }, set, G)).toBe(true)
    expect(stagePointInCells({ x: 100, y: 40 }, set, G)).toBe(false)
    expect(stagePointInCells({ x: 99.9, y: 99.9 }, set, G)).toBe(true)
  })

  it('cellOutlineEdges: hộp 3 × 3 có 12 cạnh biên với phía đúng; hình chữ L có góc lõm', () => {
    const edges = cellOutlineEdges(set, G)
    expect(edges).toHaveLength(12)
    expect(edges.filter((e) => e.side === 'left').map((e) => e.x0)).toEqual([40, 40, 40])
    expect(edges.filter((e) => e.side === 'bottom').map((e) => e.y0)).toEqual([100, 100, 100])
    const lShape = rasterizePolygon(
      [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 40, y: 20 },
        { x: 20, y: 20 },
        { x: 20, y: 40 },
        { x: 0, y: 40 },
      ],
      G,
    )
    expect(lShape.cellCount).toBe(3)
    expect(cellOutlineEdges(lShape, G)).toHaveLength(8)
  })
})
