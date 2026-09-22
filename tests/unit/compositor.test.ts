import { describe, expect, it } from 'vitest'
import { cameraToStage, computeLayout } from '../../src/core/coords'
import type { HandFrame } from '../../src/core/types'
import { buildMask, polygonShape, windowShape } from '../../src/mask/buildMask'
import { FINGER_COLORS, render } from '../../src/mask/compositor'

// MASK-01: compositor qua ctx giả ghi lại lời gọi (Node không có Canvas 2D). Kiểm thứ tự và tham số, không kiểm pixel
// (pixel kiểm ở e2e mục 7.8).
class StubCtx {
  calls: string[] = []
  fillStyle = ''
  strokeStyle = ''
  lineWidth = 1
  fillRect(...a: number[]) {
    this.calls.push(`fillRect ${a.join(',')}`)
  }
  save() {
    this.calls.push('save')
  }
  restore() {
    this.calls.push('restore')
  }
  beginPath() {
    this.calls.push('beginPath')
  }
  rect(...a: number[]) {
    this.calls.push(`rect ${a.join(',')}`)
  }
  clip() {
    this.calls.push('clip')
  }
  translate(...a: number[]) {
    this.calls.push(`translate ${a.join(',')}`)
  }
  scale(...a: number[]) {
    this.calls.push(`scale ${a.join(',')}`)
  }
  drawImage(_src: unknown, ...a: number[]) {
    this.calls.push(`drawImage ${a.join(',')}`)
  }
  strokeRect(...a: number[]) {
    this.calls.push(`strokeRect ${a.join(',')}`)
  }
  setLineDash(a: number[]) {
    this.calls.push(`setLineDash ${a.join(',')}`)
  }
  // HAND-01: overlay tay dùng globalAlpha, font, fillText, strokeText.
  #alpha = 1
  get globalAlpha() {
    return this.#alpha
  }
  set globalAlpha(v: number) {
    this.#alpha = v
    this.calls.push(`alpha ${v}`)
  }
  font = ''
  textBaseline = ''
  fillText(text: string, x: number, y: number) {
    this.calls.push(`fillText ${text} ${x},${y}`)
  }
  // CLS-02: nhãn phân loại đo chữ để vẽ nền; stub trả bề rộng theo số ký tự.
  measureText(text: string) {
    return { width: text.length * 6 }
  }
  strokeText(text: string, x: number, y: number) {
    this.calls.push(`strokeText ${text} ${x},${y}`)
  }
  // ROI-02: viền tập ô và tứ giác nét đứt dùng path.
  moveTo(x: number, y: number) {
    this.calls.push(`moveTo ${x},${y}`)
  }
  lineTo(x: number, y: number) {
    this.calls.push(`lineTo ${x},${y}`)
  }
  closePath() {
    this.calls.push('closePath')
  }
  stroke() {
    this.calls.push('stroke')
  }
}

const ctxOf = (s: StubCtx) => s as unknown as CanvasRenderingContext2D
const DRAWABLE = {} as CanvasImageSource
const L = computeLayout({ w: 1280, h: 720 }, { cols: 32, rows: 32 }, { w: 1280, h: 720 })
const mask = buildMask(windowShape({ col: 3, row: 4, n: 5 }), L, false, 1)
const maskMirror = buildMask(windowShape({ col: 3, row: 4, n: 5 }), L, true, 1)

const FACES = [
  {
    status: 'full' as const,
    bboxStage: { x: 300.4, y: 200.6, w: 50, h: 40 },
    landmarksStage: [
      { x: 310.2, y: 210.7 },
      { x: 340, y: 230 },
    ],
    visible: 1,
    subjectType: 'unknown' as const,
  },
  {
    status: 'partial' as const,
    bboxStage: { x: 100, y: 100, w: 500, h: 400 },
    landmarksStage: [{ x: 320, y: 220 }],
    visible: 1,
    subjectType: 'unknown' as const,
  },
]

