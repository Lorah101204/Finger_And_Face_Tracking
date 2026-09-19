import { describe, expect, it } from 'vitest'
import {
  IDLE,
  cameraCloseReason,
  classifyCameraError,
  leftActive,
  reduceCamera,
  type CameraState,
} from '../../src/camera/cameraState'

// CAM-01: máy trạng thái camera (mục 5.5, D-025) và các hàm thuần đi kèm.
const STREAM = {
  type: 'stream',
  deviceId: 'cam1',
  label: 'Cam 1',
  width: 1280,
  height: 720,
  frameRate: 30,
} as const

const REQUESTING = reduceCamera(IDLE, { type: 'start', deviceId: 'cam1' })
const ACTIVE = reduceCamera(REQUESTING, STREAM)

describe('reduceCamera', () => {
  it('idle → requesting → active', () => {
    expect(REQUESTING).toEqual({ status: 'requesting', deviceId: 'cam1' })
    expect(ACTIVE).toEqual({
      status: 'active',
      deviceId: 'cam1',
      label: 'Cam 1',
      width: 1280,
      height: 720,
      frameRate: 30,
    })
  })

  it('requesting → error khi getUserMedia lỗi', () => {
    const err = reduceCamera(REQUESTING, { type: 'fail', kind: 'not-allowed', message: 'denied' })
    expect(err).toEqual({ status: 'error', kind: 'not-allowed', message: 'denied' })
  })

  it('active → ended khi track kết thúc hoặc rút thiết bị', () => {
    expect(reduceCamera(ACTIVE, { type: 'track-ended' })).toEqual({
      status: 'ended',
      reason: 'track-ended',
    })
    expect(reduceCamera(ACTIVE, { type: 'device-removed' })).toEqual({
      status: 'ended',
      reason: 'device-removed',
    })
  })

  it('active → requesting khi đổi camera; ended và error thử lại được', () => {
    expect(reduceCamera(ACTIVE, { type: 'start', deviceId: 'cam2' })).toEqual({
      status: 'requesting',
      deviceId: 'cam2',
    })
    const ended = reduceCamera(ACTIVE, { type: 'track-ended' })
    expect(reduceCamera(ended, { type: 'start', deviceId: null }).status).toBe('requesting')
    const error = reduceCamera(REQUESTING, { type: 'fail', kind: 'unknown', message: 'x' })
    expect(reduceCamera(error, { type: 'start', deviceId: null }).status).toBe('requesting')
  })

  it('stop về idle từ mọi trạng thái', () => {
    const all: CameraState[] = [
      IDLE,
      REQUESTING,
      ACTIVE,
      reduceCamera(ACTIVE, { type: 'track-ended' }),
      reduceCamera(REQUESTING, { type: 'fail', kind: 'unknown', message: 'x' }),
    ]
    for (const s of all) expect(reduceCamera(s, { type: 'stop' })).toEqual({ status: 'idle' })
  })

  it('sự kiện sai trạng thái bị bỏ qua và trả về đúng đối tượng cũ', () => {
    expect(reduceCamera(IDLE, STREAM)).toBe(IDLE)
    expect(reduceCamera(REQUESTING, { type: 'track-ended' })).toBe(REQUESTING)
    expect(reduceCamera(ACTIVE, { type: 'fail', kind: 'unknown', message: 'x' })).toBe(ACTIVE)
    expect(reduceCamera(IDLE, { type: 'dimensions', width: 1, height: 1 })).toBe(IDLE)
  })

  it('dimensions cập nhật khi khác, giữ nguyên đối tượng khi bằng', () => {
    expect(reduceCamera(ACTIVE, { type: 'dimensions', width: 1280, height: 720 })).toBe(ACTIVE)
    const changed = reduceCamera(ACTIVE, { type: 'dimensions', width: 640, height: 480 })
    expect(changed).toMatchObject({ status: 'active', width: 640, height: 480, deviceId: 'cam1' })
  })
})

describe('leftActive', () => {
  it('đúng ở mọi lối ra khỏi active, sai ở các chuyển khác', () => {
    expect(leftActive(ACTIVE, reduceCamera(ACTIVE, { type: 'track-ended' }))).toBe(true)
    expect(leftActive(ACTIVE, reduceCamera(ACTIVE, { type: 'start', deviceId: 'cam2' }))).toBe(true)
    expect(leftActive(ACTIVE, reduceCamera(ACTIVE, { type: 'stop' }))).toBe(true)
    expect(leftActive(ACTIVE, ACTIVE)).toBe(false)
    expect(
      leftActive(
        REQUESTING,
        reduceCamera(REQUESTING, { type: 'fail', kind: 'unknown', message: '' }),
      ),
    ).toBe(false)
    expect(leftActive(IDLE, REQUESTING)).toBe(false)
  })
})

describe('cameraCloseReason', () => {
  it('null khi active và có frame; no-camera khi stalled hoặc chưa active; tab-hidden ưu tiên', () => {
    expect(cameraCloseReason({ state: ACTIVE, stalled: false, hidden: false })).toBeNull()
    expect(cameraCloseReason({ state: ACTIVE, stalled: true, hidden: false })).toBe('no-camera')
    expect(cameraCloseReason({ state: IDLE, stalled: false, hidden: false })).toBe('no-camera')
    expect(cameraCloseReason({ state: REQUESTING, stalled: false, hidden: false })).toBe(
      'no-camera',
    )
    expect(cameraCloseReason({ state: ACTIVE, stalled: true, hidden: true })).toBe('tab-hidden')
  })
})

describe('classifyCameraError', () => {
  const named = (name: string) => Object.assign(new Error(name.toLowerCase()), { name })
  it('ánh xạ tên DOMException sang loại lỗi', () => {
    expect(classifyCameraError(named('NotAllowedError')).kind).toBe('not-allowed')
    expect(classifyCameraError(named('SecurityError')).kind).toBe('not-allowed')
    expect(classifyCameraError(named('NotFoundError')).kind).toBe('not-found')
    expect(classifyCameraError(named('OverconstrainedError')).kind).toBe('overconstrained')
    expect(classifyCameraError(named('NotReadableError')).kind).toBe('not-readable')
    expect(classifyCameraError(named('AbortError')).kind).toBe('not-readable')
    expect(classifyCameraError(named('SomethingElse'))).toEqual({
      kind: 'unknown',
      message: 'somethingelse',
    })
    expect(classifyCameraError('chuỗi')).toEqual({ kind: 'unknown', message: 'chuỗi' })
  })
})
