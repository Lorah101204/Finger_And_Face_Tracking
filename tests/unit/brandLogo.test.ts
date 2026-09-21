import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  coverage,
  LOGO_ASPECT,
  LOGO_CROP,
  LOGO_FRAMES,
  LOGO_FRAMES_SVG,
  LOGO_GREEN,
  LOGO_NAVY,
  LOGO_STROKE,
  logoCells,
  logoFramesIn,
  logoRect,
  unionRect,
  wordmarkSvg,
  type LogoPlacement,
} from '../../src/core/brandLogo'
import { cachedCells, cellAt, EMPTY_CELLS } from '../../src/core/cells'
import { DEFAULTS } from '../../src/core/config'
import { computeLayout } from '../../src/core/coords'
import type { Rect } from '../../src/core/types'

// BRAND-01 (mục 7.33, D-056): hình học logo thuần trong Node: hằng số khớp SVG bundle; rect theo bảng, không theo số
// ô; ô theo độ phủ ≥ ½ (bao hàm–loại trừ); lớp chữ dựng từ SVG gốc (bỏ khung, đổi màu, dòng chữ sống có textLength).
const SVG = readFileSync(new URL('../../src/assets/logo-verify-human.svg', import.meta.url), 'utf8')
const PLACE: LogoPlacement = {
  widthRatio: DEFAULTS.brand.logo.widthRatio,
  maxHeightRatio: DEFAULTS.brand.logo.maxHeightRatio,
  marginRatio: DEFAULTS.brand.logo.marginRatio,
  anchor: DEFAULTS.brand.logo.anchor,
}
const CAM = { w: 1280, h: 720 }
const STAGE = { w: 1280, h: 720 }

function layoutAt(cols: number, rows: number) {
  return computeLayout(STAGE, { cols, rows }, CAM)
}

describe('hằng số logo', () => {
  it('ba khung trong code đúng thuộc tính rect (fill:none) và stroke-width của SVG bundle', () => {
    const style = /<style>([\s\S]*?)<\/style>/.exec(SVG)![1]
    const frameClass = /\.([\w-]+)\{fill:none;stroke:#1f3566;[^}]*stroke-width:([\d.]+)px/.exec(
      style,
    )!
    expect(Number(frameClass[2])).toBe(LOGO_STROKE)
    const rects = [
      ...SVG.matchAll(
        new RegExp(
          `<rect class="${frameClass[1]}" x="([\\d.]+)" y="([\\d.]+)" width="([\\d.]+)" height="([\\d.]+)"/>`,
          'g',
        ),
      ),
    ].map((m) => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4] }))
    expect(rects).toEqual(LOGO_FRAMES_SVG)
    expect(SVG).toContain(`fill:${LOGO_NAVY}`)
    expect(SVG).toContain(`fill:${LOGO_GREEN}`)
  })

  it('LOGO_CROP là hộp bao mép ngoài của ba khung (551,15 × 209,45), tỉ lệ 2,63; khung chuẩn hóa phủ đúng [0, 1]²', () => {
    expect(LOGO_CROP.x).toBeCloseTo(73.76, 2)
    expect(LOGO_CROP.y).toBeCloseTo(90.91, 2)
    expect(LOGO_CROP.w).toBeCloseTo(551.15, 2)
    expect(LOGO_CROP.h).toBeCloseTo(209.45, 2)
    expect(LOGO_ASPECT).toBeCloseTo(2.631, 3)
    const u = unionRect(LOGO_FRAMES)
    expect(u.x).toBeCloseTo(0, 9)
    expect(u.y).toBeCloseTo(0, 9)
    expect(u.w).toBeCloseTo(1, 9)
    expect(u.h).toBeCloseTo(1, 9)
    expect(LOGO_FRAMES).toHaveLength(3)
    // "VERIFY:" trên phải, "Human" giữa trái, dòng chiến dịch dưới phải.
    expect(LOGO_FRAMES[0].x).toBeGreaterThan(0.25)
    expect(LOGO_FRAMES[1].x).toBe(0)
    expect(LOGO_FRAMES[2].y).toBeGreaterThan(0.7)
    expect(unionRect([])).toEqual({ x: 0, y: 0, w: 0, h: 0 })
  })
})