describe('render với mặt (FACE-02)', () => {
  it('mặt vẽ sau video, trong save/clip(stageRect)/restore riêng, trước viền; full nét liền, partial nét đứt', () => {
    const s = new StubCtx()
    render(ctxOf(s), L, { showLines: false, mirror: false, drawable: DRAWABLE, mask, faces: FACES })
    const sr = mask.stageRect
    const draw = s.calls.findIndex((c) => c.startsWith('drawImage'))
    const clips = s.calls.map((c, i) => (c === 'clip' ? i : -1)).filter((i) => i >= 0)
    expect(clips).toHaveLength(2)
    expect(clips[1]).toBeGreaterThan(draw)
    expect(s.calls[clips[1] - 1]).toBe(`rect ${sr.x},${sr.y},${sr.w},${sr.h}`)
    const faceStart = clips[1]
    const outline = s.calls.lastIndexOf(
      `strokeRect ${sr.x + 1},${sr.y + 1},${sr.w - 2},${sr.h - 2}`,
    )
    // Viền có save riêng ngay trước strokeRect; phần mặt kết thúc trước save đó.
    const between = s.calls.slice(faceStart, outline - 1)
    expect(between).toContain('setLineDash ')
    expect(between).toContain('strokeRect 300,201,50,40')
    expect(between).toContain('fillRect 309,210,2,2')
    expect(between).toContain('fillRect 339,229,2,2')
    expect(between).toContain('setLineDash 6,4')
    expect(between).toContain('strokeRect 100,100,500,400')
    expect(between).toContain('fillRect 319,219,2,2')
    expect(between.at(-2)).toBe('setLineDash ')
    expect(between.at(-1)).toBe('restore')
    expect(s.calls.filter((c) => c.startsWith('drawImage'))).toHaveLength(1)
  })

  it('không có mask thì không vẽ mặt dù có faces; faces rỗng thì không có clip thứ hai', () => {
    const s = new StubCtx()
    render(ctxOf(s), L, {
      showLines: false,
      mirror: false,
      drawable: DRAWABLE,
      mask: null,
      faces: FACES,
    })
    expect(s.calls.includes('clip')).toBe(false)
    const s2 = new StubCtx()
    render(ctxOf(s2), L, { showLines: false, mirror: false, drawable: DRAWABLE, mask, faces: [] })
    expect(s2.calls.filter((c) => c === 'clip')).toHaveLength(1)
  })
})

