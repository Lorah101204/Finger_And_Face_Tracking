import { describe, expect, it } from 'vitest'
import { softmax } from '../../src/classify/classifierProtocol'
import { decideSubject, subjectText } from '../../src/classify/subjectRule'
import { DEFAULTS, isDemoClassifier } from '../../src/core/config'

// CLS-02 bước 2 (mục 7.23): quy tắc unknown thuần, không có đầu vào chuyển động: max(prob) < 0,7, cạnh ROI < 96 px,
// mặt partial nhìn thấy dưới 60 %; ngược lại argmax theo thứ tự nhãn [person, mannequin].
describe('decideSubject', () => {
  it('chưa có kết quả → unknown, độ tin cậy 0', () => {
    expect(decideSubject({ probs: null, roiShortPx: 300 })).toEqual({
      subjectType: 'unknown',
      confidence: 0,
      reason: 'no-result',
    })
    expect(decideSubject({ probs: [], roiShortPx: 300 }).reason).toBe('no-result')
  })

  it('argmax theo nhãn với độ tin cậy = max(prob); dưới ngưỡng 0,7 → unknown low-confidence', () => {
    expect(decideSubject({ probs: [0.93, 0.07], roiShortPx: 300 })).toEqual({
      subjectType: 'person',
      confidence: 0.93,
      reason: null,
    })
    expect(decideSubject({ probs: [0.2, 0.8], roiShortPx: 300 })).toMatchObject({
      subjectType: 'mannequin',
      confidence: 0.8,
    })
    expect(decideSubject({ probs: [0.69, 0.31], roiShortPx: 300 })).toMatchObject({
      subjectType: 'unknown',
      confidence: 0.69,
      reason: 'low-confidence',
    })
    expect(decideSubject({ probs: [0.7, 0.3], roiShortPx: 300 }).subjectType).toBe('person')
    expect(decideSubject({ probs: [0.5, 0.5], roiShortPx: 300 }).reason).toBe('low-confidence')
  })

  it('ROI nhỏ hơn minRoiPx → unknown dù rất chắc; ngưỡng theo DEFAULTS và ghi đè được', () => {
    expect(decideSubject({ probs: [0.99, 0.01], roiShortPx: 95 })).toMatchObject({
      subjectType: 'unknown',
      reason: 'roi-small',
      confidence: 0.99,
    })
    expect(decideSubject({ probs: [0.99, 0.01], roiShortPx: 96 }).subjectType).toBe('person')
    expect(DEFAULTS.classifier.minRoiPx).toBe(96)
    expect(
      decideSubject({ probs: [0.99, 0.01], roiShortPx: 50 }, { minRoiPx: 40 }).subjectType,
    ).toBe('person')
    expect(
      decideSubject({ probs: [0.75, 0.25], roiShortPx: 300 }, { unknownThreshold: 0.8 }).reason,
    ).toBe('low-confidence')
  })

  it('mặt partial nhìn thấy dưới partialMinVisible → unknown; full hay partial đủ nhìn thấy thì có nhãn', () => {
    expect(
      decideSubject({ probs: [0.9, 0.1], roiShortPx: 300, faceStatus: 'partial', visible: 0.4 }),
    ).toMatchObject({ subjectType: 'unknown', reason: 'partial' })
    expect(
      decideSubject({ probs: [0.9, 0.1], roiShortPx: 300, faceStatus: 'partial', visible: 0.6 })
        .subjectType,
    ).toBe('person')
    expect(
      decideSubject({ probs: [0.9, 0.1], roiShortPx: 300, faceStatus: 'full', visible: 0.1 })
        .subjectType,
    ).toBe('person')
    // Thứ tự ưu tiên: ROI nhỏ trước partial, partial trước ngưỡng.
    expect(
      decideSubject({ probs: [0.6, 0.4], roiShortPx: 50, faceStatus: 'partial', visible: 0.1 })
        .reason,
    ).toBe('roi-small')
    expect(
      decideSubject({ probs: [0.6, 0.4], roiShortPx: 300, faceStatus: 'partial', visible: 0.1 })
        .reason,
    ).toBe('partial')
  })

  it('nhãn theo thứ tự tùy chọn; chỉ số ngoài danh sách → unknown', () => {
    expect(
      decideSubject({ probs: [0.1, 0.9], roiShortPx: 300 }, { labels: ['mannequin', 'person'] })
        .subjectType,
    ).toBe('person')
    expect(
      decideSubject({ probs: [0.1, 0.9], roiShortPx: 300 }, { labels: ['person'] }).reason,
    ).toBe('no-result')
  })
})

describe('subjectText và softmax', () => {
  it('chữ hiển thị kèm phần trăm; unknown không có phần trăm', () => {
    expect(subjectText({ subjectType: 'person', confidence: 0.934 }, false)).toBe('Người 93 %')
    expect(subjectText({ subjectType: 'mannequin', confidence: 0.8 }, false)).toBe('Hình nộm 80 %')
    expect(subjectText({ subjectType: 'unknown', confidence: 0.5 }, false)).toBe(
      'Khuôn mặt chưa phân loại',
    )
    expect(subjectText({ subjectType: 'person' }, false)).toBe('Người')
  })

  it('model stub (mặc định của DEFAULTS hiện tại) thêm hậu tố demo vào mọi nhãn; model thật thì không', () => {
    expect(isDemoClassifier()).toBe(true)
    expect(isDemoClassifier('/models/classifier-stub.onnx')).toBe(true)
    expect(isDemoClassifier('/repo/models/classifier-stub.onnx')).toBe(true)
    expect(isDemoClassifier('/models/classifier.onnx')).toBe(false)
    expect(subjectText({ subjectType: 'person', confidence: 0.934 })).toBe('Người 93 % · demo')
    expect(subjectText({ subjectType: 'unknown' })).toBe('Khuôn mặt chưa phân loại · demo')
    expect(subjectText({ subjectType: 'mannequin', confidence: 0.8 }, true)).toBe(
      'Hình nộm 80 % · demo',
    )
  })

  it('softmax: tổng 1, đơn điệu, ổn định với logits lớn', () => {
    const p = softmax([4.444, -4.444])
    expect(p[0] + p[1]).toBeCloseTo(1, 10)
    expect(p[0]).toBeGreaterThan(0.999)
    expect(softmax([0, 0])).toEqual([0.5, 0.5])
    const big = softmax([1000, 999])
    expect(big[0]).toBeCloseTo(1 / (1 + Math.exp(-1)), 6)
    expect(softmax(new Float32Array([1, 2, 3])).length).toBe(3)
  })
})
