// QA-01: generates the results section of docs/test-report-mask.md from reports/unit.json (Vitest json reporter) and
// reports/e2e.json (Playwright json reporter, with the "đo" (measurement) and "gate cứng" (hard gate) annotations written
// by tests/e2e/helpers.ts), plus reports/deploy.json when present (REL-01: `npm run test:deploy`, production build via
// vite preview, its own section), together with the environment (OS, CPU, Node, Vite, Vitest, Playwright, Chromium per
// Playwright's browsers.json), models (public/models/models.json) and local assets. Only the part between
// <!-- report:begin --> and <!-- report:end --> is overwritten; the rest of the document is hand-written. Run:
// npm run test:report (run the tests, then generate) or npm run test:report:write (generate from existing JSON only).
// No network, no browser. The annotation type names and the hard-gate string format are contracts with the test code
// and stay as the tests write them (Vietnamese).
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

/** Section 7 of WORK-BREAKDOWN covered by each test file (7.1 is the plan's case mapping table, 7.2 the hard gate). */
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
  'hands.spec.ts': '7.13, 7.14, 7.15, 7.17, 7.26, 7.32',
  'solver.spec.ts': '7.15, 7.17, 7.26, 7.32, 7.1, 7.2',
  'integration.spec.ts': '7.16, 7.2',
  'stats.spec.ts': '7.19, 7.2',
  'ux.spec.ts': '7.20, 7.28, 7.2',
  'present.spec.ts': '7.28, 7.2',
  'guide.spec.ts': '7.30, 7.2',
  'i18n.spec.ts': '7.31, 7.2',
  'perf.spec.ts': '7.29, 7.2',
  'logo.spec.ts': '7.33, 7.2',
  'sw.spec.ts': '7.27',
}
const UNIT_SECTIONS = {
  cameraState: '7.5',
  coords: '7.6',
  grid: '7.6',
  config: '7.6, 7.24, 7.32, 7.33',
  brandLogo: '7.33',
  store: '7.6, 7.14, 7.16, 7.32',
  epoch: '7.7',
  revealState: '7.7',
  buildMask: '7.7, 7.17',
  compositor: '7.8, 7.12, 7.13, 7.14, 7.17, 7.33',
  restrictedFrame: '7.10, 7.17, 7.22',
  letterbox: '7.10',
  faceBoundary: '7.11',
  faceClient: '7.11, 7.12',
  faceMapping: '7.12',
  faceValidate: '7.12, 7.17, 7.23',
  rect: '7.12',
  handTracker: '7.13, 7.32',
  handLandmarker: '7.13',
  handClient: '7.13',
  handPipeline: '7.13',
  handBoundary: '7.13',
  fingerPose: '7.32',
  fingertips: '7.14, 7.26, 7.32',
  oneEuro: '7.15',
  handWindowSource: '7.15, 7.17, 7.26',
  sensitivity: '7.15',
  fakeHands: '7.15, 7.32',
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
  uiState: '7.20, 7.28, 7.33',
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
    console.error(`missing ${p}: run ${hint}`)
    process.exit(1)
  }
  return JSON.parse(readFileSync(p, 'utf8'))
}
const unit = need(UNIT, 'npm run test:report (Vitest with --reporter=json)')
const e2e = need(E2E, 'npm run test:report (Playwright with the json reporter)')
const deploy = existsSync(DEPLOY) ? JSON.parse(readFileSync(DEPLOY, 'utf8')) : null
const pkg = (name) =>
  JSON.parse(readFileSync(join(ROOT, 'node_modules', name, 'package.json'), 'utf8')).version
const models = JSON.parse(readFileSync(join(ROOT, 'public', 'models', 'models.json'), 'utf8'))
const browsers = JSON.parse(
  readFileSync(join(ROOT, 'node_modules', 'playwright-core', 'browsers.json'), 'utf8'),
)
const chromium =
  browsers.browsers.find((b) => b.name === 'chromium-headless-shell') ?? browsers.browsers[0]