describe('render', () => {
  it('không có mask: chỉ nền trắng và vạch lưới, không drawImage, không clip', () => {
    const s = new StubCtx()
    render(ctxOf(s), L, { showLines: true, mirror: true, drawable: DRAWABLE, mask: null })
    expect(s.calls[0]).toBe('fillRect 0,0,1280,720')
    expect(s.calls.some((c) => c.startsWith('drawImage'))).toBe(false)
    expect(s.calls.includes('clip')).toBe(false)
    expect(s.calls.some((c) => c.startsWith('strokeRect'))).toBe(false)
  })

  it('có mask nhưng chưa có camera: không drawImage, vẫn vẽ viền trong stageRect', () => {
    const s = new StubCtx()
    render(ctxOf(s), L, { showLines: false, mirror: false, drawable: null, mask })
    expect(s.calls.some((c) => c.startsWith('drawImage'))).toBe(false)
    const r = mask.stageRect
    expect(s.calls).toContain(`strokeRect ${r.x + 1},${r.y + 1},${r.w - 2},${r.h - 2}`)
  })

  it('không mirror: clip đúng stageRect rồi drawImage cameraRect → stageRect, 9 tham số, trong save/restore', () => {
    const s = new StubCtx()
    render(ctxOf(s), L, { showLines: false, mirror: false, drawable: DRAWABLE, mask })
    const sr = mask.stageRect
    const cr = mask.cameraRect
    const i = s.calls.indexOf('save')
    expect(s.calls.slice(i, i + 5)).toEqual([
      'save',
      'beginPath',
      `rect ${sr.x},${sr.y},${sr.w},${sr.h}`,
      'clip',
      `drawImage ${cr.x},${cr.y},${cr.w},${cr.h},${sr.x},${sr.y},${sr.w},${sr.h}`,
    ])
    expect(s.calls[i + 5]).toBe('restore')
    expect(s.calls.filter((c) => c.startsWith('drawImage'))).toHaveLength(1)
    // Viền vẽ sau cùng trong cặp save/restore riêng của drawWindowOutline.
    expect(s.calls.slice(-3)).toEqual([
      'save',
      `strokeRect ${sr.x + 1},${sr.y + 1},${sr.w - 2},${sr.h - 2}`,
      'restore',
    ])
  })

  it('mirror: translate tới mép phải stageRect, scale(-1, 1), drawImage vào (0, 0) cùng kích thước stageRect', () => {
    const s = new StubCtx()
    render(ctxOf(s), L, { showLines: false, mirror: true, drawable: DRAWABLE, mask: maskMirror })
    const sr = maskMirror.stageRect
    const cr = maskMirror.cameraRect
    expect(s.calls).toContain(`translate ${sr.x + sr.w},${sr.y}`)
    expect(s.calls).toContain('scale -1,1')
    expect(s.calls).toContain(`drawImage ${cr.x},${cr.y},${cr.w},${cr.h},0,0,${sr.w},${sr.h}`)
    const t = s.calls.indexOf('clip')
    expect(s.calls.indexOf(`translate ${sr.x + sr.w},${sr.y}`)).toBeGreaterThan(t)
  })

  it('nền trắng luôn là lời gọi đầu tiên (I4), viền là lời gọi cuối', () => {
    const s = new StubCtx()
    render(ctxOf(s), L, { showLines: true, mirror: true, drawable: DRAWABLE, mask })
    expect(s.calls[0]).toBe('fillRect 0,0,1280,720')
    expect(s.calls.at(-2)).toMatch(/^strokeRect /)
    expect(s.calls.at(-1)).toBe('restore')
    const draw = s.calls.findIndex((c) => c.startsWith('drawImage'))
    const stroke = s.calls.findIndex((c) => c.startsWith('strokeRect'))
    expect(draw).toBeGreaterThan(0)
    expect(stroke).toBeGreaterThan(draw)
  })

  // BRAND-01 (mục 7.33, D-058): lớp logo vẽ sau vạch lưới (nét khung đè vạch) và trước video; không có logo thì không
  // thêm lời gọi nào.
  it('logo: sau vạch lưới, trước video; null thì không vẽ', () => {
    const s = new StubCtx()
    const logo = {
      version: 1,
      draw(ctx: unknown, layout: unknown) {
        expect(layout).toBe(L)
        ;(ctx as StubCtx).calls.push('logo')
        return true
      },
    }
    render(ctxOf(s), L, { showLines: true, mirror: true, drawable: DRAWABLE, mask, logo })
    expect(s.calls[0]).toBe('fillRect 0,0,1280,720')
    const at = s.calls.indexOf('logo')
    expect(s.calls.filter((c) => c === 'logo')).toHaveLength(1)
    // Trước logo chỉ có nền trắng và vạch lưới (cols + rows + 2 fillRect); sau logo mới tới video.
    expect(at).toBe(1 + (L.cols + 1) + (L.rows + 1))
    expect(s.calls.slice(1, at).every((c) => c.startsWith('fillRect '))).toBe(true)
    expect(s.calls.findIndex((c) => c.startsWith('drawImage'))).toBeGreaterThan(at)
    const plain = new StubCtx()
    render(ctxOf(plain), L, { showLines: true, mirror: true, drawable: DRAWABLE, mask, logo: null })
    expect(plain.calls).not.toContain('logo')
    const noLines = new StubCtx()
    render(ctxOf(noLines), L, { showLines: false, mirror: true, drawable: null, mask: null, logo })
    expect(noLines.calls).toEqual(['fillRect 0,0,1280,720', 'logo'])
  })
})

// HAND-01 bước 5: overlay tay vẽ trên nền trắng (fillRect, strokeRect, fillText), cả khi không có mask; sau viền.
function handFrame(patch: Partial<HandFrame> = {}): HandFrame {
  const landmarksCam = Array.from({ length: 21 }, (_, i) => ({ x: 500 + 10 * i, y: 300 + 5 * i }))
  return {
    frameId: 3,
    ts: 1000,
    uncertain: false,
    hands: [
      {
        id: 7,
        handedness: 'left',
        score: 0.9,
        palmCenterCam: { x: 540, y: 320 },
        bboxCam: { x: 500, y: 300, w: 200, h: 100 },
        landmarksCam,
        lastSeenTs: 1000,
        frameId: 3,
      },
    ],
    ...patch,
  }
}

