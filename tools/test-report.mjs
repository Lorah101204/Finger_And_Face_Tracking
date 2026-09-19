// QA-01: sinh phần kết quả trong docs/test-report-mask.md từ reports/unit.json (Vitest, reporter json) và
// reports/e2e.json (Playwright, reporter json, kèm annotations "đo" và "gate cứng" do tests/e2e/helpers.ts ghi),
// và reports/deploy.json nếu có (REL-01: `npm run test:deploy`, bản build qua vite preview, một mục riêng), cùng môi trường (OS, CPU, Node, Vite, Vitest, Playwright, Chromium theo browsers.json của Playwright), model
// (public/models/models.json) và asset cục bộ. Chỉ ghi đè phần giữa hai mốc <!-- report:begin --> và
// <!-- report:end -->; phần còn lại của tài liệu viết tay. Chạy: npm run test:report (chạy test rồi sinh) hoặc
// npm run test:report:write (chỉ sinh từ JSON đã có). Không gọi mạng, không chạy trình duyệt.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { basename, join } from 'node:path'

const ROOT = process.cwd()
const DOC = join(ROOT, 'docs', 'test-report-mask.md')
const UNIT = join(ROOT, 'reports', 'unit.json')
const E2E = join(ROOT, 'reports', 'e2e.json')
const DEPLOY = join(ROOT, 'reports', 'deploy.json')
const BEGIN = '<!-- report:begin -->'
const END = '<!-- report:end -->'

/** Mục 7 của WORK-BREAKDOWN mà mỗi file test phủ (7.1 là bảng ánh xạ ca của kế hoạch, 7.2 là gate cứng). */
const E2E_SECTIONS = {
  'landing.spec.ts': '7.4, 7.21',
  'start.spec.ts': '7.21, 7.28',
  'dataset.spec.ts': '7.22, 7.2',
  'classify.spec.ts': '7.23, 7.2',
  'log.spec.ts': '7.25',
  'camera.spec.ts': '7.5',
  'grid.spec.ts': '7.6',
  'roi.spec.ts': '7.7',
  'mask.spec.ts': '7.8, 7.1',
  'synthetic.spec.ts': '7.9, 7.2',
  'restricted.spec.ts': '7.2, 7.10, 7.17',
  'face.spec.ts': '7.11, 7.12, 7.1, 7.2',
  'faceGate.spec.ts': '7.12, 7.1, 7.2',
  'hands.spec.ts': '7.13, 7.14, 7.15, 7.17, 7.26',
  'solver.spec.ts': '7.15, 7.17, 7.26, 7.1, 7.2',
  'integration.spec.ts': '7.16, 7.2',
  'stats.spec.ts': '7.19, 7.2',
  'ux.spec.ts': '7.20, 7.28, 7.2',
  'present.spec.ts': '7.28, 7.2',
  'sw.spec.ts': '7.27',
}
const UNIT_SECTIONS = {
  cameraState: '7.5',
  coords: '7.6',
  grid: '7.6',
  config: '7.6, 7.24',
  store: '7.6, 7.14, 7.16',
  epoch: '7.7',
  revealState: '7.7',
  buildMask: '7.7, 7.17',
  compositor: '7.8, 7.12, 7.13, 7.14, 7.17',
  restrictedFrame: '7.10, 7.17, 7.22',
  letterbox: '7.10',
  faceBoundary: '7.11',
  faceClient: '7.11, 7.12',
  faceMapping: '7.12',
  faceValidate: '7.12, 7.17, 7.23',
  rect: '7.12',
  handTracker: '7.13',
  handLandmarker: '7.13',
  handClient: '7.13',
  handPipeline: '7.13',
  handBoundary: '7.13',
  fingertips: '7.14, 7.26',
  oneEuro: '7.15',
  handWindowSource: '7.15, 7.17, 7.26',
  sensitivity: '7.15',
  fakeHands: '7.15',
  closeGate: '7.16',
  cells: '7.17, 7.26',
  hullSolver: '7.17, 7.26',
  latency: '7.19',
  stats: '7.19',
  guidance: '7.20',
  session: '7.21',
  recorder: '7.22',
  zip: '7.22',
  subjectRule: '7.23',
  classifierClient: '7.23',
  stubModel: '7.23',
  uiState: '7.20, 7.28',
  landingScene: '7.28',
  envText: '7.24',
  localLog: '7.25',
  basePath: '7.27',
  networkGuard: '7.27',
  registerSw: '7.27',
  sw: '7.27',
}

function need(p, hint) {
  if (!existsSync(p)) {
    console.error(`thiếu ${p}: chạy ${hint}`)
    process.exit(1)
  }
  return JSON.parse(readFileSync(p, 'utf8'))
}
const unit = need(UNIT, 'npm run test:report (Vitest với --reporter=json)')
const e2e = need(E2E, 'npm run test:report (Playwright với reporter json)')
const deploy = existsSync(DEPLOY) ? JSON.parse(readFileSync(DEPLOY, 'utf8')) : null
const pkg = (name) =>
  JSON.parse(readFileSync(join(ROOT, 'node_modules', name, 'package.json'), 'utf8')).version
