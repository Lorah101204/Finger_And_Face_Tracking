import { describe, expect, it } from 'vitest'
import { cellAt, listCells } from '../../src/core/cells'
import {
  boxToCameraRect,
  boxToStageRect,
  computeLayout,
  windowToCameraRect,
  windowToStageRect,
} from '../../src/core/coords'
import { buildMask, polygonShape, windowShape } from '../../src/mask/buildMask'

// ROI-00, ROI-02 (D-038): mask là tập ô. Chuột: hộp n × n đầy, không lỗ. Tay: tứ giác rasterize thành ô, lỗ là ô
// trong hộp bao không mở với rect camera nguyên; hysteresis theo ô so với mask trước.
const L = computeLayout({ w: 1280, h: 720 }, { cols: 32, rows: 32 }, { w: 1280, h: 720 })
const win = { col: 3, row: 4, n: 5 }

describe('buildMask (cửa sổ chuột)', () => {
  it('stageRect và cameraRect lấy từ coords.ts, mang epoch và limited, sao chép cửa sổ; hộp đầy không lỗ', () => {
    const m = buildMask(windowShape(win), L, true, 7, { limited: true })
    expect(m.epoch).toBe(7)
    expect(m.limited).toBe(true)
    expect(m.shape).toEqual({ kind: 'window', window: win })
    expect(m.box).toEqual({ col: 3, row: 4, w: 5, h: 5 })
    expect(m.cellCount).toBe(25)
    expect(Array.from(m.cells)).toEqual(Array(25).fill(1))
    expect(m.holesCam).toEqual([])
    expect(m.stageRect).toEqual(windowToStageRect(win, L))
    expect(m.cameraRect).toEqual(windowToCameraRect(win, L, true))
    expect(buildMask(windowShape(win), L, false, 1).cameraRect).toEqual(
      windowToCameraRect(win, L, false),
    )
    expect(buildMask(windowShape(win), L, false, 1).limited).toBe(false)
  })

  it('cameraRect nguyên và nằm trong camera', () => {
    const m = buildMask(windowShape({ col: 27, row: 27, n: 5 }), L, true, 1)
    const r = m.cameraRect
    expect([r.x, r.y, r.w, r.h].every(Number.isInteger)).toBe(true)
    expect(r.x + r.w).toBeLessThanOrEqual(1280)
    expect(r.y + r.h).toBeLessThanOrEqual(720)
  })
})