describe('logoRect: cỡ theo stage, kẹp vào bảng, không theo số ô', () => {
  const board: Rect = { x: 0, y: 0, w: 1280, h: 720 }

  it('30 % bề rộng stage, tỉ lệ logo, lề 2,5 %, neo trên trái; cùng rect cho mọi lưới 16:9 vì chỉ đọc stage', () => {
    const r = logoRect(STAGE, board, PLACE)!
    expect(r).toEqual({ x: 32, y: 32, w: 384, h: 146 })
    // Lưới 16:9 để bảng bằng stage; chỉ c đổi (40, 20, 10, 5 px).
    for (const cols of [32, 64, 128, 256]) {
      const L = layoutAt(cols, (cols * 9) / 16)
      expect(logoRect(L.stage, L.board, PLACE)).toEqual(r)
    }
  })

  it('bảng letterbox (stage 1000 × 600): cỡ và lề theo stage nên bằng nhau ở mọi preset, vị trí chỉ lệch theo mép bảng', () => {
    const stage = { w: 1000, h: 600 }
    const rects = [32, 64, 128].map((cols) => {
      const L = computeLayout(stage, { cols, rows: (cols * 9) / 16 }, CAM)
      expect(L.board.w).toBeLessThan(1000)
      return { L, r: logoRect(L.stage, L.board, PLACE)! }
    })
    for (const { L, r } of rects) {
      expect(r.w).toBe(300)
      expect(r.h).toBe(Math.round(300 / LOGO_ASPECT))
      // Lề 25 px theo stage, kẹp vào bảng (bảng thụt vào tới nửa ô).
      expect(r.x).toBe(Math.max(L.board.x, 25))
      expect(r.y).toBe(Math.max(L.board.y, 25))
      expect(r.x + r.w).toBeLessThanOrEqual(L.board.x + L.board.w)
      expect(r.y + r.h).toBeLessThanOrEqual(L.board.y + L.board.h)
    }
  })

  it('năm neo nằm trong bảng; lề tính từ mép stage; neo giữa theo stage', () => {
    const w = 384
    const h = 146
    expect(logoRect(STAGE, board, { ...PLACE, anchor: 'top-right' })).toEqual({
      x: 1280 - 32 - w,
      y: 32,
      w,
      h,
    })
    expect(logoRect(STAGE, board, { ...PLACE, anchor: 'bottom-left' })).toEqual({
      x: 32,
      y: 720 - 32 - h,
      w,
      h,
    })
    expect(logoRect(STAGE, board, { ...PLACE, anchor: 'bottom-right' })).toEqual({
      x: 1280 - 32 - w,
      y: 720 - 32 - h,
      w,
      h,
    })
    expect(logoRect(STAGE, board, { ...PLACE, anchor: 'center' })).toEqual({
      x: Math.floor((1280 - w) / 2),
      y: Math.floor((720 - h) / 2),
      w,
      h,
    })
    // Bảng thụt sâu hơn lề (ô to): kẹp vào mép bảng.
    const inset: Rect = { x: 100, y: 50, w: 1080, h: 620 }
    expect(logoRect(STAGE, inset, PLACE)).toEqual({ x: 100, y: 50, w, h })
    expect(logoRect(STAGE, inset, { ...PLACE, anchor: 'bottom-right' })).toEqual({
      x: 1180 - w,
      y: 670 - h,
      w,
      h,
    })
  })

  it('stage cao hẹp: trần maxHeightRatio thu logo theo tỉ lệ; bề rộng 100 % thì lề bị kẹp; bảng hay stage rỗng → null', () => {
    const tall = logoRect(
      { w: 400, h: 100 },
      { x: 0, y: 0, w: 400, h: 100 },
      { ...PLACE, widthRatio: 1, maxHeightRatio: 0.5 },
    )!
    expect(tall.h).toBe(50)
    expect(tall.w).toBe(Math.round(50 * LOGO_ASPECT))
    const full = logoRect(STAGE, board, { ...PLACE, widthRatio: 1, maxHeightRatio: 1 })!
    expect(full.x).toBe(0)
    expect(full.w).toBe(1280)
    // Trần 60 % chiều cao (432 px) thu logo 100 % bề rộng còn 1137 px.
    const capped = logoRect(STAGE, board, { ...PLACE, widthRatio: 1 })!
    expect(capped.h).toBe(432)
    expect(capped.w).toBe(Math.round(432 * LOGO_ASPECT))
    expect(logoRect(STAGE, { x: 0, y: 0, w: 0, h: 720 }, PLACE)).toBeNull()
    expect(logoRect({ w: 0, h: 0 }, board, PLACE)).toBeNull()
    expect(logoRect({ w: 2, h: 2 }, { x: 0, y: 0, w: 2, h: 2 }, PLACE)).toBeNull()
  })
})