const models = JSON.parse(readFileSync(join(ROOT, 'public', 'models', 'models.json'), 'utf8'))
const browsers = JSON.parse(
  readFileSync(join(ROOT, 'node_modules', 'playwright-core', 'browsers.json'), 'utf8'),
)
const chromium =
  browsers.browsers.find((b) => b.name === 'chromium-headless-shell') ?? browsers.browsers[0]

const vi = (n, digits = 1) => n.toFixed(digits).replace('.', ',')
const secs = (ms) => `${vi(ms / 1000)} s`
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
const table = (header, rows) =>
  [
    `| ${header.join(' | ')} |`,
    `|${header.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  ].join('\n')
const has = (rel) => (existsSync(join(ROOT, rel)) ? 'có' : 'không')

// Unit: mỗi file một dòng.
const unitRows = []
let unitDur = 0
for (const f of unit.testResults) {
  const name = basename(f.name).replace(/\.test\.ts$/, '')
  const r = f.assertionResults
  const passed = r.filter((t) => t.status === 'passed').length
  const failed = r.filter((t) => t.status === 'failed').length
  const skipped = r.length - passed - failed
  const dur = r.reduce((a, t) => a + (t.duration ?? 0), 0)
  unitDur += dur
  unitRows.push([
    `${name}.test.ts`,
    UNIT_SECTIONS[name] ?? '',
    r.length,
    passed,
    failed,
    skipped,
    Math.round(dur),
  ])
}
unitRows.sort((a, b) => String(a[0]).localeCompare(String(b[0])))

// E2E: mỗi ca một dòng, gom theo file; annotations "đo" và "gate cứng" là số đo của ca.
const STATUS = { expected: 'pass', unexpected: 'FAIL', flaky: 'pass (thử lại)', skipped: 'bỏ qua' }
const files = []
const e2eTotal = { tests: 0, pass: 0, fail: 0, flaky: 0, skipped: 0, dur: 0 }
const gate = { tests: 0, frames: 0, clean: 0, dirty: 0, maxDiff: 0 }
function walk(suite, out, totals = e2eTotal, withProject = false) {
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests ?? []) {
      const results = t.results ?? []
      const dur = results.reduce((a, r) => a + (r.duration ?? 0), 0)
      const ann = t.annotations ?? []
      const notes = ann.filter((a) => a.type === 'đo').map((a) => a.description ?? '')
      const gates = ann.filter((a) => a.type === 'gate cứng').map((a) => a.description ?? '')
      for (const g of gates) {
        const m = /^(\d+) buffer so tham chiếu: (\d+) khớp, (\d+) lệch, maxDiff (\d+)/.exec(g)
        if (!m) continue
        gate.tests++
        gate.frames += Number(m[1])
        gate.clean += Number(m[2])
        gate.dirty += Number(m[3])
        gate.maxDiff = Math.max(gate.maxDiff, Number(m[4]))
      }
      totals.tests++
      totals.dur += dur
      if (t.status === 'expected') totals.pass++
      else if (t.status === 'flaky') totals.flaky++
      else if (t.status === 'skipped') totals.skipped++
      else totals.fail++
      const skipNote =
        t.status === 'skipped' ? (ann.find((a) => a.type === 'skip')?.description ?? '') : ''
      out.push({
        title: withProject && t.projectName ? `[${t.projectName}] ${spec.title}` : spec.title,
        status: STATUS[t.status] ?? t.status,
        dur,
        notes: [...notes, ...gates],
        skipNote,
      })
    }
  }
  for (const s of suite.suites ?? []) walk(s, out, totals, withProject)
}
for (const s of e2e.suites ?? []) {
  const rows = []
  walk(s, rows)
  files.push({ file: basename(s.file ?? s.title), rows })
}
files.sort((a, b) => a.file.localeCompare(b.file))
// REL-01: kết quả trên bản build (tests/deploy, project chromium và chrome nếu có), tổng riêng.
const deployTotal = { tests: 0, pass: 0, fail: 0, flaky: 0, skipped: 0, dur: 0 }
const deployFiles = []
for (const s of deploy?.suites ?? []) {
  const rows = []
  walk(s, rows, deployTotal, true)
  deployFiles.push({ file: basename(s.file ?? s.title), rows })
}

const ran = new Date(e2e.stats?.startTime ?? Date.now())
const cpu = os.cpus()
const env = [
  ['Hệ điều hành', `${os.type()} ${os.release()} (${os.arch()})`],
  [
    'CPU, RAM',
    `${cpu[0]?.model.trim() ?? '?'}, ${cpu.length} luồng, ${Math.round(os.totalmem() / 2 ** 30)} GB`,
  ],
  ['Node.js', process.version],
  ['Vite / Vitest / Playwright', `${pkg('vite')} / ${pkg('vitest')} / ${pkg('@playwright/test')}`],
  [
    'Trình duyệt e2e',
    `${chromium.title} ${chromium.browserVersion} (Playwright build ${chromium.revision}), camera giả của Chromium` +
      ` (\`--use-fake-device-for-media-stream\`), ${e2e.config?.workers ?? '?'} worker song song`,
  ],
  [
    'Model',
    models.models
      .map((m) => `${m.name} ${m.version} (sha256 ${m.sha256.slice(0, 12)}…)`)
      .join('; ') + `; ${models.wasm.package} ${models.wasm.version}`,
  ],
  [
    'Asset cục bộ',
    `face.png: ${has('public/spike-assets/face.png')}; hands.jpg: ${has('public/spike-assets/hands.jpg')};` +
      ` camera.y4m: ${has('tests/e2e/fixtures/camera.y4m')}`,
  ],
]

