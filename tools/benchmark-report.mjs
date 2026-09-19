// PERF-01, QA-02: sinh hai mục của docs/benchmark.md. (1) "Kết quả soak" từ reports/soak-samples.json
// (tests/soak/soak.spec.ts ghi) giữa <!-- bench:begin --> và <!-- bench:end -->: môi trường, bảng mục tiêu với đạt hay
// không đạt, bảng mẫu theo thời gian; bỏ qua khi chưa có file. (2) "Ma trận thiết bị và trình duyệt" (QA-02) giữa
// <!-- matrix:begin --> và <!-- matrix:end -->: gộp mọi reports/bench-<project>.json (tests/bench/bench.spec.ts ghi)
// vào docs/benchmark-matrix.json (một dòng cho mỗi máy + GPU + trình duyệt + headless, lần đo mới thay lần cũ) rồi vẽ
// bảng môi trường, bảng số đo và bảng đối chiếu tham số chốt (core/config.ts) với số đo. Phần còn lại của tài liệu viết
// tay. Chạy: npm run test:soak và/hoặc npm run test:bench rồi npm run bench:report.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const DOC = join(ROOT, 'docs', 'benchmark.md')
const SOAK = join(ROOT, 'reports', 'soak-samples.json')
const REPORTS = join(ROOT, 'reports')
const MATRIX = join(ROOT, 'docs', 'benchmark-matrix.json')
const BENCH_BEGIN = '<!-- bench:begin -->'
const BENCH_END = '<!-- bench:end -->'
const MATRIX_BEGIN = '<!-- matrix:begin -->'
const MATRIX_END = '<!-- matrix:end -->'