describe('coverage: phần diện tích ô dưới hợp các khung', () => {
  const cell: Rect = { x: 0, y: 0, w: 20, h: 20 }
  it('phủ kín 1; nửa ô 0,5; hai khung chồng lên cùng nửa vẫn 0,5 (bao hàm–loại trừ); ngoài ô 0; ô rỗng 0', () => {
    expect(coverage([{ x: -5, y: -5, w: 30, h: 30 }], cell)).toBe(1)
    expect(coverage([{ x: 0, y: 0, w: 10, h: 20 }], cell)).toBe(0.5)
    expect(
      coverage(
        [
          { x: 0, y: 0, w: 10, h: 20 },
          { x: 0, y: 0, w: 10, h: 20 },
        ],
        cell,
      ),
    ).toBe(0.5)
    expect(
      coverage(
        [
          { x: 0, y: 0, w: 10, h: 20 },
          { x: 10, y: 0, w: 10, h: 20 },
          { x: 5, y: 5, w: 10, h: 10 },
        ],
        cell,
      ),
    ).toBe(1)
    expect(coverage([{ x: 30, y: 30, w: 5, h: 5 }], cell)).toBe(0)
    expect(coverage([{ x: 0, y: 0, w: 10, h: 20 }], { x: 0, y: 0, w: 0, h: 20 })).toBe(0)
  })
})

describe('logoCells: ô theo độ phủ ≥ ½', () => {
  it('64 cột: khoảng 97 ô (69 % rect), hộp bao ô lệch tối đa một ô so với rect; 128 cột gấp gần bốn; 32 cột gần một phần tư', () => {
    const counts: Record<number, number> = {}
    for (const cols of [32, 64, 128]) {
      const L = layoutAt(cols, cols / 2)
      const rect = logoRect(L.stage, L.board, PLACE)!
      const set = logoCells(rect, L, 0.5)
      counts[cols] = set.cellCount
      const bx0 = L.board.x + set.box.col * L.c
      const by0 = L.board.y + set.box.row * L.c
      const bx1 = bx0 + set.box.w * L.c
      const by1 = by0 + set.box.h * L.c
      expect(bx0).toBeGreaterThanOrEqual(rect.x - L.c)
      expect(by0).toBeGreaterThanOrEqual(rect.y - L.c)
      expect(bx1).toBeLessThanOrEqual(rect.x + rect.w + L.c)
      expect(by1).toBeLessThanOrEqual(rect.y + rect.h + L.c)
      expect(bx0).toBeLessThanOrEqual(rect.x + L.c)
      expect(bx1).toBeGreaterThanOrEqual(rect.x + rect.w - L.c)
      for (const { col, row } of cachedCells(set)) {
        expect(col).toBeGreaterThanOrEqual(0)
        expect(row).toBeGreaterThanOrEqual(0)
        expect(col).toBeLessThan(L.cols)
        expect(row).toBeLessThan(L.rows)
      }
    }
    const expected64 = (0.694 * 384 * 146) / 400
    expect(counts[64]).toBeGreaterThan(expected64 * 0.85)
    expect(counts[64]).toBeLessThan(expected64 * 1.15)
    expect(counts[128] / counts[64]).toBeGreaterThan(3.3)
    expect(counts[128] / counts[64]).toBeLessThan(4.7)
    expect(counts[64] / counts[32]).toBeGreaterThan(3)
    expect(counts[64] / counts[32]).toBeLessThan(5)
  })

  it('ô đúng nửa dưới khung là ô logo, 49 % thì không; c = 0 hay rect rỗng → EMPTY_CELLS', () => {
    const grid = { cols: 10, rows: 10, c: 20, board: { x: 0, y: 0, w: 200, h: 200 } }
    // Khung "Human" bắt đầu ở x = 0 của rect; đặt rect sao cho mép trái ở giữa cột 1 (x = 30) và rect đủ cao để
    // một hàng ô nằm trọn trong khung theo chiều dọc (rect rộng hơn bảng: ô ngoài bảng bị bỏ).
    const rect: Rect = { x: 30, y: 0, w: 400, h: Math.round(400 / LOGO_ASPECT) }
    const set = logoCells(rect, grid, 0.5)
    const human = logoFramesIn(rect)[1]
    const rowMid = Math.floor((human.y + human.h / 2) / 20)
    expect(human.y).toBeLessThanOrEqual(rowMid * 20)
    expect(human.y + human.h).toBeGreaterThanOrEqual(rowMid * 20 + 20)
    expect(set.box.col + set.box.w).toBeLessThanOrEqual(grid.cols)
    expect(cellAt(set, 1, rowMid)).toBe(true)
    const shifted = logoCells({ ...rect, x: 30.5 }, grid, 0.5)
    expect(cellAt(shifted, 1, rowMid)).toBe(false)
    expect(logoCells(rect, { ...grid, c: 0 }, 0.5)).toBe(EMPTY_CELLS)
    expect(logoCells({ ...rect, w: 0 }, grid, 0.5)).toBe(EMPTY_CELLS)
    expect(logoCells({ x: 500, y: 500, w: 50, h: 20 }, grid, 0.5)).toBe(EMPTY_CELLS)
  })
})

