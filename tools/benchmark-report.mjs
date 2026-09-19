// PERF-01, QA-02: generates two sections of docs/benchmark.md. (1) "Soak results" from reports/soak-samples.json
// (written by tests/soak/soak.spec.ts) between <!-- bench:begin --> and <!-- bench:end -->: environment, target table
// with pass/fail verdicts, samples over time; skipped when the file is missing. (2) "Device and browser matrix" (QA-02)
// between <!-- matrix:begin --> and <!-- matrix:end -->: merges every reports/bench-<project>.json (written by
// tests/bench/bench.spec.ts) into docs/benchmark-matrix.json (one row per machine + GPU + browser + headless, a newer
// measurement replaces an older one) and renders the environment table, the measurement table and the table comparing
// the locked parameters (core/config.ts) with the measurements. The rest of the document is hand-written.
// Run: npm run test:soak and/or npm run test:bench, then npm run bench:report.
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

const vi = (n, d = 1) => Number(n).toFixed(d)
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
const table = (header, rows) =>
  [
    `| ${header.join(' | ')} |`,
    `|${header.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  ].join('\n')
const verdict = (ok) => (ok ? 'pass' : 'fail')

function replaceBetween(doc, begin, end, body) {
  const i = doc.indexOf(begin)
  const j = doc.indexOf(end)
  if (i < 0 || j < 0 || j < i) {
    console.error(`${DOC} is missing the markers ${begin} … ${end}`)
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
      ? 'real hand worker on the static `hands.jpg` (point age 1000 ms)'
      : 'fake hands on a circular orbit (hand worker not running)'
  const envRows = [
    ['Machine', `${env.cpu}, ${env.threads} threads, ${env.memGB} GB; ${env.os}`],
    [
      'Browser',
      `${env.chromium.title} ${env.chromium.version} (Playwright build ${env.chromium.revision}), headless, 1 worker`,
    ],
    ['Node.js', env.node],
    [
      'Scenario',
      `synthetic source 1280 × 720, ${modeText}, face worker GPU/CPU per D-008 receiving buffers continuously, gate audit 2 Hz`,
    ],
    [
      'Duration',
      `${data.minutes} minutes, ${S.samples} samples every ${data.sampleS} s, started ${data.startedAt}`,
    ],
  ]
  const heapOk = S.heapGrowthPct <= 15 || S.heapLastMB - S.heapFirstMB <= 8
  const clsRow =
    typeof S.classifierHzMedian === 'number'
      ? [
          'Classifier Hz (median)',
          '3 to 5 (targetHz 4)',
          vi(S.classifierHzMedian),
          verdict(S.classifierHzMedian >= 3 && S.classifierHzMedian <= 5),
        ]
      : ['Classifier Hz', '3 to 5', 'not measured (soak sample predates CLS-02)', 'not applicable']
  const targetRows = [
    ['Output FPS (median)', '≥ 30', vi(S.fpsMedian), verdict(S.fpsMedian >= 30)],
    [
      'Output FPS stability (last third vs first third)',
      '≥ 60 %',
      `${vi(S.fpsFirst)} → ${vi(S.fpsLast)} fps`,
      verdict(S.fpsLast >= 0.6 * S.fpsFirst),
    ],
    [
      'Hand Hz (median)',
      '≥ 20',
      mode === 'real-hands'
        ? `${vi(S.handHzMedian)} (p50 ${vi(S.handP50Median, 0)} ms, p95 max ${vi(S.handP95Max, 0)} ms)`
        : 'not measured (fake hands)',
      mode === 'real-hands' ? verdict(S.handHzMedian >= 20) : 'not applicable',
    ],
    [
      'Face Hz (median)',
      '10 to 15 (targetHz 12)',
      `${vi(S.faceHzMedian)} (p50 ${vi(S.faceP50Median, 0)} ms, p95 max ${vi(S.faceP95Max, 0)} ms)`,
      verdict(S.faceHzMedian >= 10 && S.faceHzMedian <= 15),
    ],
    clsRow,
    [
      'Render time p95 max',
      '< 16.7 ms (one frame at 60 fps)',
      `${vi(S.renderP95Max, 2)} ms`,
      verdict(S.renderP95Max < 16.7),
    ],
    ['Loop tick p95 max', 'recorded', `${vi(S.tickP95Max, 2)} ms`, ''],
    ['Pending face tasks', '≤ 1 in every sample', String(S.pendingMax), verdict(S.pendingMax <= 1)],
    [
      'JS heap after GC (first third → last third)',
      'growth ≤ 15 % or ≤ 8 MB',
      `${vi(S.heapFirstMB)} → ${vi(S.heapLastMB)} MB (${vi(S.heapGrowthPct)} %), max ${vi(S.heapMaxMB)} MB`,
      verdict(heapOk),
    ],
    [
      'DOM nodes, listeners (first → last)',
      'no steady growth',
      `${S.nodesDelta >= 0 ? '+' : ''}${S.nodesDelta} nodes, ${S.listenersDelta >= 0 ? '+' : ''}${S.listenersDelta} listeners`,
      verdict(S.nodesDelta <= 200 && S.listenersDelta <= 100),
    ],
    [
      'Reveal region open',
      '> 90 % of samples',
      `${vi(S.openFraction * 100, 0)} %`,
      verdict(S.openFraction > 0.9),
    ],
    [
      'Dropped buffers (face worker busy), skipped hand frames',
      'recorded',
      `${S.faceDroppedTotal} buffers, ${S.handSkippedTotal} frames`,
      '',
    ],
    [
      'Hard gate (reference images)',
      '0 deviating buffers',
      `${S.gateFrames} buffers, ${S.gateDirty} deviating`,
      verdict(S.gateDirty === 0),
    ],
    [
      'Page errors, crashes',
      '0',
      `${S.pageErrors} page errors, ${S.consoleErrors} console.error (excluding MediaPipe INFO lines)`,
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
    s.open ? 'open' : 'closed',
  ])
  const body = [
    `Generated by \`npm run bench:report\` (\`tools/benchmark-report.mjs\`) from \`reports/soak-samples.json\`. Do not edit this section by hand.`,
    '',
    '### Environment and scenario',
    '',
    table(['Item', 'Value'], envRows),
    '',
    '### Targets and results',
    '',
    table(['Metric', 'Target', 'Measured', 'Verdict'], targetRows),
    '',
    '### Samples over time',
    '',
    table(
      [
        't (s)',
        'fps',
        'hand Hz',
        'face Hz',
        'face p50 / p95 ms',
        'render p50 / p95 ms',
        'heap MB',
        'nodes',
        'listeners',
        'pending',
        'region',
      ],
      sampleRows,
    ),
  ]
  const fails = targetRows.filter((r) => r[3] === 'fail').map((r) => r[0])
  return {
    body,
    summary:
      `soak: ${S.samples} samples, fps ${vi(S.fpsMedian)}, face ${vi(S.faceHzMedian)} Hz, heap ${vi(S.heapFirstMB)} → ${vi(S.heapLastMB)} MB` +
      (fails.length ? `; failed: ${fails.join('; ')}` : '; every applicable target passed'),
  }
}

