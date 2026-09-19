import { describe, expect, it } from 'vitest'
import type { CameraSnapshot } from '../../src/camera/cameraState'
import { cameraGate, visibilityGate, type DocumentLike } from '../../src/loop/closeGate'

// INT-01 (mục 7.16): gate đóng vùng theo camera và tab, thuần với đối tượng tối thiểu.
type Snap = Pick<CameraSnapshot, 'state' | 'stalled' | 'hidden'>

function fakeCamera(initial: Snap) {
  let snap = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snap,
    subscribe(fn: () => void) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    set(next: Partial<Snap>) {
      snap = { ...snap, ...next }
      for (const l of listeners) l()
    },
    get listeners() {
      return listeners.size
    },
  }
}

const ACTIVE: Snap['state'] = {
  status: 'active',
  deviceId: 'a',
  label: 'a',
  width: 1280,
  height: 720,
  frameRate: 30,
}

describe('cameraGate', () => {
  it('theo cameraCloseReason: active và có frame → null; dừng, stalled → no-camera; tab ẩn ưu tiên → tab-hidden; báo qua subscribe', () => {
    const cam = fakeCamera({ state: ACTIVE, stalled: false, hidden: false })
    const gate = cameraGate(cam)
    expect(gate.reason()).toBeNull()
    let calls = 0
    const off = gate.subscribe(() => calls++)
    cam.set({ stalled: true })
    expect(calls).toBe(1)
    expect(gate.reason()).toBe('no-camera')
    cam.set({ stalled: false, hidden: true })
    expect(gate.reason()).toBe('tab-hidden')
    cam.set({ state: { status: 'idle' } })
    expect(gate.reason()).toBe('tab-hidden')
    cam.set({ hidden: false })
    expect(gate.reason()).toBe('no-camera')
    cam.set({ state: { status: 'requesting', deviceId: null } })
    expect(gate.reason()).toBe('no-camera')
    expect(calls).toBe(5)
    off()
    expect(cam.listeners).toBe(0)
  })
})

describe('visibilityGate', () => {
  it('tab ẩn → tab-hidden, hiện → null; đăng ký và hủy đăng ký visibilitychange', () => {
    const handlers = new Set<() => void>()
    let state = 'visible'
    const doc: DocumentLike = {
      get visibilityState() {
        return state
      },
      addEventListener: (_t, fn) => {
        handlers.add(fn)
      },
      removeEventListener: (_t, fn) => {
        handlers.delete(fn)
      },
    }
    const gate = visibilityGate(doc)
    expect(gate.reason()).toBeNull()
    let calls = 0
    const off = gate.subscribe(() => calls++)
    expect(handlers.size).toBe(1)
    state = 'hidden'
    for (const h of handlers) h()
    expect(calls).toBe(1)
    expect(gate.reason()).toBe('tab-hidden')
    state = 'visible'
    expect(gate.reason()).toBeNull()
    off()
    expect(handlers.size).toBe(0)
  })
})
