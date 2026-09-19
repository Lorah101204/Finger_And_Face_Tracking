import { describe, expect, it } from 'vitest'
import { convexHull, polygonArea } from '../../src/core/cells'
import { computeLayout } from '../../src/core/coords'
import type { Point } from '../../src/core/types'
import {
  INITIAL_HULL_STATE,
  solveHull,
  type HullPoint,
  type HullSolverOptions,
  type HullSolverState,
} from '../../src/reveal/hullSolver'

// ROI-03 (mục 7.26, D-047): solver bao lồi thuần. Lưới 64 × 36 trên stage 1280 × 720: c = 20, bảng phủ cả stage.
const L = computeLayout({ w: 1280, h: 720 }, { cols: 64, rows: 36 }, { w: 1280, h: 720 })
/** Tắt lọc: minCutoff rất lớn để giá trị lọc gần bằng giá trị thô. */
const NO_FILTER: HullSolverOptions = { oneEuro: { minCutoff: 1e6, beta: 0, dCutoff: 1e6 } }

const ids = (pts: Point[], prefix = 'p'): HullPoint[] =>
  pts.map((p, i) => ({ id: `${prefix}${i}`, p }))

/** Bốn góc của hình chữ nhật tâm (cx, cy), rộng w, cao h, theo thứ tự lộn xộn. */
function rect(cx: number, cy: number, w: number, h: number): Point[] {
  return [
    { x: cx - w / 2, y: cy + h / 2 },
    { x: cx + w / 2, y: cy - h / 2 },
    { x: cx - w / 2, y: cy - h / 2 },
    { x: cx + w / 2, y: cy + h / 2 },
  ]
}

function series(frames: HullPoint[][], opts: HullSolverOptions = {}, dtMs = 33) {
  let state: HullSolverState = INITIAL_HULL_STATE
  const out: ReturnType<typeof solveHull>[] = []
  frames.forEach((pts, i) => {
    const r = solveHull(pts, L, state, 1000 + i * dtMs, opts)
    state = r.state
    out.push(r)
  })
  return out
}

describe('convexHull', () => {
  it('bốn góc lộn xộn → hình chữ nhật; điểm trong và trên cạnh bị bỏ; dưới ba điểm phân biệt trả về các điểm', () => {
    const hull = convexHull([
      { x: 840, y: 460 },
      { x: 440, y: 260 },
      { x: 640, y: 360 },
      { x: 840, y: 260 },
      { x: 640, y: 260 },
      { x: 440, y: 460 },
      { x: 440, y: 460 },
    ])
    expect(hull).toEqual([
      { x: 440, y: 260 },
      { x: 840, y: 260 },
      { x: 840, y: 460 },
      { x: 440, y: 460 },
    ])
    expect(polygonArea(hull)).toBe(400 * 200)
    expect(convexHull([{ x: 1, y: 1 }])).toEqual([{ x: 1, y: 1 }])
    expect(
      convexHull([
        { x: 1, y: 1 },
        { x: 1, y: 1 },
        { x: 5, y: 5 },
      ]),
    ).toEqual([
      { x: 1, y: 1 },
      { x: 5, y: 5 },
    ])
    // Ba điểm thẳng hàng: không có đa giác.
    expect(
      convexHull([
        { x: 0, y: 0 },
        { x: 5, y: 5 },
        { x: 10, y: 10 },
      ]),
    ).toHaveLength(2)
  })

  it('mười đầu ngón: bao lồi chứa mọi điểm và bỏ điểm trong', () => {
    const pts: Point[] = [
      { x: 300, y: 300 },
      { x: 320, y: 200 },
      { x: 360, y: 190 },
      { x: 400, y: 210 },
      { x: 420, y: 260 },
      { x: 700, y: 300 },
      { x: 680, y: 200 },
      { x: 640, y: 190 },
      { x: 600, y: 210 },
      { x: 580, y: 260 },
    ]
    const hull = convexHull(pts)
    expect(hull.length).toBeGreaterThanOrEqual(4)
    expect(hull.length).toBeLessThan(pts.length)
    const inside = (p: Point) => {
      for (let i = 0, j = hull.length - 1; i < hull.length; j = i++) {
        const a = hull[j]
        const b = hull[i]
        if ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) < -1e-9) return false
      }
      return true
    }
    expect(pts.every(inside)).toBe(true)
    expect(hull.some((h) => h.x === 420 && h.y === 260)).toBe(false)
  })
})

