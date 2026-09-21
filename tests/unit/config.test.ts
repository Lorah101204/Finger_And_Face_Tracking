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

// ROI-04 (D-055): công tắc bật mặc định; ngưỡng gập thấp hơn ngưỡng duỗi (dải Schmitt); debounce ≥ 1 và ngắn hơn
// tuổi điểm ở nhịp tay mục tiêu (3 frame ở 20 Hz = 150 ms).
describe('hands.pose (ROI-04)', () => {
  it('raisedOnly true; ngưỡng theo cặp thấp < cao; debounceFrames × 50 ms ≤ tuổi điểm', () => {
    const p = DEFAULTS.hands.pose
    expect(DEFAULTS.hands.raisedOnly).toBe(true)
    expect(p.ratioFolded).toBeLessThan(p.ratioRaised)
    expect(p.angleFolded).toBeLessThan(p.angleRaised)
    expect(p.abductionFolded).toBeLessThan(p.abductionRaised)
    expect(p.debounceFrames).toBeGreaterThanOrEqual(1)
    expect(p.debounceFrames * 50).toBeLessThanOrEqual(DEFAULTS.freshness.pointMaxAgeMs)
  })

  it('BRAND-01: logo bật, 30 % bề rộng stage, neo góc, font dự phòng sau Heavitas, textLength dương', () => {
    const b = DEFAULTS.brand.logo
    expect(b.enabled).toBe(true)
    expect(b.widthRatio).toBeGreaterThan(0)
    expect(b.widthRatio).toBeLessThanOrEqual(1)
    expect(b.maxHeightRatio).toBeGreaterThan(0)
    expect(b.maxHeightRatio).toBeLessThanOrEqual(1)
    expect(b.marginRatio).toBeGreaterThanOrEqual(0)
    expect(b.marginRatio).toBeLessThan(0.5)
    expect(['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center']).toContain(b.anchor)
    // D-058: khớp ô chỉ khi 21 k ô không vượt snapMaxWidthRatio; phải ≥ widthRatio để lưới vừa vẫn khớp được.
    expect(b.snapMaxWidthRatio).toBeGreaterThanOrEqual(b.widthRatio)
    expect(b.snapMaxWidthRatio).toBeLessThanOrEqual(1)
    expect(b.fonts).toMatch(/^Heavitas,/)
    expect(b.textLength).toBeGreaterThan(0)
  })
})
