import { describe, expect, it } from 'vitest'
import { DEFAULTS } from '../../src/core/config'

// SETUP-00: test mẫu, kiểm tra cấu hình mặc định khớp docs/WORK-BREAKDOWN.md mục 3.
describe('DEFAULTS', () => {
  it('lưới mặc định 64 × 36; năm đầu ngón của hai tay, ít nhất 3 điểm (ROI-03)', () => {
    expect(DEFAULTS.grid.cols).toBe(64)
    expect(DEFAULTS.grid.rows).toBe(36)
    expect(DEFAULTS.hands.fingers).toEqual([4, 8, 12, 16, 20])
    expect(DEFAULTS.hands.minHands).toBe(2)
    expect(DEFAULTS.reveal.minPoints).toBe(3)
  })

  it('ngưỡng tuổi điểm, tuổi kết quả và ROI tối thiểu', () => {
    expect(DEFAULTS.freshness.pointMaxAgeMs).toBe(150)
    expect(DEFAULTS.freshness.faceResultMaxAgeMs).toBe(250)
    expect(DEFAULTS.face.minRoiPx).toBe(64)
    expect(DEFAULTS.reveal.nMin).toBe(3)
  })

  it('phạm vi đồng ý mặc định là device (D-021) và watchdog camera 500 ms (D-011)', () => {
    expect(DEFAULTS.consent.scope).toBe('device')
    expect(DEFAULTS.camera.noFrameWatchdogMs).toBe(500)
  })

  // QA-02 (D-045): tuổi điểm và tuổi nhãn là tuổi kể từ kết quả gần nhất nên phải chứa ít nhất hai nhịp của đường
  // ống (một kết quả bỏ lỡ không làm vùng đóng hay nhãn mất); tuổi kết quả mặt và phân loại là tuổi lúc về (trễ suy
  // luận) nên ít nhất bằng một nhịp; số đo thật ở docs/benchmark.md mục 6.
  it('tuổi điểm, tuổi kết quả và tuổi nhãn nhất quán với nhịp mục tiêu (QA-02)', () => {
    const HAND_TARGET_HZ = 20
    const HAND_CPU_HZ = 10
    expect(DEFAULTS.freshness.pointMaxAgeMs).toBeGreaterThanOrEqual(2 * (1000 / HAND_TARGET_HZ))
    expect(DEFAULTS.freshness.pointMaxAgeMsCpu).toBeGreaterThanOrEqual(2 * (1000 / HAND_CPU_HZ))
    expect(DEFAULTS.hands.trackDropMs).toBe(DEFAULTS.freshness.pointMaxAgeMs)
    expect(DEFAULTS.freshness.faceResultMaxAgeMs).toBeGreaterThanOrEqual(
      1000 / DEFAULTS.face.targetHz,
    )
    expect(DEFAULTS.classifier.resultMaxAgeMs).toBeGreaterThanOrEqual(
      1000 / DEFAULTS.classifier.targetHz,
    )
    expect(DEFAULTS.classifier.labelMaxAgeMs).toBeGreaterThanOrEqual(
      2 * (1000 / DEFAULTS.classifier.targetHz),
    )
    // Hysteresis theo ô (D-038) nằm trong (0, 0,5): dưới 0,5 ô để cửa sổ vẫn theo tay, trên 0 để không nhấp nháy.
    expect(DEFAULTS.reveal.hysteresisCells).toBeGreaterThan(0)
    expect(DEFAULTS.reveal.hysteresisCells).toBeLessThan(0.5)
  })
})