// ---------- (2) Device matrix (QA-02) ----------
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
    `${r.machine.cpu}, ${r.machine.threads} threads, ${r.machine.memGB} GB, ${r.machine.os}`,
    browserLabel(r),
    r.machine.gpu,
    r.adapter ? r.adapter.description || r.adapter.vendor || 'yes' : 'no',
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
        fullscreen: 'fullscreen',
        directoryPicker: 'directory picker',
        getUserMedia: 'getUserMedia',
      }
      const missing = Object.keys(names).filter((k) => !f[k])
      return missing.length ? missing.map((k) => names[k]).join(', ') : 'all present'
    })(),
    day(r.startedAt),
  ])

  const hand = (h) =>
    h
      ? `${vi(h.handHzMedian)} Hz (${h.delegate}; init ${ms0(h.initMs)}; p50 ${vi(h.handP50Median, 0)} / p95 ${vi(h.handP95Median ?? h.handP95Max, 0)} ms; interval p95 ${vi(h.handInterval.p95, 0)} ms)`
      : 'not measured'
  const measureRows = rows.map((r) => {
    const m = r.mouse
    return [
      browserLabel(r),
      m ? `${vi(m.fpsMedian)} (min ${vi(m.fpsMin)})` : '?',
      m
        ? `${vi(m.faceHzMedian)} Hz (p50 ${vi(m.faceP50Median, 0)} / p95 ${vi(m.faceP95Max, 0)} ms; interval p95 ${vi(m.faceInterval.p95, 0)} ms; stale ${m.faceStale})`
        : '?',
      m
        ? `${m.cls.ep} (init ${ms0(m.cls.initMs)}; p50 ${vi(m.cls.p50)} / p95 ${vi(m.cls.p95)} ms; ${vi(m.clsHzMedian)} Hz; stale ${m.cls.stale})`
        : '?',
      r.clsWasm
        ? `init ${ms0(r.clsWasm.initMs)}; p50 ${vi(r.clsWasm.p50)} ms; ${vi(r.clsWasm.hz)} Hz`
        : '?',
      hand(r.hands?.CPU),
      hand(r.hands?.GPU),
      (() => {
        const hs = Object.values(r.hands ?? {}).filter((h) => h.tipJitterCells !== null)
        if (!hs.length) return 'not measured'
        const worst = hs.reduce((a, b) => (b.tipJitterPx > a.tipJitterPx ? b : a))
        return `σ ${vi(worst.tipJitterPx, 2)} px = ${vi(worst.tipJitterCells, 3)} cells (${worst.delegate}); region open ${vi(worst.openFraction * 100, 0)} %`
      })(),
      m ? `${vi(m.renderP95Max, 2)} / ${vi(m.tickP95Max, 2)} ms` : '?',
    ]
  })

  // Locked parameters (section 6 of benchmark.md): hand point age ≥ interval p95 + hand inferMs p95 (the largest age of
  // the newest point right before the next result arrives); face and classifier result age: p95 age at gate acceptance
  // ≤ 80 % of the maximum with no result rejected as stale; label age ≥ 2 × interval p95 between two classifier
  // results; hysteresis ≥ 3σ fingertip jitter on a still image. Hands are judged with the delegate locked in the config.
  const paramRows = []
  for (const r of rows) {
    const c = r.config
    const m = r.mouse
    const chosen = c.handsDelegateResolved ?? c.handsDelegate
    const h = r.hands?.[chosen] ?? r.hands?.CPU ?? r.hands?.GPU
    const ageCheck = (max, age, stale) =>
      age && age.n > 0
        ? `p95 ${vi(age.p95, 0)} / max ${vi(age.max, 0)} ms vs ${max} ms, stale ${stale}: ${verdict(stale === 0 && age.p95 <= 0.8 * max)}`
        : 'not measured'
    // Point age with the resolved delegate: interval p95 + inferMs p95 in steady state (median of per-sample p95).
    const inferP95 = h ? (h.handP95Median ?? h.handP95Max) : 0
    const needPoint = h ? h.handInterval.p95 + inferP95 : 0
    const pointAge =
      h?.delegate === 'CPU' ? (c.pointMaxAgeMsCpu ?? c.pointMaxAgeMs) : c.pointMaxAgeMs
    const jitterOk =
      h && h.tipJitterCells !== null ? c.hysteresisCells >= 3 * h.tipJitterCells : null
    paramRows.push([
      browserLabel(r),
      h && needPoint > 0
        ? `${pointAge} (${h.delegate}) vs interval p95 ${vi(h.handInterval.p95, 0)} + infer p95 ${vi(inferP95, 0)} = ${vi(needPoint, 0)} ms: ${verdict(pointAge >= needPoint)}`
        : 'not measured',
      m ? ageCheck(c.faceResultMaxAgeMs, m.faceAge, m.faceStale) : 'not measured',
      m ? ageCheck(c.classifierResultMaxAgeMs, m.clsAge, m.cls.stale) : 'not measured',
      m && m.clsInterval.n > 0
        ? `${c.labelMaxAgeMs} ≥ 2 × interval p95 ${vi(m.clsInterval.p95, 0)} = ${vi(2 * m.clsInterval.p95, 0)} ms: ${verdict(c.labelMaxAgeMs >= 2 * m.clsInterval.p95)}`
        : 'not measured',
      jitterOk === null
        ? 'not measured'
        : `${vi(c.hysteresisCells, 2)} ≥ 3 × ${vi(h.tipJitterCells, 3)} = ${vi(3 * h.tipJitterCells, 3)} cells: ${verdict(jitterOk)}`,
    ])
  }

  return [
    `Generated by \`npm run bench:report\` from \`docs/benchmark-matrix.json\` (merges the \`reports/bench-<project>.json\` files of \`npm run test:bench\`, one row per machine + GPU + browser, a newer measurement replaces an older one). Do not edit this section by hand.`,
    '',
    '### Machines, browsers and APIs',
    '',
    table(
      [
        'Machine',
        'Browser',
        'GPU (WebGL)',
        'WebGPU adapter',
        'Face worker',
        'Missing APIs',
        'Date',
      ],
      envRows,
    ),
    '',
    '### Measurements (mouse window on `face.png` or the synthetic background; real hands on `hands.jpg`)',
    '',
    table(
      [
        'Browser',
        'Output fps',
        'Face',
        'Classifier (default EP)',
        'Classifier wasm',
        'Hands CPU',
        'Hands GPU',
        'Fingertip jitter (still image)',
        'Render / tick p95',
      ],
      measureRows,
    ),
    '',
    '### Locked parameters vs measurements (`core/config.ts`)',
    '',
    'The hand point age (150 ms with the GPU delegate, 250 ms with CPU) must exceed the p95 interval between two hand results plus the hand inferMs p95 in steady state (the largest age of the newest point right before the next result arrives, with the delegate the app picks on that machine); face and classifier result ages: the p95 age at gate acceptance must not exceed 80 % of the maximum and no result may be rejected as stale; the label age must hold at least two p95 intervals between classifier results; the per-cell hysteresis must exceed three times the fingertip jitter on a still image (hands held still must not change cells).',
    '',
    table(
      [
        'Browser',
        'Hand point age',
        'Face result age',
        'Classifier result age',
        'Label age',
        'Hysteresis',
      ],
      paramRows,
    ),
  ]
}

// ---------- write ----------
let doc = readFileSync(DOC, 'utf8')
const messages = []
if (existsSync(SOAK)) {
  const { body, summary } = soakSection()
  doc = replaceBetween(doc, BENCH_BEGIN, BENCH_END, body)
  messages.push(summary)
} else {
  messages.push(`no ${SOAK}: soak results section kept as is`)
}
const { rows, added } = loadMatrix()
if (rows.length) {
  writeFileSync(MATRIX, JSON.stringify(rows, null, 2) + '\n')
  doc = replaceBetween(doc, MATRIX_BEGIN, MATRIX_END, matrixSection(rows))
  messages.push(`matrix: ${rows.length} rows (${added} from reports/)`)
} else {
  messages.push('no bench-*.json and no docs/benchmark-matrix.json: matrix kept as is')
}
writeFileSync(DOC, doc)
console.log(`wrote ${DOC}: ${messages.join('; ')}`)