const out = []
out.push(BEGIN)
out.push(
  `Sinh bởi \`npm run test:report\` (\`tools/test-report.mjs\`) từ lần chạy lúc ${ran.toISOString()} trên máy phát triển. Không sửa tay phần này.`,
)
out.push('')
out.push('### Môi trường')
out.push('')
out.push(table(['Mục', 'Giá trị'], env))
out.push('')
out.push('### Unit (Vitest)')
out.push('')
out.push(
  `${unit.testResults.length} file, ${unit.numTotalTests} test: ${unit.numPassedTests} pass, ${unit.numFailedTests} fail,` +
    ` ${unit.numPendingTests + (unit.numTodoTests ?? 0)} bỏ qua; tổng thời gian test ${secs(unitDur)}.`,
)
out.push('')
out.push(table(['File', 'Mục 7', 'Test', 'Pass', 'Fail', 'Bỏ qua', 'ms'], unitRows))
out.push('')
out.push('### E2E (Playwright)')
out.push('')
out.push(
  `${files.length} spec, ${e2eTotal.tests} ca: ${e2eTotal.pass} pass, ${e2eTotal.flaky} pass sau thử lại, ${e2eTotal.fail} fail,` +
    ` ${e2eTotal.skipped} bỏ qua (thiếu asset cục bộ); tổng thời gian các ca ${secs(e2eTotal.dur)} (chạy song song).`,
)
out.push('')
out.push(
  'Gate cứng đo bằng ảnh tham chiếu (`installGateAudit`, cách đo thứ hai của mục 7.2): ' +
    `${gate.frames} buffer trong ${gate.tests} ca, ${gate.clean} khớp, ${gate.dirty} lệch, sai khác lớn nhất ${gate.maxDiff}/255.`,
)
out.push('')
const specTable = (f) =>
  table(
    ['Ca', 'Kết quả', 'Thời gian', 'Số đo'],
    f.rows.map((r) => [
      r.title,
      r.status + (r.skipNote ? `: ${r.skipNote}` : ''),
      secs(r.dur),
      r.notes.join('<br>'),
    ]),
  )
for (const f of files) {
  out.push(`#### ${f.file} (mục ${E2E_SECTIONS[f.file] ?? '?'})`)
  out.push('')
  out.push(specTable(f))
  out.push('')
}
if (deploy) {
  const projects = (deploy.config?.projects ?? []).map((p) => p.name).join(', ')
  out.push('### E2E trên bản build (Playwright, `npm run test:deploy`, REL-01)')
  out.push('')
  out.push(
    `\`dist/\` qua \`vite preview\` (playwright.deploy.config.ts), project ${projects || '?'}: ${deployTotal.tests} ca:` +
      ` ${deployTotal.pass} pass, ${deployTotal.fail} fail, ${deployTotal.skipped} bỏ qua; tổng thời gian ${secs(deployTotal.dur)} (tuần tự).`,
  )
  out.push('')
  for (const f of deployFiles) {
    out.push(`#### tests/deploy/${f.file} (mục ${E2E_SECTIONS[f.file] ?? '?'})`)
    out.push('')
    out.push(specTable(f))
    out.push('')
  }
}
out.push(END)

const doc = readFileSync(DOC, 'utf8')
const i = doc.indexOf(BEGIN)
const j = doc.indexOf(END)
if (i < 0 || j < 0 || j < i) {
  console.error(`${DOC} thiếu mốc ${BEGIN} … ${END}`)
  process.exit(1)
}
writeFileSync(DOC, doc.slice(0, i) + out.join('\n') + doc.slice(j + END.length))
console.log(
  `đã ghi ${DOC}: unit ${unit.numPassedTests}/${unit.numTotalTests}, e2e ${e2eTotal.pass + e2eTotal.flaky}/${e2eTotal.tests}` +
    ` (${e2eTotal.skipped} bỏ qua), gate ${gate.clean}/${gate.frames} buffer khớp` +
    (deploy
      ? `, deploy ${deployTotal.pass}/${deployTotal.tests}`
      : ', deploy: không có reports/deploy.json'),
)
if (unit.numFailedTests > 0 || e2eTotal.fail > 0 || deployTotal.fail > 0) process.exit(1)