const vi = (n, d = 1) => Number(n).toFixed(d).replace('.', ',')
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
const table = (header, rows) =>
  [
    `| ${header.join(' | ')} |`,
    `|${header.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  ].join('\n')
const verdict = (ok) => (ok ? 'đạt' : 'không đạt')

function replaceBetween(doc, begin, end, body) {
  const i = doc.indexOf(begin)
  const j = doc.indexOf(end)
  if (i < 0 || j < 0 || j < i) {
    console.error(`${DOC} thiếu mốc ${begin} … ${end}`)
    process.exit(1)
  }
  return doc.slice(0, i) + [begin, ...body, end].join('\n') + doc.slice(j + end.length)
}

// ---------- (1) Soak (PERF-01) ----------
function soakSection() {
  const data = JSON.parse(readFileSync(SOAK, 'utf8'))
  const { env, summary: S, samples, mode } = data
  const modeText =
    mode === 'real-hands'
      ? 'worker tay thật trên `hands.jpg` tĩnh (tuổi điểm 1000 ms)'
      : 'tay giả lập chạy quỹ đạo tròn (worker tay không chạy)'
  const envRows = [
    ['Máy', `${env.cpu}, ${env.threads} luồng, ${env.memGB} GB; ${env.os}`],
    [
      'Trình duyệt',
      `${env.chromium.title} ${env.chromium.version} (Playwright build ${env.chromium.revision}), headless, 1 worker`,
    ],
    ['Node.js', env.node],
    [
      'Kịch bản',
      `nguồn tổng hợp 1280 × 720, ${modeText}, worker mặt GPU/CPU theo D-008 nhận buffer liên tục, gate audit 2 Hz`,
    ],
    [
      'Thời lượng',
      `${data.minutes} phút, ${S.samples} mẫu cách ${data.sampleS} s, bắt đầu ${data.startedAt}`,
    ],
  ]
  const heapOk = S.heapGrowthPct <= 15 || S.heapLastMB - S.heapFirstMB <= 8
  const clsRow =
    typeof S.classifierHzMedian === 'number'
      ? [
          'Classifier Hz (trung vị)',
          '3 đến 5 (targetHz 4)',
          vi(S.classifierHzMedian),
          verdict(S.classifierHzMedian >= 3 && S.classifierHzMedian <= 5),
        ]
      : ['Classifier Hz', '3 đến 5', 'không đo (mẫu soak trước CLS-02)', 'không áp dụng']
  const targetRows = [
    ['Output FPS (trung vị)', '≥ 30', vi(S.fpsMedian), verdict(S.fpsMedian >= 30)],
    [
      'Output FPS ổn định (phần ba cuối so với phần ba đầu)',
      '≥ 60 %',
      `${vi(S.fpsFirst)} → ${vi(S.fpsLast)} fps`,
      verdict(S.fpsLast >= 0.6 * S.fpsFirst),
    ],
    [
      'Hand Hz (trung vị)',
      '≥ 20',
      mode === 'real-hands'
        ? `${vi(S.handHzMedian)} (p50 ${vi(S.handP50Median, 0)} ms, p95 tối đa ${vi(S.handP95Max, 0)} ms)`
        : 'không đo (tay giả lập)',
      mode === 'real-hands' ? verdict(S.handHzMedian >= 20) : 'không áp dụng',
    ],
    [
      'Face Hz (trung vị)',
      '10 đến 15 (targetHz 12)',
      `${vi(S.faceHzMedian)} (p50 ${vi(S.faceP50Median, 0)} ms, p95 tối đa ${vi(S.faceP95Max, 0)} ms)`,
      verdict(S.faceHzMedian >= 10 && S.faceHzMedian <= 15),
    ],
    clsRow,
    [
      'Thời gian vẽ p95 tối đa',
      '< 16,7 ms (một frame 60 fps)',
      `${vi(S.renderP95Max, 2)} ms`,
      verdict(S.renderP95Max < 16.7),
    ],
    ['Tick vòng lặp p95 tối đa', 'ghi nhận', `${vi(S.tickP95Max, 2)} ms`, ''],
    ['Tác vụ mặt chờ', '≤ 1 ở mọi mẫu', String(S.pendingMax), verdict(S.pendingMax <= 1)],
    [
      'Heap JS sau GC (phần ba đầu → cuối)',
      'tăng ≤ 15 % hoặc ≤ 8 MB',
      `${vi(S.heapFirstMB)} → ${vi(S.heapLastMB)} MB (${vi(S.heapGrowthPct)} %), tối đa ${vi(S.heapMaxMB)} MB`,
      verdict(heapOk),
    ],
    [
      'Node DOM, listener (đầu → cuối)',
      'không tăng dần',
      `${S.nodesDelta >= 0 ? '+' : ''}${S.nodesDelta} node, ${S.listenersDelta >= 0 ? '+' : ''}${S.listenersDelta} listener`,
      verdict(S.nodesDelta <= 200 && S.listenersDelta <= 100),
    ],
    ['Vùng mở', '> 90 % mẫu', `${vi(S.openFraction * 100, 0)} %`, verdict(S.openFraction > 0.9)],
    [
      'Buffer rớt (worker mặt bận), frame tay bỏ',
      'ghi nhận',
      `${S.faceDroppedTotal} buffer, ${S.handSkippedTotal} frame`,
      '',
    ],
    [
      'Gate cứng (ảnh tham chiếu)',
      '0 buffer lệch',
      `${S.gateFrames} buffer, ${S.gateDirty} lệch`,
      verdict(S.gateDirty === 0),
    ],
    [
      'Lỗi trang, crash',
      '0',
      `${S.pageErrors} lỗi trang, ${S.consoleErrors} console.error (trừ dòng INFO của MediaPipe)`,
      verdict(S.pageErrors === 0 && S.consoleErrors === 0),
    ],
  ]
  const sampleRows = samples.map((s) => [
    vi(s.t, 0),
    vi(s.fps),
    vi(s.handHz),
    vi(s.faceHz),
    `${vi(s.face.p50, 0)} / ${vi(s.face.p95, 0)}`,
    `${vi(s.render.p50, 2)} / ${vi(s.render.p95, 2)}`,
    vi(s.heapUsedMB),
    s.nodes,
    s.listeners,
    s.face.pending,
    s.open ? 'mở' : 'đóng',
  ])
  const body = [
    `Sinh bởi \`npm run bench:report\` (\`tools/benchmark-report.mjs\`) từ \`reports/soak-samples.json\`. Không sửa tay phần này.`,
    '',
    '### Môi trường và kịch bản',
    '',
    table(['Mục', 'Giá trị'], envRows),
    '',
    '### Mục tiêu và kết quả',
    '',
    table(['Chỉ số', 'Mục tiêu', 'Đo được', 'Kết luận'], targetRows),
    '',
    '### Mẫu theo thời gian',
    '',
    table(
      [
        't (s)',
        'fps',
        'tay Hz',
        'mặt Hz',
        'mặt p50 / p95 ms',
        'vẽ p50 / p95 ms',
        'heap MB',
        'node',
        'listener',
        'chờ',
        'vùng',
      ],
      sampleRows,
    ),
  ]
  const fails = targetRows.filter((r) => r[3] === 'không đạt').map((r) => r[0])
  return {
    body,
    summary:
      `soak: ${S.samples} mẫu, fps ${vi(S.fpsMedian)}, mặt ${vi(S.faceHzMedian)} Hz, heap ${vi(S.heapFirstMB)} → ${vi(S.heapLastMB)} MB` +
      (fails.length ? `; không đạt: ${fails.join('; ')}` : '; mọi mục tiêu áp dụng đều đạt'),
  }
}