describe('solveHull', () => {
  it('bốn điểm hợp lệ: đa giác là bao lồi, đo hộp bao, diện tích, số điểm; mẫu đầu không trễ', () => {
    const [r] = series([ids(rect(640, 360, 400, 200))])
    expect(r.polygon).toEqual([
      { x: 440, y: 260 },
      { x: 840, y: 260 },
      { x: 840, y: 460 },
      { x: 440, y: 460 },
    ])
    expect(r.measure).toMatchObject({
      points: 4,
      bbox: { x: 440, y: 260, w: 400, h: 200 },
      shortCells: 10,
      areaCells: 200,
    })
    expect(r.measure!.filtered).toEqual(r.measure!.raw)
    expect(r.state.open).toBe(true)
    expect(Object.keys(r.state.filters)).toEqual(['p0', 'p1', 'p2', 'p3'])
  })

  it('mười điểm với điểm nằm trong: đa giác chỉ gồm đỉnh ngoài; bộ lọc theo khóa nên điểm vào ra không làm lệch', () => {
    const outer = rect(640, 360, 400, 200)
    const inner: Point[] = [
      { x: 500, y: 300 },
      { x: 640, y: 360 },
      { x: 700, y: 400 },
    ]
    const f1 = [...ids(outer, 'o'), ...ids(inner, 'i')]
    const [r1, r2, r3] = series([f1, ids(outer, 'o'), f1], NO_FILTER)
    expect(r1.polygon).toHaveLength(4)
    expect(r1.measure!.points).toBe(7)
    expect(Object.keys(r2.state.filters)).toEqual(['o0', 'o1', 'o2', 'o3'])
    expect(r2.polygon).toEqual(r1.polygon)
    expect(r3.polygon).toEqual(r1.polygon)
    expect(Object.keys(r3.state.filters)).toHaveLength(7)
  })

  it('dưới minPoints điểm: few-points; điểm ngoài bảng: out-of-board; c = 0 cũng few-points; không đụng trạng thái', () => {
    const [ok] = series([ids(rect(640, 360, 400, 200))])
    const few = solveHull(ids(rect(640, 360, 400, 200)).slice(0, 2), L, ok.state, 2000)
    expect(few).toMatchObject({ polygon: null, reason: 'few-points', measure: null })
    expect(few.state).toBe(ok.state)
    const out = solveHull(ids([...rect(640, 360, 400, 200), { x: -5, y: 360 }]), L, ok.state, 2000)
    expect(out).toMatchObject({ polygon: null, reason: 'out-of-board', measure: null })
    expect(out.state).toBe(ok.state)
    const zero = solveHull(ids(rect(640, 360, 400, 200)), { ...L, c: 0 }, ok.state, 2000)
    expect(zero.reason).toBe('few-points')
    // minPoints tùy chọn không xuống dưới 3.
    expect(
      solveHull(ids(rect(640, 360, 400, 200)).slice(0, 2), L, INITIAL_HULL_STATE, 1000, {
        minPoints: 1,
      }).reason,
    ).toBe('few-points')
  })

  it('điểm gần trùng, gần thẳng hàng hay quá gần: too-small (cạnh ngắn hộp bao dưới nMin ô hoặc diện tích dưới nMin² / 2)', () => {
    const tiny = series([ids(rect(640, 360, 30, 30))], NO_FILTER)[0]
    expect(tiny).toMatchObject({ polygon: null, reason: 'too-small' })
    expect(tiny.measure!.shortCells).toBe(1.5)
    expect(tiny.state.open).toBe(false)
    // Thẳng hàng: bao lồi không thành đa giác → too-small.
    const line = series(
      [
        ids([
          { x: 400, y: 300 },
          { x: 600, y: 400 },
          { x: 800, y: 500 },
        ]),
      ],
      NO_FILTER,
    )[0]
    expect(line).toMatchObject({ polygon: null, reason: 'too-small' })
    // Hộp bao đủ cỡ nhưng bốn điểm gần thẳng hàng theo đường chéo (diện tích 1,8 ô² < 4,5): too-small.
    const thin = series(
      [
        ids([
          { x: 400, y: 300 },
          { x: 880, y: 420 },
          { x: 402, y: 302 },
          { x: 878, y: 418 },
        ]),
      ],
      NO_FILTER,
    )[0]
    expect(thin.measure!.shortCells).toBe(6)
    expect(thin.reason).toBe('too-small')
    // Đủ: 3 × 3 ô vuông.
    const ok = series([ids(rect(640, 360, 60, 60))], NO_FILTER)[0]
    expect(ok.polygon).toHaveLength(4)
  })

  it('too-small có hysteresis khi đang mở: xuống dưới nMin − 0,25 ô mới đóng; mở lại cần đủ nMin', () => {
    const rs = series(
      [
        ids(rect(640, 360, 200, 64)), // 3,2 ô: mở
        ids(rect(640, 360, 200, 56)), // 2,8 ô ≥ 2,75: giữ
        ids(rect(640, 360, 200, 54)), // 2,7 < 2,75: đóng
        ids(rect(640, 360, 200, 58)), // 2,9 < 3: chưa mở lại
        ids(rect(640, 360, 200, 64)), // 3,2 ≥ 3: mở
      ],
      NO_FILTER,
    )
    expect(rs.map((r) => (r.polygon ? 'open' : r.reason))).toEqual([
      'open',
      'open',
      'too-small',
      'too-small',
      'open',
    ])
  })

  it('One Euro: rung ±3 px quanh vị trí giảm biên độ nhiều lần; đứng yên thì đa giác đúng bằng điểm thô', () => {
    const base = rect(640, 360, 400, 200)
    const frames = Array.from({ length: 60 }, (_, i) =>
      ids(base.map((p) => ({ x: p.x + (i % 2 ? 3 : -3), y: p.y + (i % 2 ? -3 : 3) }))),
    )
    const rs = series(frames)
    const last = rs[rs.length - 1].measure!
    const err = Math.max(...last.filtered.map((p, i) => Math.abs(p.x - base[i].x)))
    expect(err).toBeLessThan(1)
    const still = series(Array.from({ length: 30 }, () => ids(base)))
    expect(still[29].polygon).toEqual(convexHull(base))
  })
})
