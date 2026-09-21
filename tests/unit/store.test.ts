import { describe, expect, it } from 'vitest'
import { createEpochCounter } from '../../src/core/epoch'
import { createStageStore } from '../../src/loop/store'

// GRID-01: store sân khấu; quy tắc epoch của mục 3 (đổi camera, mirror, grid, layout: epoch++; vạch lưới: không).
describe('createStageStore', () => {
  it('mặc định 64 × 36, vạch lưới bật, mirror bật; layout dùng camera mặc định khi chưa có camera', () => {
    const store = createStageStore(createEpochCounter())
    const s = store.getSnapshot()
    expect(s.settings).toEqual({
      cols: 64,
      rows: 36,
      showLines: true,
      mirror: true,
      windowSource: 'mouse',
      handednessSwap: false,
      fingers: [4, 8, 12, 16, 20],
      raisedOnly: true,
      sensitivity: {
        minCutoff: 1,
        beta: 0.02,
        hysteresisCells: 0.25,
        nMin: 3,
        pointMaxAgeMs: 150,
      },
    })
    expect(s.camSize).toBeNull()
    expect(s.layout.cam).toEqual({ w: 1280, h: 720 })
    expect(s.epoch).toBe(0)
  })

  it('kích thước stage đổi thì layout tính lại và epoch++', () => {
    const epoch = createEpochCounter()
    const store = createStageStore(epoch)
    let calls = 0
    store.subscribe(() => calls++)
    store.setStageSize({ w: 1280, h: 720 })
    expect(store.getSnapshot().layout.c).toBe(20)
    expect(store.getSnapshot().epoch).toBe(1)
    store.setStageSize({ w: 1280, h: 720 })
    expect(store.getSnapshot().epoch).toBe(1)
    expect(calls).toBe(1)
  })

  it('cols, rows, mirror, nguồn cửa sổ, slot làm epoch++ và kẹp trong giới hạn; showLines, đảo tay, độ nhạy không đổi epoch', () => {
    const store = createStageStore(createEpochCounter())
    store.setStageSize({ w: 1280, h: 720 })
    const e0 = store.getSnapshot().epoch
    store.setSettings({ showLines: false })
    expect(store.getSnapshot().settings.showLines).toBe(false)
    expect(store.getSnapshot().epoch).toBe(e0)
    store.setSettings({ cols: 32, rows: 18 })
    expect(store.getSnapshot().epoch).toBe(e0 + 1)
    expect(store.getSnapshot().layout.c).toBe(40)
    store.setSettings({ mirror: false })
    expect(store.getSnapshot().epoch).toBe(e0 + 2)
    store.setSettings({ cols: 1000 })
    expect(store.getSnapshot().settings.cols).toBe(256)
    expect(store.getSnapshot().epoch).toBe(e0 + 3)
    store.setSettings({ cols: 256 })
    expect(store.getSnapshot().epoch).toBe(e0 + 3)
    // INT-01: đổi nguồn cửa sổ là đổi cấu hình: epoch++ (không tính lại layout); đặt lại cùng nguồn thì không.
    const layoutBeforeSource = store.getSnapshot().layout
    store.setSettings({ windowSource: 'hands' })
    expect(store.getSnapshot().settings.windowSource).toBe('hands')
    expect(store.getSnapshot().epoch).toBe(e0 + 4)
    expect(store.getSnapshot().layout).toBe(layoutBeforeSource)
    store.setSettings({ windowSource: 'hands' })
    expect(store.getSnapshot().epoch).toBe(e0 + 4)
    // HAND-01: cờ đảo trái/phải phát snapshot mới nhưng không đổi epoch.
    const eBefore = store.getSnapshot().epoch
    store.setSettings({ handednessSwap: true })
    expect(store.getSnapshot().settings.handednessSwap).toBe(true)
    expect(store.getSnapshot().epoch).toBe(eBefore)
    // ROI-03 (UC-03): đổi đầu ngón dùng thì epoch++ (không tính lại layout); cùng giá trị thì giữ object; danh sách
    // được sắp, bỏ trùng, bỏ chỉ số lạ; rỗng thì về mặc định.
    const fingers = store.getSnapshot().settings.fingers
    store.setSettings({ fingers: [...fingers] })
    expect(store.getSnapshot().epoch).toBe(eBefore)
    expect(store.getSnapshot().settings.fingers).toBe(fingers)
    const layoutBefore = store.getSnapshot().layout
    store.setSettings({ fingers: [20, 4, 4, 7 as never] })
    expect(store.getSnapshot().settings.fingers).toEqual([4, 20])
    expect(store.getSnapshot().epoch).toBe(eBefore + 1)
    expect(store.getSnapshot().layout).toBe(layoutBefore)
    // ROI-01 (UC-09): độ nhạy kẹp trong giới hạn, phát snapshot mới, không đổi epoch; cùng giá trị thì giữ object.
    const sens = store.getSnapshot().settings.sensitivity
    store.setSettings({ sensitivity: { ...sens } })
    expect(store.getSnapshot().settings.sensitivity).toBe(sens)
    store.setSettings({ sensitivity: { ...sens, nMin: 5.7, pointMaxAgeMs: 99999, beta: NaN } })
    expect(store.getSnapshot().settings.sensitivity).toEqual({
      ...sens,
      nMin: 5,
      pointMaxAgeMs: 2000,
    })
    expect(store.getSnapshot().epoch).toBe(eBefore + 1)
    // Tổng: preset, custom (hai lần), mirror, nguồn cửa sổ và slot; showLines, đảo tay, độ nhạy không tính.
    expect(store.getSnapshot().epoch).toBe(e0 + 5)
  })

  it('kích thước camera đổi thì epoch++ và layout dùng camera thật; null quay về camera mặc định', () => {
    const store = createStageStore(createEpochCounter())
    store.setStageSize({ w: 1280, h: 720 })
    const e0 = store.getSnapshot().epoch
    let calls = 0
    store.subscribe(() => calls++)
    store.setCamSize({ w: 640, h: 480 })
    expect(store.getSnapshot().layout.cam).toEqual({ w: 640, h: 480 })
    expect(store.getSnapshot().layout.camVisibleRect.h).toBeCloseTo(360, 9)
    expect(store.getSnapshot().epoch).toBe(e0 + 1)
    store.setCamSize({ w: 640, h: 480 })
    expect(store.getSnapshot().epoch).toBe(e0 + 1)
    expect(calls).toBe(2)
    store.setCamSize(null)
    expect(store.getSnapshot().layout.cam).toEqual({ w: 1280, h: 720 })
    expect(store.getSnapshot().epoch).toBe(e0 + 2)
  })
})

// ROI-04 (mục 7.32): công tắc "Chỉ ngón đang giơ" là cấu hình như đầu ngón dùng: đổi thì epoch++, không đổi thì thôi.
describe('raisedOnly (ROI-04)', () => {
  it('mặc định bật; đổi thì epoch++; đặt lại cùng giá trị không đổi epoch', () => {
    const store = createStageStore(createEpochCounter())
    expect(store.getSnapshot().settings.raisedOnly).toBe(true)
    const e0 = store.getSnapshot().epoch
    store.setSettings({ raisedOnly: true })
    expect(store.getSnapshot().epoch).toBe(e0)
    store.setSettings({ raisedOnly: false })
    expect(store.getSnapshot().settings.raisedOnly).toBe(false)
    expect(store.getSnapshot().epoch).toBe(e0 + 1)
    store.setSettings({ raisedOnly: true })
    expect(store.getSnapshot().epoch).toBe(e0 + 2)
  })
})
