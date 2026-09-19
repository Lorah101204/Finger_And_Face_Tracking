import { describe, expect, it } from 'vitest'
import { listCells } from '../../src/core/cells'
import { sceneFingertips, sceneFrame, sceneGrid, sceneWindow } from '../../src/app/landingScene'

// UX-03 (mục 7.28): hình học minh họa động của màn hình bắt đầu dùng đúng toán của app (bao lồi, rasterize tập ô,
// quy tắc mặt full/partial); mọi điểm và ô nằm trong bảng ở mọi thời điểm, cửa sổ kiosk kẹp trong bảng.
describe('landingScene', () => {
  it('lưới căn giữa với ô vuông theo công thức GRID-01', () => {
    const g = sceneGrid(560, 315, 32, 18)
    expect(g.c).toBe(17)
    expect(g.board).toEqual({ x: 8, y: 4, w: 544, h: 306 })
    expect(sceneGrid(1280, 720, 64, 36)).toMatchObject({ c: 20, board: { x: 0, y: 0 } })
  })

  it('mười đầu ngón của hai tay nằm trong bảng ở mọi t; bao lồi có từ 3 đỉnh và tập ô không rỗng, mặt full', () => {
    const g = sceneGrid(560, 315, 32, 18)
    for (const t of [0, 0.7, 3.3, 12.9, 100]) {
      const tips = sceneFingertips(t, g)
      expect(tips).toHaveLength(10)
      expect(tips.filter((s) => s.hand === 'left')).toHaveLength(5)
      for (const s of tips) {
        expect(s.p.x).toBeGreaterThanOrEqual(g.board.x)
        expect(s.p.x).toBeLessThanOrEqual(g.board.x + g.board.w)
        expect(s.p.y).toBeGreaterThanOrEqual(g.board.y)
        expect(s.p.y).toBeLessThanOrEqual(g.board.y + g.board.h)
      }
      const f = sceneFrame(t, g, 'hands')
      expect(f.polygon!.length).toBeGreaterThanOrEqual(3)
      expect(f.box).toBeNull()
      expect(f.cells.cellCount).toBeGreaterThan(0)
      for (const c of listCells(f.cells)) {
        expect(c.col).toBeGreaterThanOrEqual(0)
        expect(c.col).toBeLessThan(g.cols)
        expect(c.row).toBeGreaterThanOrEqual(0)
        expect(c.row).toBeLessThan(g.rows)
      }
      expect(f.faceStatus).toBe('full')
    }
  })

  it('cửa sổ kiosk vuông, kẹp trong bảng, tập ô đúng cỡ; mặt full, partial hay none tùy vị trí', () => {
    const g = sceneGrid(1280, 720, 64, 36)
    const seen = new Set<string>()
    for (let t = 0; t < 40; t += 0.5) {
      const b = sceneWindow(t, g, 18, 0.74)
      expect(b.w).toBe(18)
      expect(b.h).toBe(18)
      expect(b.col).toBeGreaterThanOrEqual(0)
      expect(b.col + b.w).toBeLessThanOrEqual(g.cols)
      expect(b.row).toBeGreaterThanOrEqual(0)
      expect(b.row + b.h).toBeLessThanOrEqual(g.rows)
      const f = sceneFrame(t, g, 'window', 0.74)
      expect(f.box).toEqual(b)
      expect(f.cells.cellCount).toBe(324)
      expect(f.tips).toHaveLength(0)
      seen.add(f.faceStatus)
    }
    expect(seen.has('full')).toBe(true)
    expect(seen.has('partial') || seen.has('none')).toBe(true)
  })
})
