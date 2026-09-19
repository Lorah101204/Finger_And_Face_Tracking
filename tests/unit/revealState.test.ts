import { describe, expect, it } from 'vitest'
import { createEpochCounter } from '../../src/core/epoch'
import { computeLayout } from '../../src/core/coords'
import { closedState, stepReveal } from '../../src/core/revealState'
import type { RevealMask, RevealState } from '../../src/core/types'
import { buildMask, windowShape } from '../../src/mask/buildMask'

// Mục 4.6 và sơ đồ 5.7: chỉ closed → open và các lý do tab-hidden, no-camera, user làm tăng epoch ở đây;
// config-changed đã tăng ở store (D-027); lý do do tay không tăng.
const L = computeLayout({ w: 1280, h: 720 }, { cols: 64, rows: 36 }, { w: 1280, h: 720 })
const maskAt = (epoch: number, n = 8): RevealMask =>
  buildMask(windowShape({ col: 1, row: 2, n }), L, false, epoch)

describe('stepReveal', () => {
  it('closed → open: epoch++ trước khi tạo mask, mask mang epoch mới', () => {
    const epoch = createEpochCounter(5)
    const step = stepReveal(closedState('user'), { kind: 'open', build: maskAt }, epoch)
    expect(step.opened).toBe(true)
    expect(step.epochBumped).toBe(true)
    expect(epoch.current).toBe(6)
    expect(step.state).toEqual({ kind: 'open', mask: maskAt(6) })
  })

  it('open → open: cửa sổ đổi, epoch giữ nguyên, mask thay mới', () => {
    const epoch = createEpochCounter(6)
    const open: RevealState = { kind: 'open', mask: maskAt(6) }
    const step = stepReveal(open, { kind: 'open', build: (e) => maskAt(e, 10) }, epoch)
    expect(step.opened).toBe(false)
    expect(step.epochBumped).toBe(false)
    expect(epoch.current).toBe(6)
    expect(
      step.state.kind === 'open' &&
        step.state.mask.shape.kind === 'window' &&
        step.state.mask.shape.window.n,
    ).toBe(10)
  })

  it('open → closed vì tay: đóng, không tăng epoch', () => {
    for (const reason of [
      'few-points',
      'stale-point',
      'out-of-board',
      'too-small',
      'ambiguous-hands',
    ] as const) {
      const epoch = createEpochCounter(6)
      const step = stepReveal({ kind: 'open', mask: maskAt(6) }, { kind: 'close', reason }, epoch)
      expect(step.closed).toBe(true)
      expect(step.epochBumped).toBe(false)
      expect(epoch.current).toBe(6)
      expect(step.state).toEqual({ kind: 'closed', reason })
    }
  })

  it('open → closed vì tab ẩn, camera dừng, người dùng: đóng và epoch++', () => {
    for (const reason of ['tab-hidden', 'no-camera', 'user'] as const) {
      const epoch = createEpochCounter(6)
      const step = stepReveal({ kind: 'open', mask: maskAt(6) }, { kind: 'close', reason }, epoch)
      expect(step.closed).toBe(true)
      expect(step.epochBumped).toBe(true)
      expect(epoch.current).toBe(7)
    }
  })

  it('open → closed vì config-changed: đóng, epoch do store tăng nên ở đây không tăng', () => {
    const epoch = createEpochCounter(6)
    const step = stepReveal(
      { kind: 'open', mask: maskAt(6) },
      { kind: 'close', reason: 'config-changed' },
      epoch,
    )
    expect(step.closed).toBe(true)
    expect(step.epochBumped).toBe(false)
    expect(epoch.current).toBe(6)
  })

  it('closed → closed: chỉ đổi lý do, giữ nguyên đối tượng khi cùng lý do, không tăng epoch', () => {
    const epoch = createEpochCounter(6)
    const prev = closedState('user')
    const same = stepReveal(prev, { kind: 'close', reason: 'user' }, epoch)
    expect(same.state).toBe(prev)
    const other = stepReveal(prev, { kind: 'close', reason: 'no-camera' }, epoch)
    expect(other.state).toEqual({ kind: 'closed', reason: 'no-camera' })
    expect(other.closed).toBe(false)
    expect(epoch.current).toBe(6)
  })
})
