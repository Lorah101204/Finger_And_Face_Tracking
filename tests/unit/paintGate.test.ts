import { describe, expect, it } from 'vitest'
import type { FingerStatus, HandFrame, RevealMask, ValidatedFace } from '../../src/core/types'
import type { Layout } from '../../src/core/coords'
import type { LogoPainter, RenderOptions } from '../../src/mask/compositor'
import {
  createPaintGate,
  emptyPaintKey,
  fingersSignature,
  type PaintKey,
} from '../../src/loop/paintGate'

// PERF-04 (mục 7.37, D-064): chỉ vẽ khi khóa của hình đổi (điểm bất động của One Euro: oneEuro.test.ts).

/** Mỗi trường của RenderOptions phải có chỗ trong khóa (tsc báo lỗi khi compositor nhận trường mới mà khóa chưa có). */
const RENDER_FIELD_IN_KEY: Record<keyof RenderOptions, keyof PaintKey> = {
  showLines: 'showLines',
  mirror: 'mirror',
  drawable: 'drawable',
  mask: 'mask',
  faces: 'faces',
  hands: 'hands',
  now: 'handsStale',
  fingers: 'fingers',
  lang: 'lang',
  logo: 'logo',
}

const layout = { c: 20 } as unknown as Layout
const finger = (x: number, y: number, over: Partial<FingerStatus> = {}): FingerStatus => ({
  hand: 'left',
  trackId: 1,
  tip: 8,
  valid: true,
  pStage: { x, y },
  pCam: { x, y },
  ts: 0,
  ageMs: 0,
  score: 0.9,
  ...over,
})

function key(over: Partial<PaintKey> = {}): PaintKey {
  return { ...emptyPaintKey(), layout, ...over }
}

describe('createPaintGate', () => {
  it('lần đầu luôn vẽ; khóa y hệt sau commit thì không vẽ; invalidate thì vẽ lại', () => {
    const g = createPaintGate()
    const k = key()
    expect(g.changed(k)).toBe(true)
    g.commit(k)
    expect(g.changed(k)).toBe(false)
    expect(g.changed(key())).toBe(false)
    g.invalidate()
    expect(g.changed(k)).toBe(true)
  })

  it('mỗi trường vô hướng hay đối tượng của khóa đổi thì vẽ', () => {
    const mask = {} as RevealMask
    const drawable = {} as CanvasImageSource
    const faces: ValidatedFace[] = []
    const hands = { ts: 0, hands: [] } as unknown as HandFrame
    const logo = { version: 1 } as unknown as LogoPainter
    const variants: Partial<PaintKey>[] = [
      { layout: { c: 10 } as unknown as Layout },
      { showLines: true },
      { mirror: true },
      { lang: 'en' },
      { logo },
      { logoVersion: 2 },
      { mask },
      { drawable },
      { camFrame: 5 },
      { faces },
      { hands },
      { handsStale: true },
    ]
    for (const v of variants) {
      const g = createPaintGate()
      g.commit(key())
      expect(g.changed(key(v)), JSON.stringify(Object.keys(v))).toBe(true)
    }
    // Đủ mười hai trường đơn cộng đầu ngón: mọi trường của PaintKey đều được thử.
    const tested = new Set(variants.flatMap((v) => Object.keys(v)).concat('fingers'))
    expect([...tested].sort()).toEqual(Object.keys(emptyPaintKey()).sort())
    expect(new Set(Object.values(RENDER_FIELD_IN_KEY)).size).toBe(10)
  })

  it('đầu ngón so theo giá trị đúng như drawFingertips vẽ: mảng mới cùng giá trị, dời dưới nửa px thì không vẽ', () => {
    const g = createPaintGate()
    g.commit(key({ fingers: [finger(100.2, 50.4)] }))
    expect(g.changed(key({ fingers: [finger(100.2, 50.4)] }))).toBe(false)
    expect(g.changed(key({ fingers: [finger(99.6, 50.2)] }))).toBe(false) // cùng làm tròn về (100, 50)
    expect(g.changed(key({ fingers: [finger(100.6, 50.4)] }))).toBe(true)
    expect(g.changed(key({ fingers: [finger(100.2, 50.4, { valid: false })] }))).toBe(true)
    expect(g.changed(key({ fingers: [finger(100.2, 50.4, { reason: 'folded' })] }))).toBe(true)
    expect(g.changed(key({ fingers: [finger(100.2, 50.4, { hand: 'right' })] }))).toBe(true)
    expect(g.changed(key({ fingers: [] }))).toBe(true)
    // Trường không được vẽ (score, tuổi, pCam) không làm vẽ lại.
    expect(g.changed(key({ fingers: [finger(100.2, 50.4, { score: 0.1, ageMs: 300 })] }))).toBe(
      false,
    )
  })

  it('commit sau changed thoát sớm vẫn ghi đúng chữ ký đầu ngón', () => {
    const g = createPaintGate()
    g.commit(key({ fingers: [finger(10, 10)] }))
    const k = key({ mirror: true, fingers: [finger(20, 20)] })
    expect(g.changed(k)).toBe(true) // thoát ở mirror, chưa tính chữ ký
    g.commit(k)
    expect(g.changed(key({ mirror: true, fingers: [finger(20, 20)] }))).toBe(false)
    expect(g.changed(key({ mirror: true, fingers: [finger(10, 10)] }))).toBe(true)
  })

  it('fingersSignature dùng lại mảng ra', () => {
    const out: number[] = [9, 9, 9, 9, 9, 9, 9, 9, 9]
    expect(fingersSignature([finger(1.4, 2.6, { hand: 'right', valid: false })], out)).toBe(out)
    expect(out).toEqual([1, 1, 0, 1, 3])
  })
})