describe('render với tay (HAND-01)', () => {
  it('không mask: vẫn vẽ bbox, năm đầu ngón, tâm và nhãn tay; không drawImage, không clip', () => {
    const s = new StubCtx()
    const f = handFrame()
    render(ctxOf(s), L, {
      showLines: false,
      mirror: false,
      drawable: DRAWABLE,
      mask: null,
      hands: f,
      now: 1050,
    })
    expect(s.calls.some((c) => c.startsWith('drawImage'))).toBe(false)
    expect(s.calls.includes('clip')).toBe(false)
    expect(s.calls).toContain('alpha 1')
    expect(s.calls).toContain('setLineDash ')
    const tip = cameraToStage(f.hands[0].landmarksCam[8], L, false)
    expect(s.calls).toContain(`fillRect ${Math.round(tip.x) - 2},${Math.round(tip.y) - 2},4,4`)
    expect(s.calls.filter((c) => /^fillRect -?\d+,-?\d+,4,4$/.test(c))).toHaveLength(5)
    const b = cameraToStage({ x: 500, y: 300 }, L, false)
    expect(s.calls).toContain(`fillText Trái #7 ${Math.round(b.x)},${Math.round(b.y) - 4}`)
    expect(s.calls).toContain(`strokeText Trái #7 ${Math.round(b.x)},${Math.round(b.y) - 4}`)
    expect(s.calls.at(-1)).toBe('restore')
  })

  it('tay cũ hơn 600 ms (D-059) vẽ mờ; frame uncertain vẽ nét đứt và nhãn có dấu hỏi; mirror đảo trục x; hands rỗng không vẽ', () => {
    const s = new StubCtx()
    render(ctxOf(s), L, {
      showLines: false,
      mirror: true,
      drawable: DRAWABLE,
      mask: null,
      hands: handFrame({ uncertain: true }),
      now: 1000 + 601,
    })
    expect(s.calls).toContain('alpha 0.45')
    expect(s.calls).toContain('setLineDash 4,3')
    const bm = cameraToStage({ x: 700, y: 300 }, L, true)
    expect(s.calls).toContain(`fillText Trái #7 ? ${Math.round(bm.x)},${Math.round(bm.y) - 4}`)
    const s2 = new StubCtx()
    render(ctxOf(s2), L, {
      showLines: false,
      mirror: false,
      drawable: DRAWABLE,
      mask: null,
      hands: handFrame({ hands: [] }),
    })
    expect(s2.calls.some((c) => c.startsWith('fillText'))).toBe(false)
  })

  it('có mask: tay vẽ sau viền cửa sổ (không bị clip) và vẫn đúng một drawImage', () => {
    const s = new StubCtx()
    render(ctxOf(s), L, {
      showLines: false,
      mirror: false,
      drawable: DRAWABLE,
      mask,
      hands: handFrame(),
      now: 1000,
    })
    const sr = mask.stageRect
    const outline = s.calls.lastIndexOf(
      `strokeRect ${sr.x + 1},${sr.y + 1},${sr.w - 2},${sr.h - 2}`,
    )
    const text = s.calls.findIndex((c) => c.startsWith('fillText'))
    expect(outline).toBeGreaterThan(0)
    expect(text).toBeGreaterThan(outline)
    expect(s.calls.filter((c) => c === 'clip')).toHaveLength(1)
    expect(s.calls.filter((c) => c.startsWith('drawImage'))).toHaveLength(1)
  })
})