// ---------- (2) Ma trận thiết bị (QA-02) ----------
const runKey = (r) =>
  `${r.machine.cpu}|${r.machine.gpu}|${r.project}|${r.browser.headless ? 'headless' : 'headed'}`
const browserLabel = (r) => {
  const b = r.env?.browser ?? { name: r.browser.name, version: r.browser.version }
  const name = b.name.replace(' headless', '')
  return `${name} ${b.version}${r.browser.headless ? ' (headless)' : ''}${r.project === 'chromium' ? ', Playwright shell' : ''}`
}
const day = (iso) => iso.slice(0, 10)
const ms0 = (n) => `${vi(n, 0)} ms`

function loadMatrix() {
  const stored = existsSync(MATRIX) ? JSON.parse(readFileSync(MATRIX, 'utf8')) : []
  const byKey = new Map(stored.map((r) => [runKey(r), r]))
  let added = 0
  if (existsSync(REPORTS)) {
    for (const f of readdirSync(REPORTS)) {
      if (!/^bench-.+\.json$/.test(f)) continue
      const r = JSON.parse(readFileSync(join(REPORTS, f), 'utf8'))
      if (!r.env) continue
      byKey.set(runKey(r), r)
      added++
    }
  }
  const rows = [...byKey.values()].sort((a, b) =>
    `${a.machine.cpu}${a.project}`.localeCompare(`${b.machine.cpu}${b.project}`),
  )
  return { rows, added }
}

