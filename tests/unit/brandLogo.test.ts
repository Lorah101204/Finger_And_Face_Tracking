import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  LOGO_ASPECT,
  LOGO_CROP,
  LOGO_FRAME_CELLS,
  LOGO_FRAMES,
  LOGO_FRAMES_SVG,
  LOGO_GREEN,
  LOGO_GRID,
  LOGO_NAVY,
  LOGO_STROKE,
  logoFramesIn,
  logoGeometry,
  logoRect,
  logoSvg,
  unionRect,
  type LogoPlacement,
} from '../../src/core/brandLogo'
import { DEFAULTS } from '../../src/core/config'
import { computeLayout } from '../../src/core/coords'
import type { Rect } from '../../src/core/types'

// BRAND-01 (mục 7.33, D-056, D-057): hình học logo thuần trong Node: hằng số khớp SVG bundle; rect theo stage, không
// theo số ô; SVG nạp qua Image giữ nguyên khung và màu, chỉ làm phẳng dòng chữ sống (textLength, font dự phòng) và
// đặt width/height gốc.
const SVG = readFileSync(new URL('../../src/assets/logo-verify-human.svg', import.meta.url), 'utf8')
const PLACE: LogoPlacement = {
  widthRatio: DEFAULTS.brand.logo.widthRatio,
  maxHeightRatio: DEFAULTS.brand.logo.maxHeightRatio,
  marginRatio: DEFAULTS.brand.logo.marginRatio,
  anchor: DEFAULTS.brand.logo.anchor,
  snapMaxWidthRatio: DEFAULTS.brand.logo.snapMaxWidthRatio,
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

  it('D-058: lưới module 21 × 8 ô (đơn vị = bề rộng khung / 15) khớp ba rect khung của SVG với sai lệch ≤ 0,1 ô mọi cạnh', () => {
    const u = LOGO_FRAMES_SVG[0].w / 15
    const x0 = LOGO_FRAMES_SVG[1].x
    const y0 = LOGO_FRAMES_SVG[0].y
    expect(LOGO_GRID).toEqual({ w: 21, h: 8 })
    expect(LOGO_FRAME_CELLS).toHaveLength(3)
    let worst = 0
    LOGO_FRAME_CELLS.forEach((cell, i) => {
      const f = LOGO_FRAMES_SVG[i]
      for (const d of [
        (f.x - x0) / u - cell.x,
        (f.y - y0) / u - cell.y,
        f.w / u - cell.w,
        f.h / u - cell.h,
      ]) {
        expect(Math.abs(d)).toBeLessThanOrEqual(0.1)
        worst = Math.max(worst, Math.abs(d))
      }
    })
    expect(worst).toBeGreaterThan(0.05)
    // Hợp ba khung ô là đúng 21 × 8.
    expect(unionRect(LOGO_FRAME_CELLS)).toEqual({ x: 0, y: 0, w: 21, h: 8 })
  })
})

