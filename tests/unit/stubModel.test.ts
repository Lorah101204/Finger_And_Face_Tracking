import { describe, expect, it } from 'vitest'
import { softmax } from '../../src/classify/classifierProtocol'
import { DEFAULTS } from '../../src/core/config'
import { stubClassifierBytes } from '../../tools/make-stub-classifier.mjs'

// CLS-02 (mục 7.23, D-044): model ONNX stub mã hóa tay phải nạp được bằng ONNX Runtime (bản Node của onnxruntime-web,
// EP wasm) với đúng tên vào/ra và cỡ input; person = G − (R + B) / 2 trên màu trung bình đã chuẩn hóa nên xanh lá →
// person, magenta → mannequin, xám đệm → 0,5/0,5 (unknown theo quy tắc).
const size = DEFAULTS.classifier.inputSize
const plane = size * size
const { mean, std } = DEFAULTS.classifier.norm

function tensorOf(ort: typeof import('onnxruntime-web'), r: number, g: number, b: number) {
  const d = new Float32Array(3 * plane)
  const n = (v: number) => (v / 255 - mean) / std
  d.fill(n(r), 0, plane)
  d.fill(n(g), plane, 2 * plane)
  d.fill(n(b), 2 * plane)
  return new ort.Tensor('float32', d, [1, 3, size, size])
}

describe('classifier-stub.onnx', () => {
  it('nạp được, input [1,3,128,128] tên "input", output "logits"; xanh lá → person, magenta → mannequin, xám → 0,5', async () => {
    const ort = await import('onnxruntime-web')
    const bytes = stubClassifierBytes(size)
    expect(bytes.length).toBeLessThan(1024)
    const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] })
    expect(session.inputNames).toEqual(['input'])
    expect(session.outputNames).toEqual(['logits'])
    const run = async (r: number, g: number, b: number) => {
      const out = await session.run({ input: tensorOf(ort, r, g, b) })
      return softmax(out.logits.data as Float32Array)
    }
    const green = await run(0, 255, 0)
    const magenta = await run(255, 0, 255)
    const gray = await run(128, 128, 128)
    expect(green[0]).toBeGreaterThan(0.999)
    expect(magenta[1]).toBeGreaterThan(0.999)
    expect(gray[0]).toBeCloseTo(0.5, 6)
    expect(gray[1]).toBeCloseTo(0.5, 6)
    await session.release()
  }, 60_000)
})