// ROI-03: chấm đầu ngón 8 px màu theo tay tại pStage; mờ khi không hợp lệ; không chữ.
describe('render với đầu ngón (ROI-03)', () => {
  it('vẽ chấm cho từng đầu ngón, mờ khi không hợp lệ, màu theo tay; vẽ sau overlay tay', () => {
    const s = new StubCtx()
    const base = { pCam: { x: 0, y: 0 }, ts: 1000, ageMs: 0, score: 0.9 }
    render(ctxOf(s), L, {
      showLines: false,
      mirror: false,
      drawable: DRAWABLE,
      mask: null,
      hands: handFrame(),
      now: 1000,
      fingers: [
        { ...base, hand: 'left', trackId: 1, tip: 4, valid: true, pStage: { x: 300.4, y: 200.6 } },
        {
          ...base,
          hand: 'right',
          trackId: 2,
          tip: 8,
          valid: false,
          reason: 'stale-point',
          pStage: { x: 400, y: 250 },
        },
      ],
    })
    const dots = s.calls.filter((c) => /^fillRect -?\d+,-?\d+,8,8$/.test(c))
    expect(dots).toEqual(['fillRect 296,197,8,8', 'fillRect 396,246,8,8'])
    const i0 = s.calls.indexOf('fillRect 296,197,8,8')
    expect(s.calls[i0 - 1]).toBe('alpha 1')
    const i1 = s.calls.indexOf('fillRect 396,246,8,8')
    expect(s.calls[i1 - 1]).toBe('alpha 0.4')
    expect(FINGER_COLORS.left).not.toBe(FINGER_COLORS.right)
    expect(s.calls.slice(i0).some((c) => /^fillText \d/.test(c))).toBe(false)
    const handText = s.calls.findIndex((c) => c.startsWith('fillText Trái'))
    expect(handText).toBeGreaterThan(0)
    expect(i0).toBeGreaterThan(handText)
    expect(s.calls.at(-1)).toBe('restore')
    expect(s.calls.some((c) => c.startsWith('drawImage'))).toBe(false)
  })
})

// ROI-02 (D-038): mask tứ giác có lỗ: clip là path từng ô mở (không phải một rect), viền là các cạnh biên lùi 1 px,
// tứ giác vẽ nét đứt sau viền; mặt cũng clip theo ô.
describe('render với tứ giác (ROI-02)', () => {
  // c = 22, bảng tại (288, 8). Tam giác gần tứ giác từ ô (2,2) tới (8,8): nửa dưới trái của hộp là lỗ.
  const px = (col: number, row: number) => ({ x: L.board.x + col * L.c, y: L.board.y + row * L.c })
  const quad = buildMask(
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

  it('clip bằng một rect mỗi ô mở rồi một drawImage hộp bao; không strokeRect viền mà stroke các cạnh biên; tứ giác nét đứt', () => {
    expect(quad.holesCam.length).toBeGreaterThan(0)
    const s = new StubCtx()
    render(ctxOf(s), L, { showLines: false, mirror: false, drawable: DRAWABLE, mask: quad })
    const clip = s.calls.indexOf('clip')
    const rects = s.calls.slice(s.calls.indexOf('beginPath') + 1, clip)
    expect(rects).toHaveLength(quad.cellCount)
    expect(rects.every((c) => c.startsWith('rect ') && c.endsWith(`,${L.c},${L.c}`))).toBe(true)
    const sr = quad.stageRect
    const cr = quad.cameraRect
    expect(s.calls[clip + 1]).toBe(
      `drawImage ${cr.x},${cr.y},${cr.w},${cr.h},${sr.x},${sr.y},${sr.w},${sr.h}`,
    )
    expect(s.calls.some((c) => c.startsWith('strokeRect'))).toBe(false)
    const strokes = s.calls.filter((c) => c === 'stroke')
    expect(strokes).toHaveLength(2) // viền tập ô, rồi tứ giác
    expect(s.calls.filter((c) => c.startsWith('moveTo')).length).toBeGreaterThan(quad.box.w * 2)
    expect(s.calls).toContain('setLineDash 3,3')
    expect(s.calls).toContain('closePath')
    // Cạnh trái của ô (2,2) lùi 1 px: moveTo (x+1, y).
    expect(s.calls).toContain(`moveTo ${px(2, 2).x + 1},${px(2, 2).y}`)
    expect(s.calls.at(-1)).toBe('restore')
  })

  it('mặt trong mask tứ giác: clip thứ hai cũng là path từng ô', () => {
    const s = new StubCtx()
    render(ctxOf(s), L, {
      showLines: false,
      mirror: false,
      drawable: DRAWABLE,
      mask: quad,
      faces: FACES,
    })
    const clips = s.calls.map((c, i) => (c === 'clip' ? i : -1)).filter((i) => i >= 0)
    expect(clips).toHaveLength(2)
    const between = s.calls.slice(clips[0] + 1, clips[1])
    expect(between.filter((c) => c.startsWith('rect ')).length).toBe(quad.cellCount)
  })
})