// Lưới 32 × 32 trên 1280 × 720: c = 22, bảng 704 × 704 tại (288, 8).
describe('buildMask (tứ giác)', () => {
  const { board, c } = L
  const px = (col: number, row: number) => ({ x: board.x + col * c, y: board.y + row * c })

  it('hình chữ nhật trùng ô: hộp đầy, không lỗ, hình sắp theo góc quanh tâm', () => {
    // Đỉnh tại các góc ô (2,3) tới (6,7): các ô 2..5 × 3..6 bị phủ trọn, ô 6 và hàng 7 chỉ chạm cạnh (không mở).
    const m = buildMask(polygonShape([px(6, 3), px(2, 3), px(2, 7), px(6, 7)]), L, false, 1)
    expect(m.shape.kind).toBe('polygon')
    expect(m.box).toEqual({ col: 2, row: 3, w: 4, h: 4 })
    expect(m.cellCount).toBe(16)
    expect(m.holesCam).toEqual([])
    expect(m.stageRect).toEqual(boxToStageRect(m.box, L))
    expect(m.cameraRect).toEqual(boxToCameraRect(m.box, L, false))
  })

  it('tam giác lệch: ô bị cạnh cắt qua vẫn mở, ô ngoài trong hộp bao là lỗ với rect camera nguyên', () => {
    // Tứ giác gần tam giác: (2,2) (8,2) (8,8) và điểm thứ tư sát (8,8): nửa dưới-trái của hộp là lỗ.
    const m = buildMask(
      polygonShape([
        { x: px(2, 2).x + 1, y: px(2, 2).y + 1 },
        { x: px(8, 2).x - 1, y: px(8, 2).y + 1 },
        { x: px(8, 8).x - 1, y: px(8, 8).y - 1 },
        { x: px(8, 8).x - 2, y: px(8, 8).y - 1 },
      ]),
      L,
      false,
      1,
    )
    expect(m.box).toEqual({ col: 2, row: 2, w: 6, h: 6 })
    expect(cellAt(m, 2, 2)).toBe(true) // đỉnh trong ô
    expect(cellAt(m, 7, 7)).toBe(true)
    expect(cellAt(m, 4, 4)).toBe(true) // cạnh chéo cắt qua
    expect(cellAt(m, 2, 7)).toBe(false) // góc dưới trái ngoài tam giác
    expect(cellAt(m, 3, 6)).toBe(false)
    expect(m.cellCount).toBeGreaterThan(15)
    expect(m.cellCount).toBeLessThan(36)
    expect(m.holesCam).toHaveLength(36 - m.cellCount)
    for (const h of m.holesCam) {
      expect([h.x, h.y, h.w, h.h].every(Number.isInteger)).toBe(true)
      // rect camera của một ô: c / scale px camera, làm tròn từng cạnh
      expect(Math.abs(h.w - c / L.scale)).toBeLessThanOrEqual(1)
    }
    // Lỗ của ô (2, 7) là rect camera của đúng ô đó.
    expect(m.holesCam).toContainEqual(boxToCameraRect({ col: 2, row: 7, w: 1, h: 1 }, L, false))
    // Mirror: lỗ đổi phía trong camera.
    const mm = buildMask(m.shape, L, true, 1)
    expect(mm.holesCam).toContainEqual(boxToCameraRect({ col: 2, row: 7, w: 1, h: 1 }, L, true))
    expect(listCells(mm)).toEqual(listCells(m))
  })

  it('hysteresis theo ô: ô đang mở chỉ tắt khi tứ giác rời xa hơn h ô; ô mới chỉ bật khi lấn sâu hơn h ô', () => {
    const rect = (x1: number) =>
      polygonShape([px(2, 2), { x: x1, y: px(2, 2).y }, { x: x1, y: px(2, 6).y }, px(2, 6)])
    // Mép phải tại giữa ô 6 (x = 6,5 ô): ô 6 mở (lấn 0,5 > 0,25).
    const m1 = buildMask(rect(board.x + 6.5 * c), L, false, 1, { hysteresisCells: 0.25 })
    expect(m1.box.col + m1.box.w - 1).toBe(6)
    // Rút về 6,1 ô: ô 6 vẫn mở (còn chạm ô nới rộng 0,25); không hysteresis thì cũng còn (lấn 0,1 > 0).
    const m2 = buildMask(rect(board.x + 6.1 * c), L, false, 1, { prev: m1, hysteresisCells: 0.25 })
    expect(cellAt(m2, 6, 3)).toBe(true)
    // Rút về 5,8 ô: còn chạm ô 6 nới rộng (5,75) → vẫn mở; 5,7 → tắt.
    const m3 = buildMask(rect(board.x + 5.8 * c), L, false, 1, { prev: m2, hysteresisCells: 0.25 })
    expect(cellAt(m3, 6, 3)).toBe(true)
    const m4 = buildMask(rect(board.x + 5.7 * c), L, false, 1, { prev: m3, hysteresisCells: 0.25 })
    expect(cellAt(m4, 6, 3)).toBe(false)
    // Từ đóng (không prev): mép tại 6,2 ô chưa lấn quá 0,25 → ô 6 chưa bật; 6,3 → bật.
    expect(
      cellAt(buildMask(rect(board.x + 6.2 * c), L, false, 1, { hysteresisCells: 0.25 }), 6, 3),
    ).toBe(false)
    expect(
      cellAt(buildMask(rect(board.x + 6.3 * c), L, false, 1, { hysteresisCells: 0.25 }), 6, 3),
    ).toBe(true)
    // prev là cửa sổ chuột thì bỏ qua (không phải tứ giác).
    const mouse = buildMask(windowShape({ col: 0, row: 0, n: 10 }), L, false, 1)
    expect(
      cellAt(
        buildMask(rect(board.x + 6.2 * c), L, false, 1, { prev: mouse, hysteresisCells: 0.25 }),
        6,
        3,
      ),
    ).toBe(false)
  })
})
