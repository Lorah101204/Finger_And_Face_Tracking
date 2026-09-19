import { describe, expect, it } from 'vitest'
import { createEpochCounter } from '../../src/core/epoch'

describe('createEpochCounter', () => {
  it('bắt đầu ở 0, bump tăng một và trả giá trị mới', () => {
    const e = createEpochCounter()
    expect(e.current).toBe(0)
    expect(e.bump()).toBe(1)
    expect(e.bump()).toBe(2)
    expect(e.current).toBe(2)
  })

  it('nhận giá trị khởi đầu', () => {
    const e = createEpochCounter(10)
    expect(e.current).toBe(10)
    expect(e.bump()).toBe(11)
  })
})
