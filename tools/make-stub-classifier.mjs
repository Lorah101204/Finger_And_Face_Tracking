// CLS-02: sinh model ONNX "stub" cho đường ống phân loại khi chưa có model huấn luyện (D-044): input [1,3,128,128]
// float32 đã chuẩn hóa → GlobalAveragePool → Flatten → Gemm (3 → 2) → logits [1,2] theo thứ tự [person, mannequin].
// Trọng số cố định: person = G − (R + B) / 2 trên màu trung bình, nên cảnh tổng hợp (xanh lá / magenta) cho nhãn xác
// định để e2e kiểm đường ống; xám đệm cho hai xác suất bằng nhau (unknown). Protobuf ONNX mã hóa tay (không phụ thuộc
// gói onnx), opset 17, ir_version 8. Chạy riêng: node tools/make-stub-classifier.mjs; models:fetch cũng gọi.
import { writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const enc = new TextEncoder()

function varint(n) {
  const out = []
  let v = BigInt(n)
  if (v < 0n) v += 1n << 64n
  do {
    let b = Number(v & 0x7fn)
    v >>= 7n
    if (v > 0n) b |= 0x80
    out.push(b)
  } while (v > 0n)
  return Uint8Array.from(out)
}

function concat(parts) {
  const len = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(len)
  let p = 0
  for (const part of parts) {
    out.set(part, p)
    p += part.length
  }
  return out
}

/** field số `num`, wire type 0 (varint). */
const vfield = (num, n) => concat([varint((num << 3) | 0), varint(n)])
/** field số `num`, wire type 2 (length-delimited). */
const lfield = (num, bytes) => concat([varint((num << 3) | 2), varint(bytes.length), bytes])
const sfield = (num, s) => lfield(num, enc.encode(s))

// ONNX (onnx.proto3): số field theo đặc tả.
const AttributeType = { FLOAT: 1, INT: 2, INTS: 7 }
const DataType = { FLOAT: 1 }

function attrInt(name, value) {
  return lfield(5, concat([sfield(1, name), vfield(20, AttributeType.INT), vfield(3, value)]))
}

function node(opType, inputs, outputs, name, attrs = []) {
  return lfield(
    1,
    concat([
      ...inputs.map((i) => sfield(1, i)),
      ...outputs.map((o) => sfield(2, o)),
      sfield(3, name),
      sfield(4, opType),
      ...attrs,
    ]),
  )
}

function tensorFloat(name, dims, values) {
  const raw = new Uint8Array(values.length * 4)
  new DataView(raw.buffer).setFloat32(0, 0, true)
  const dv = new DataView(raw.buffer)
  values.forEach((v, i) => dv.setFloat32(i * 4, v, true))
  return lfield(
    5,
    concat([
      ...dims.map((d) => vfield(1, d)),
      vfield(2, DataType.FLOAT),
      sfield(8, name),
      lfield(9, raw),
    ]),
  )
}

function valueInfo(fieldNum, name, dims) {
  const shape = lfield(2, concat(dims.map((d) => lfield(1, vfield(1, d)))))
  const tensorType = lfield(1, concat([vfield(1, DataType.FLOAT), shape]))
  return lfield(fieldNum, concat([sfield(1, name), lfield(2, tensorType)]))
}

export const STUB_INPUT_SIZE = 128
/** person = G − (R + B) / 2; mannequin = −person (trên màu trung bình đã chuẩn hóa). Gemm: Y = X[1,3] · W[3,2] + b. */
export const STUB_WEIGHTS = [-0.5, 0.5, 1, -1, -0.5, 0.5]
export const STUB_BIAS = [0, 0]

export function stubClassifierBytes(size = STUB_INPUT_SIZE) {
  const graph = lfield(
    7,
    concat([
      node('GlobalAveragePool', ['input'], ['pooled'], 'gap'),
      node('Flatten', ['pooled'], ['flat'], 'flatten', [attrInt('axis', 1)]),
      node('Gemm', ['flat', 'W', 'b'], ['logits'], 'gemm'),
      sfield(2, 'wct-stub-classifier'),
      tensorFloat('W', [3, 2], STUB_WEIGHTS),
      tensorFloat('b', [2], STUB_BIAS),
      valueInfo(11, 'input', [1, 3, size, size]),
      valueInfo(12, 'logits', [1, 2]),
    ]),
  )
  const opset = lfield(8, concat([sfield(1, ''), vfield(2, 17)]))
  return concat([
    vfield(1, 8),
    sfield(2, 'wct'),
    sfield(3, '1.0'),
    sfield(6, 'Stub CLS-02: person = G - (R + B) / 2 on mean color; replace by trained model'),
    graph,
    opset,
  ])
}

export function writeStubClassifier(dest) {
  const bytes = stubClassifierBytes()
  writeFileSync(dest, bytes)
  return bytes.length
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const dest = join(root, 'public', 'models', 'classifier-stub.onnx')
  const n = writeStubClassifier(dest)
  console.log(`đã ghi ${dest} (${n} byte)`)
}