describe('wordmarkSvg: lớp chữ từ SVG gốc', () => {
  const colors = {
    text: DEFAULTS.brand.logo.text,
    verify: DEFAULTS.brand.logo.verify,
    fonts: DEFAULTS.brand.logo.fonts,
    textLength: DEFAULTS.brand.logo.textLength,
  }

  it('bỏ ba rect khung (lớp fill:none), navy → màu chữ, xanh lá giữ; dòng chữ sống thành <text> phẳng có textLength và font dự phòng', () => {
    const out = wordmarkSvg(SVG, colors)
    expect((SVG.match(/<rect class="cls-6"/g) ?? []).length).toBe(3)
    expect(out).not.toContain('<rect class="cls-6"')
    // Hai ô vuông xanh lá của dấu hai chấm và các path chữ vẫn còn.
    expect((out.match(/<rect class="cls-7"/g) ?? []).length).toBe(2)
    expect((out.match(/<path class="cls-8"/g) ?? []).length).toBe(
      (SVG.match(/<path class="cls-8"/g) ?? []).length,
    )
    expect(out).not.toContain(`fill:${LOGO_NAVY}`)
    expect(out).toContain(`fill:${colors.text}`)
    expect(out).toContain(`fill:${LOGO_GREEN}`)
    expect(out).not.toContain('<tspan')
    const text = /<text([^>]*)>([^<]*)<\/text>/.exec(out)!
    expect(text[2]).toBe('AI ETHIC CAMPAIGN')
    expect(text[1]).toContain('class="cls-1"')
    expect(text[1]).toContain('transform="translate(330.14 281.35)"')
    expect(text[1]).toContain(`textLength="${colors.textLength}"`)
    expect(text[1]).toContain('lengthAdjust="spacingAndGlyphs"')
    expect(text[1]).toContain("style=\"font-family:Heavitas, 'Arial Black'")
    expect(out.startsWith('<svg width="700" height="400" ')).toBe(true)
    expect(out).toContain('viewBox="0 0 700 400"')
    expect(SVG).not.toMatch(/<svg[^>]*\swidth=/)
  })

  it('màu VERIFY tùy chọn thay cho xanh lá; nguồn không đổi', () => {
    const before = SVG
    const out = wordmarkSvg(SVG, { ...colors, verify: '#dfe025' })
    expect(out).toContain('fill:#dfe025')
    expect(out).not.toContain(`fill:${LOGO_GREEN}`)
    expect(SVG).toBe(before)
  })
})