function matrixSection(rows) {
  const envRows = rows.map((r) => [
    `${r.machine.cpu}, ${r.machine.threads} luồng, ${r.machine.memGB} GB, ${r.machine.os}`,
    browserLabel(r),
    r.machine.gpu,
    r.adapter ? r.adapter.description || r.adapter.vendor || 'có' : 'không',
    r.faceWorker ? `${r.faceWorker.delegate}, init ${ms0(r.faceWorker.initMs)}` : '?',
    (() => {
      const f = r.env.features
      const names = {
        rvfc: 'rVFC',
        offscreenCanvas: 'OffscreenCanvas',
        moduleWorker: 'module worker',
        imageBitmap: 'ImageBitmap',
        webgpu: 'WebGPU',
        wasmSimd: 'wasm SIMD',
        sharedArrayBuffer: 'SharedArrayBuffer',
        fullscreen: 'toàn màn hình',
        directoryPicker: 'chọn thư mục',
        getUserMedia: 'getUserMedia',
      }
      const missing = Object.keys(names).filter((k) => !f[k])
      return missing.length ? missing.map((k) => names[k]).join(', ') : 'đủ'
    })(),
    day(r.startedAt),
  ])

  const hand = (h) =>
    h
      ? `${vi(h.handHzMedian)} Hz (${h.delegate}; init ${ms0(h.initMs)}; p50 ${vi(h.handP50Median, 0)} / p95 ${vi(h.handP95Median ?? h.handP95Max, 0)} ms; k/c p95 ${vi(h.handInterval.p95, 0)} ms)`
      : 'không đo'
  const measureRows = rows.map((r) => {
    const m = r.mouse
    return [
      browserLabel(r),
      m ? `${vi(m.fpsMedian)} (tối thiểu ${vi(m.fpsMin)})` : '?',
      m
        ? `${vi(m.faceHzMedian)} Hz (p50 ${vi(m.faceP50Median, 0)} / p95 ${vi(m.faceP95Max, 0)} ms; k/c p95 ${vi(m.faceInterval.p95, 0)} ms; quá tuổi ${m.faceStale})`
        : '?',
      m
        ? `${m.cls.ep} (init ${ms0(m.cls.initMs)}; p50 ${vi(m.cls.p50)} / p95 ${vi(m.cls.p95)} ms; ${vi(m.clsHzMedian)} Hz; quá tuổi ${m.cls.stale})`
        : '?',
      r.clsWasm
        ? `init ${ms0(r.clsWasm.initMs)}; p50 ${vi(r.clsWasm.p50)} ms; ${vi(r.clsWasm.hz)} Hz`
        : '?',
      hand(r.hands?.CPU),
      hand(r.hands?.GPU),
      (() => {
        const hs = Object.values(r.hands ?? {}).filter((h) => h.tipJitterCells !== null)
        if (!hs.length) return 'không đo'
        const worst = hs.reduce((a, b) => (b.tipJitterPx > a.tipJitterPx ? b : a))
        return `σ ${vi(worst.tipJitterPx, 2)} px = ${vi(worst.tipJitterCells, 3)} ô (${worst.delegate}); vùng mở ${vi(worst.openFraction * 100, 0)} %`
      })(),
      m ? `${vi(m.renderP95Max, 2)} / ${vi(m.tickP95Max, 2)} ms` : '?',
    ]
  })

  // Tham số chốt (mục 6 của benchmark.md): tuổi điểm tay ≥ khoảng cách p95 + inferMs p95 của tay (tuổi lớn nhất của
  // điểm mới nhất ngay trước khi kết quả kế về); tuổi kết quả mặt và phân loại: p95 tuổi lúc gate nhận ≤ 80 % tuổi
  // tối đa và không có kết quả bị loại vì quá tuổi; tuổi nhãn ≥ 2 × khoảng cách p95 giữa hai kết quả phân loại;
  // hysteresis ≥ 3σ rung đầu ngón trên ảnh tĩnh. Tay xét với delegate đang chốt trong cấu hình.
  const paramRows = []
  for (const r of rows) {
    const c = r.config
    const m = r.mouse
    const chosen = c.handsDelegateResolved ?? c.handsDelegate
    const h = r.hands?.[chosen] ?? r.hands?.CPU ?? r.hands?.GPU
    const ageCheck = (max, age, stale) =>
      age && age.n > 0
        ? `p95 ${vi(age.p95, 0)} / max ${vi(age.max, 0)} ms so với ${max} ms, quá tuổi ${stale}: ${verdict(stale === 0 && age.p95 <= 0.8 * max)}`
        : 'không đo'
    // Tuổi điểm với delegate đã quyết: khoảng cách p95 + inferMs p95 ở trạng thái ổn định (trung vị của p95 theo mẫu).
    const inferP95 = h ? (h.handP95Median ?? h.handP95Max) : 0
    const needPoint = h ? h.handInterval.p95 + inferP95 : 0
    const pointAge =
      h?.delegate === 'CPU' ? (c.pointMaxAgeMsCpu ?? c.pointMaxAgeMs) : c.pointMaxAgeMs
    const jitterOk =
      h && h.tipJitterCells !== null ? c.hysteresisCells >= 3 * h.tipJitterCells : null
    paramRows.push([
      browserLabel(r),
      h && needPoint > 0
        ? `${pointAge} (${h.delegate}) so với k/c p95 ${vi(h.handInterval.p95, 0)} + infer p95 ${vi(inferP95, 0)} = ${vi(needPoint, 0)} ms: ${verdict(pointAge >= needPoint)}`
        : 'không đo',
      m ? ageCheck(c.faceResultMaxAgeMs, m.faceAge, m.faceStale) : 'không đo',
      m ? ageCheck(c.classifierResultMaxAgeMs, m.clsAge, m.cls.stale) : 'không đo',
      m && m.clsInterval.n > 0
        ? `${c.labelMaxAgeMs} ≥ 2 × k/c p95 ${vi(m.clsInterval.p95, 0)} = ${vi(2 * m.clsInterval.p95, 0)} ms: ${verdict(c.labelMaxAgeMs >= 2 * m.clsInterval.p95)}`
        : 'không đo',
      jitterOk === null
        ? 'không đo'
        : `${vi(c.hysteresisCells, 2)} ≥ 3 × ${vi(h.tipJitterCells, 3)} = ${vi(3 * h.tipJitterCells, 3)} ô: ${verdict(jitterOk)}`,
    ])
  }

  return [
    `Sinh bởi \`npm run bench:report\` từ \`docs/benchmark-matrix.json\` (gộp \`reports/bench-<project>.json\` của \`npm run test:bench\`, mỗi máy + GPU + trình duyệt một dòng, lần đo mới thay lần cũ). Không sửa tay phần này.`,
    '',
    '### Máy, trình duyệt và API',
    '',
    table(
      ['Máy', 'Trình duyệt', 'GPU (WebGL)', 'Adapter WebGPU', 'Worker mặt', 'Thiếu API', 'Ngày'],
      envRows,
    ),
    '',
    '### Số đo (cửa sổ chuột trên `face.png` hay nền tổng hợp; tay thật trên `hands.jpg`)',
    '',
    table(
      [
        'Trình duyệt',
        'Output fps',
        'Mặt',
        'Phân loại (EP mặc định)',
        'Phân loại wasm',
        'Tay CPU',
        'Tay GPU',
        'Rung đầu ngón (ảnh tĩnh)',
        'Vẽ / tick p95',
      ],
      measureRows,
    ),
    '',
    '### Tham số chốt so với số đo (`core/config.ts`)',
    '',
    'Tuổi điểm tay (150 ms với GPU delegate, 250 ms với CPU) phải lớn hơn khoảng cách p95 giữa hai kết quả tay cộng inferMs p95 ở trạng thái ổn định (tuổi lớn nhất của điểm mới nhất ngay trước khi kết quả kế về, với delegate app tự chọn trên máy đó); tuổi kết quả mặt và phân loại: p95 tuổi lúc gate nhận không quá 80 % tuổi tối đa và không kết quả nào bị loại vì quá tuổi; tuổi nhãn chứa ít nhất hai khoảng cách p95 giữa hai kết quả phân loại; hysteresis theo ô lớn hơn ba lần độ rung đầu ngón trên ảnh tĩnh (tay giữ yên không đổi ô).',
    '',
    table(
      [
        'Trình duyệt',
        'Tuổi điểm tay',
        'Tuổi kết quả mặt',
        'Tuổi kết quả phân loại',
        'Tuổi nhãn',
        'Hysteresis',
      ],
      paramRows,
    ),
  ]
}

// ---------- ghi ----------
let doc = readFileSync(DOC, 'utf8')
const messages = []
if (existsSync(SOAK)) {
  const { body, summary } = soakSection()
  doc = replaceBetween(doc, BENCH_BEGIN, BENCH_END, body)
  messages.push(summary)
} else {
  messages.push(`không có ${SOAK}: giữ nguyên mục kết quả soak`)
}
const { rows, added } = loadMatrix()
if (rows.length) {
  writeFileSync(MATRIX, JSON.stringify(rows, null, 2) + '\n')
  doc = replaceBetween(doc, MATRIX_BEGIN, MATRIX_END, matrixSection(rows))
  messages.push(`ma trận: ${rows.length} dòng (${added} từ reports/)`)
} else {
  messages.push('không có bench-*.json hay docs/benchmark-matrix.json: giữ nguyên ma trận')
}
writeFileSync(DOC, doc)
console.log(`đã ghi ${DOC}: ${messages.join('; ')}`)