const vi = (n, digits = 1) => n.toFixed(digits)
const secs = (ms) => `${vi(ms / 1000)} s`
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
const table = (header, rows) =>
  [
    `| ${header.join(' | ')} |`,
    `|${header.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  ].join('\n')
const has = (rel) => (existsSync(join(ROOT, rel)) ? 'yes' : 'no')

// Unit: one row per file.
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

// E2E: one row per case, grouped by file; the "đo" and "gate cứng" annotations are the case's measurements.
const STATUS = { expected: 'pass', unexpected: 'FAIL', flaky: 'pass (retry)', skipped: 'skipped' }
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
// REL-01: results on the production build (tests/deploy, projects chromium and chrome when present), separate totals.
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
  ['Operating system', `${os.type()} ${os.release()} (${os.arch()})`],
  [
    'CPU, RAM',
    `${cpu[0]?.model.trim() ?? '?'}, ${cpu.length} threads, ${Math.round(os.totalmem() / 2 ** 30)} GB`,
  ],
  ['Node.js', process.version],
  ['Vite / Vitest / Playwright', `${pkg('vite')} / ${pkg('vitest')} / ${pkg('@playwright/test')}`],
  [
    'E2E browser',
    `${chromium.title} ${chromium.browserVersion} (Playwright build ${chromium.revision}), Chromium fake camera` +
      ` (\`--use-fake-device-for-media-stream\`), ${e2e.config?.workers ?? '?'} parallel workers`,
  ],
  [
    'Model',
    models.models
      .map((m) => `${m.name} ${m.version} (sha256 ${m.sha256.slice(0, 12)}…)`)
      .join('; ') + `; ${models.wasm.package} ${models.wasm.version}`,
  ],
  [
    'Local assets',
    `face.png: ${has('public/spike-assets/face.png')}; hands.jpg: ${has('public/spike-assets/hands.jpg')};` +
      ` camera.y4m: ${has('tests/e2e/fixtures/camera.y4m')}`,
  ],
]

const out = []
out.push(BEGIN)
out.push(
  `Generated by \`npm run test:report\` (\`tools/test-report.mjs\`) from the run at ${ran.toISOString()} on the development machine. Do not edit this section by hand.`,
)
out.push('')
out.push('### Environment')
out.push('')
out.push(table(['Item', 'Value'], env))
out.push('')
out.push('### Unit (Vitest)')
out.push('')
out.push(
  `${unit.testResults.length} file, ${unit.numTotalTests} test: ${unit.numPassedTests} pass, ${unit.numFailedTests} fail,` +
    ` ${unit.numPendingTests + (unit.numTodoTests ?? 0)} skipped; total test time ${secs(unitDur)}.`,
)
out.push('')
out.push(table(['File', 'Section 7', 'Tests', 'Pass', 'Fail', 'Skipped', 'ms'], unitRows))
out.push('')
out.push('### E2E (Playwright)')
out.push('')
out.push(
  `${files.length} spec files, ${e2eTotal.tests} cases: ${e2eTotal.pass} pass, ${e2eTotal.flaky} pass after retry, ${e2eTotal.fail} fail,` +
    ` ${e2eTotal.skipped} skipped (missing local assets); total case time ${secs(e2eTotal.dur)} (run in parallel).`,
)
out.push('')
out.push(
  'Hard gate measured against reference images (`installGateAudit`, the second method of section 7.2): ' +
    `${gate.frames} buffers in ${gate.tests} cases, ${gate.clean} matching, ${gate.dirty} deviating, largest difference ${gate.maxDiff}/255.`,
)
out.push('')
const specTable = (f) =>
  table(
    ['Case', 'Result', 'Time', 'Measurements'],
    f.rows.map((r) => [
      r.title,
      r.status + (r.skipNote ? `: ${r.skipNote}` : ''),
      secs(r.dur),
      r.notes.join('<br>'),
    ]),
  )
for (const f of files) {
  out.push(`#### ${f.file} (section ${E2E_SECTIONS[f.file] ?? '?'})`)
  out.push('')
  out.push(specTable(f))
  out.push('')
}
if (deploy) {
  const projects = (deploy.config?.projects ?? []).map((p) => p.name).join(', ')
  out.push('### E2E on the production build (Playwright, `npm run test:deploy`, REL-01)')
  out.push('')
  out.push(
    `\`dist/\` via \`vite preview\` (playwright.deploy.config.ts), projects ${projects || '?'}: ${deployTotal.tests} cases:` +
      ` ${deployTotal.pass} pass, ${deployTotal.fail} fail, ${deployTotal.skipped} skipped; total time ${secs(deployTotal.dur)} (sequential).`,
  )
  out.push('')
  for (const f of deployFiles) {
    out.push(`#### tests/deploy/${f.file} (section ${E2E_SECTIONS[f.file] ?? '?'})`)
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
  console.error(`${DOC} is missing the markers ${BEGIN} … ${END}`)
  process.exit(1)
}
writeFileSync(DOC, doc.slice(0, i) + out.join('\n') + doc.slice(j + END.length))
console.log(
  `wrote ${DOC}: unit ${unit.numPassedTests}/${unit.numTotalTests}, e2e ${e2eTotal.pass + e2eTotal.flaky}/${e2eTotal.tests}` +
    ` (${e2eTotal.skipped} skipped), gate ${gate.clean}/${gate.frames} buffers matching` +
    (deploy
      ? `, deploy ${deployTotal.pass}/${deployTotal.tests}`
      : ', deploy: no reports/deploy.json'),
)
if (unit.numFailedTests > 0 || e2eTotal.fail > 0 || deployTotal.fail > 0) process.exit(1)