describe('logoGeometry: khớp ô theo module (D-058) hay cỡ cố định', () => {
  it('64 và 128 cột trên 1280 × 720: logo 21 × 8 ô module (420 × 160 px), lề 2 hay 3 ô, mọi cạnh khung trên vạch ô; 256 cột cùng cỡ với k = 4', () => {
    for (const [cols, k] of [
      [64, 1],
      [128, 2],
      [256, 4],
    ] as const) {
      const L = layoutAt(cols, (cols * 9) / 16)
      const g = logoGeometry(L, PLACE)!
      expect(g.snapped).toBe(true)
      expect(g.module).toBe(k * L.c)
      expect(g.rect.w).toBe(420)
      expect(g.rect.h).toBe(160)
      const m = Math.round((PLACE.marginRatio * 1280) / L.c)
      expect(g.rect.x).toBe(L.board.x + m * L.c)
      expect(g.rect.y).toBe(L.board.y + m * L.c)
      for (const f of g.frames) {
        for (const v of [f.x - L.board.x, f.y - L.board.y, f.w, f.h]) expect(v % L.c).toBe(0)
      }
      expect(g.frames[0]).toEqual({
        x: g.rect.x + 6 * g.module,
        y: g.rect.y,
        w: 15 * g.module,
        h: 3 * g.module,
      })
      expect(unionRect(g.frames)).toEqual(g.rect)
    }
  })

  it('32 cột (ô 40 px): 21 ô = 840 px vượt snapMaxWidthRatio nên về cỡ cố định 384 × 146 không khớp ô; nới snapMaxWidthRatio thì khớp ô 840 px', () => {
    const L = layoutAt(32, 18)
    const g = logoGeometry(L, PLACE)!
    expect(g.snapped).toBe(false)
    expect(g.module).toBe(0)
    expect(g.rect).toEqual(logoRect(L.stage, L.board, PLACE))
    expect(g.frames).toEqual(logoFramesIn(g.rect))
    const wide = logoGeometry(L, { ...PLACE, snapMaxWidthRatio: 0.7 })!
    expect(wide.snapped).toBe(true)
    expect(wide.rect.w).toBe(840)
    expect(wide.rect.h).toBe(320)
  })

  it('neo: phải và dưới tính bằng ô từ mép bảng, giữa căn giữa; lề kẹp trong bảng; không đủ ô hay c = 0 → cỡ cố định; bảng rỗng → null', () => {
    const L = layoutAt(64, 36)
    const tr = logoGeometry(L, { ...PLACE, anchor: 'top-right' })!
    expect(tr.rect.x).toBe(L.board.x + (64 - 2 - 21) * L.c)
    const br = logoGeometry(L, { ...PLACE, anchor: 'bottom-right' })!
    expect(br.rect.y).toBe(L.board.y + (36 - 2 - 8) * L.c)
    const ce = logoGeometry(L, { ...PLACE, anchor: 'center' })!
    expect(ce.rect.x).toBe(L.board.x + Math.floor((64 - 21) / 2) * L.c)
    expect(ce.rect.y).toBe(L.board.y + Math.floor((36 - 8) / 2) * L.c)
    // Lưới 20 × 20 ô: không đủ 21 cột → cỡ cố định.
    const small = layoutAt(20, 20)
    expect(logoGeometry(small, PLACE)!.snapped).toBe(false)
    expect(logoGeometry({ ...L, c: 0 }, PLACE)!.snapped).toBe(false)
    expect(logoGeometry({ ...L, board: { x: 0, y: 0, w: 0, h: 0 }, c: 0 }, PLACE)).toBeNull()
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
    // Ba khung trong px stage theo rect: hợp của chúng là chính rect.
    const frames = logoFramesIn({ x: 32, y: 32, w, h })
    const u = unionRect(frames)
    expect(u.x).toBeCloseTo(32, 6)
    expect(u.y).toBeCloseTo(32, 6)
    expect(u.w).toBeCloseTo(w, 6)
    expect(u.h).toBeCloseTo(h, 6)
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

describe('logoSvg: SVG gốc để nạp qua Image', () => {
  const opts = { fonts: DEFAULTS.brand.logo.fonts, textLength: DEFAULTS.brand.logo.textLength }

  it('giữ nguyên ba rect khung, mọi path và hai màu mực; dòng chữ sống thành <text> phẳng có textLength và font dự phòng; gốc có width/height bằng viewBox', () => {
    const out = logoSvg(SVG, opts)
    expect((out.match(/<rect class="cls-6"/g) ?? []).length).toBe(3)
    expect((out.match(/<rect class="cls-7"/g) ?? []).length).toBe(2)
    expect((out.match(/<path /g) ?? []).length).toBe((SVG.match(/<path /g) ?? []).length)
    expect(out).toContain(`fill:${LOGO_NAVY}`)
    expect(out).toContain(`fill:${LOGO_GREEN}`)
    expect(out).toContain(`stroke:${LOGO_NAVY}`)
    expect(out).not.toContain('<tspan')
    const text = /<text([^>]*)>([^<]*)<\/text>/.exec(out)!
    expect(text[2]).toBe('AI ETHIC CAMPAIGN')
    expect(text[1]).toContain('class="cls-1"')
    expect(text[1]).toContain('transform="translate(330.14 281.35)"')
    expect(text[1]).toContain(`textLength="${opts.textLength}"`)
    expect(text[1]).toContain('lengthAdjust="spacingAndGlyphs"')
    expect(text[1]).toContain("style=\"font-family:Heavitas, 'Arial Black'")
    expect(out.startsWith('<svg width="700" height="400" ')).toBe(true)
    expect(out).toContain('viewBox="0 0 700 400"')
    expect(SVG).not.toMatch(/<svg[^>]*\swidth=/)
    // Ngoài <text> và gốc <svg>, phần còn lại không đổi.
    const strip = (x: string) =>
      x.replace(/<text[\s\S]*?<\/text>/g, '').replace(/<svg[^>]*>/, '<svg>')
    expect(strip(out)).toBe(strip(SVG))
  })

  it('SVG đã có width thì giữ; không có <text> thì không đổi gì ngoài gốc; nguồn không bị sửa', () => {
    const before = SVG
    expect(logoSvg('<svg width="10" height="5" viewBox="0 0 10 5"><rect/></svg>', opts)).toBe(
      '<svg width="10" height="5" viewBox="0 0 10 5"><rect/></svg>',
    )
    expect(logoSvg('<svg viewBox="0 0 10 5"><rect/></svg>', opts)).toBe(
      '<svg width="10" height="5" viewBox="0 0 10 5"><rect/></svg>',
    )
    expect(SVG).toBe(before)
  })
})
