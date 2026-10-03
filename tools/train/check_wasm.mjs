// CLS-04 (D-066): chạy các model phân loại trên onnxruntime-web trong Node (ort.node.min.mjs, cùng
// ort-wasm-simd-threaded.wasm mà worker của app nạp qua `onnxruntime-web/wasm` từ PERF-03), wasm một luồng, tối ưu đồ
// thị mặc định: logits theo đúng runtime của trình duyệt cho cổng của compress_select.py, và thời gian khởi tạo/suy
// luận để so tương đối giữa các biến thể (V8 của Node khác Chrome, nên chỉ so tỉ lệ). export_onnx.py --compress gọi
// script này; cũng chạy tay được sau khi có pack.
// Usage: node tools/train/check_wasm.mjs <work dir with pack.json + pack.f32> <model.onnx> [model.onnx ...]
//   ghi <work>/<tên model>.wasm.f32 (logits [N, 2] của vòng đầu) và <work>/wasm.json (thời gian)
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { basename, join } from 'node:path'
import * as ort from 'onnxruntime-web'

const [work, ...models] = process.argv.slice(2)
if (!work || !models.length) {
  console.error('usage: node tools/train/check_wasm.mjs <work> <model.onnx> [...]')
  process.exit(2)
}
ort.env.wasm.numThreads = 1
const meta = JSON.parse(readFileSync(join(work, 'pack.json'), 'utf8'))
const raw = readFileSync(join(work, 'pack.f32'))
// Buffer nhỏ của Node nằm trong pool chung: luôn cắt theo byteOffset.
const X = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength))
const per = meta.shape.reduce((a, b) => a * b, 1)
const N = meta.n
const ROUNDS = 3
const WARMUP = 10

const q = (a, p) => {
  const s = [...a].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]
}
const results = Object.fromEntries(models.map((m) => [m, { init: [], times: [] }]))
const logits = {}
for (let r = 0; r < ROUNDS; r++) {
  // Xoay thứ tự mỗi vòng để không biến thể nào luôn chạy đầu (wasm lạnh) hay cuối.
  const order = models.map((_, i) => models[(i + r) % models.length])
  for (const m of order) {
    const t0 = performance.now()
    const s = await ort.InferenceSession.create(readFileSync(m), { executionProviders: ['wasm'] })
    results[m].init.push(performance.now() - t0)
    const input = (i) =>
      new ort.Tensor('float32', X.subarray(i * per, (i + 1) * per), [1, ...meta.shape])
    for (let w = 0; w < WARMUP; w++) await s.run({ input: input(w % N) })
    const out = r === 0 ? new Float32Array(N * 2) : null
    for (let i = 0; i < N; i++) {
      const t = performance.now()
      const o = (await s.run({ input: input(i) })).logits.data
      results[m].times.push(performance.now() - t)
      if (out) out.set(o, i * 2)
    }
    if (out) logits[m] = out
    await s.release()
  }
}
const summary = {
  node: process.version,
  v8: process.versions.v8,
  cpu: cpus()[0]?.model.trim() ?? '?',
  n: N,
  rounds: ROUNDS,
  models: models.map((m) => {
    const out = join(work, `${basename(m, '.onnx')}.wasm.f32`)
    writeFileSync(out, Buffer.from(logits[m].buffer))
    const r = results[m]
    return {
      model: m,
      bytes: statSync(m).size,
      logits: out,
      initMs: q(r.init, 0.5),
      p50Ms: q(r.times, 0.5),
      p95Ms: q(r.times, 0.95),
    }
  }),
}
writeFileSync(join(work, 'wasm.json'), JSON.stringify(summary, null, 2))
for (const m of summary.models)
  console.log(
    `${basename(m.model).padEnd(28)} ${(m.bytes / 1e6).toFixed(2)} MB  init ${m.initMs.toFixed(0)} ms  infer p50 ${m.p50Ms.toFixed(2)} / p95 ${m.p95Ms.toFixed(2)} ms`,
  )
