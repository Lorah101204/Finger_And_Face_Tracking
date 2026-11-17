import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULTS } from '../../src/core/config'

// CLS-05 (D-069, D-070, mục 7.42): hằng số mà tools/train dùng để huấn luyện và đánh giá phải bằng hằng số app dùng lúc
// chạy, nếu không thì model được chọn và đánh giá trên một quy tắc khác với quy tắc người dùng thấy. Đọc thẳng mã Python
// (CI không cần Python cho vitest).
const metrics = readFileSync(new URL('../../tools/train/metrics.py', import.meta.url), 'utf8')
const dataset = readFileSync(new URL('../../tools/train/dataset.py', import.meta.url), 'utf8')

function pyNumber(src: string, name: string): number {
  const m = new RegExp(`^${name}\\s*=\\s*([0-9.]+)\\s*$`, 'm').exec(src)
  if (!m) throw new Error(`không thấy ${name}`)
  return Number(m[1])
}

describe('hằng số tools/train khớp app', () => {
  it('ngưỡng theo nhãn của metrics.py bằng DEFAULTS.classifier.thresholds', () => {
    const m = /^THRESHOLDS\s*=\s*\{([^}]*)\}/m.exec(metrics)
    expect(m).not.toBeNull()
    const py = Object.fromEntries(
      [...m![1].matchAll(/"(\w+)"\s*:\s*([0-9.]+)/g)].map((x) => [x[1], Number(x[2])]),
    )
    expect(py).toEqual(DEFAULTS.classifier.thresholds)
  })

  it('crop quanh mặt, chuẩn hóa và xám đệm của dataset.py bằng app', () => {
    expect(pyNumber(dataset, 'FACE_CROP_SCALE')).toBe(DEFAULTS.classifier.faceCropScale)
    expect(pyNumber(dataset, 'NORM_MEAN')).toBe(DEFAULTS.classifier.norm.mean)
    expect(pyNumber(dataset, 'NORM_STD')).toBe(DEFAULTS.classifier.norm.std)
    expect(pyNumber(dataset, 'PAD_GRAY')).toBe(DEFAULTS.face.padGray)
  })
})
