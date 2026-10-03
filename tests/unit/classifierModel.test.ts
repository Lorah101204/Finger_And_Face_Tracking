import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { subjectText } from '../../src/classify/subjectRule'
import {
  DEFAULTS,
  classifierModelPath,
  isDemoClassifier,
  modelUrls,
  modelWarmList,
  setClassifierChoice,
} from '../../src/core/config'
import { resolveClassifier } from '../../vite.config'

// CLS-03 (mục 7.35, D-061): model phân loại huấn luyện. Build chọn classifier.onnx chỉ khi file khớp sha256 của
// models.json, không thì stub; `?classifier=stub|model` đè cho một lần mở; nhãn demo theo model đang dùng.
const blob = Buffer.from('model bytes')
const sha = createHash('sha256').update(blob).digest('hex')
const manifest = { classifier: { file: 'classifier.onnx', sha256: sha } }
const read = (file: string) => (file === 'classifier.onnx' ? blob : null)

describe('resolveClassifier (vite.config.ts)', () => {
  it('file có mặt và khớp sha256 → model; thiếu file, sha256 trống hay lệch → stub kèm lý do', () => {
    const ok = resolveClassifier({ mode: 'development', manifest, readModel: read })
    expect(ok.choice).toBe('model')
    expect(ok.reason).toContain(sha.slice(0, 12))
    expect(resolveClassifier({ mode: 'production', manifest, readModel: read }).choice).toBe(
      'model',
    )
    const missing = resolveClassifier({ mode: 'production', manifest, readModel: () => null })
    expect(missing).toEqual({
      choice: 'stub',
      reason: 'chưa có public/models/classifier.onnx (tools/train/export_onnx.py)',
    })
    const empty = resolveClassifier({
      mode: 'production',
      manifest: { classifier: { file: 'classifier.onnx', sha256: '' } },
      readModel: read,
    })
    expect(empty.choice).toBe('stub')
    expect(empty.reason).toMatch(/chưa có sha256/)
    const stale = resolveClassifier({
      mode: 'production',
      manifest: { classifier: { file: 'classifier.onnx', sha256: 'f'.repeat(64) } },
      readModel: read,
    })
    expect(stale.choice).toBe('stub')
    expect(stale.reason).toMatch(/khác models.json/)
    expect(resolveClassifier({ mode: 'production', manifest: {}, readModel: read }).choice).toBe(
      'stub',
    )
  })

  it('vitest luôn stub; WCT_CLASSIFIER ép một bên, ép model mà thiếu hay lệch thì lỗi, giá trị lạ thì lỗi', () => {
    expect(resolveClassifier({ mode: 'test', manifest, readModel: read })).toEqual({
      choice: 'stub',
      reason: 'vitest',
    })
    expect(
      resolveClassifier({ mode: 'test', force: 'model', manifest, readModel: read }).choice,
    ).toBe('model')
    expect(
      resolveClassifier({ mode: 'production', force: 'stub', manifest, readModel: read }).choice,
    ).toBe('stub')
    expect(
      resolveClassifier({ mode: 'production', force: ' ', manifest, readModel: read }).choice,
    ).toBe('model')
    expect(() =>
      resolveClassifier({ mode: 'production', force: 'model', manifest, readModel: () => null }),
    ).toThrow(/WCT_CLASSIFIER=model nhưng chưa có/)
    expect(() =>
      resolveClassifier({ mode: 'production', force: 'onnx', manifest, readModel: read }),
    ).toThrow(/WCT_CLASSIFIER phải là/)
  })

  it('models.json: mục classifier có stub, file, sha256 (64 hex hoặc trống), source và thông số khớp DEFAULTS', () => {
    const m = JSON.parse(readFileSync(resolve('public/models/models.json'), 'utf8')) as {
      classifier: {
        stub: string
        file: string
        sha256: string
        source?: string
        inputSize: number
        labels: string[]
        norm: { mean: number; std: number }
        opset: number
      }
    }
    const c = m.classifier
    expect(`/models/${c.stub}`).toBe(DEFAULTS.classifier.stubPath)
    expect(`/models/${c.file}`).toBe(DEFAULTS.classifier.trainedPath)
    expect(c.sha256).toMatch(/^([0-9a-f]{64})?$/)
    expect(typeof (c.source ?? '')).toBe('string')
    expect(c.inputSize).toBe(DEFAULTS.classifier.inputSize)
    expect(c.labels).toEqual([...DEFAULTS.classifier.labels])
    expect(c.norm).toEqual(DEFAULTS.classifier.norm)
    expect(c.opset).toBe(17)
  })
})

describe('?classifier=stub|model (setClassifierChoice)', () => {
  afterEach(() => setClassifierChoice(null))

  it('mặc định theo build (vitest: stub); model → classifier.onnx, không demo; stub → stub, demo; null bỏ đè', () => {
    expect(DEFAULTS.classifier.modelPath).toBe(DEFAULTS.classifier.stubPath)
    expect(classifierModelPath()).toBe('/models/classifier-stub.onnx')
    setClassifierChoice('model')
    expect(classifierModelPath()).toBe('/models/classifier.onnx')
    expect(modelUrls('/repo/', false).classifierModel).toBe('/repo/models/classifier.onnx')
    expect(modelWarmList('/repo/').at(-1)).toBe('/repo/models/classifier.onnx')
    expect(isDemoClassifier()).toBe(false)
    expect(subjectText({ subjectType: 'person', confidence: 0.97 })).toBe('Người 97 %')
    setClassifierChoice('stub')
    expect(classifierModelPath()).toBe('/models/classifier-stub.onnx')
    expect(isDemoClassifier()).toBe(true)
    expect(subjectText({ subjectType: 'person', confidence: 0.97 })).toBe('Người 97 % · demo')
    setClassifierChoice(null)
    expect(classifierModelPath()).toBe(DEFAULTS.classifier.modelPath)
  })
})
