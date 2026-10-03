import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import {
  expectGateClean,
  installGateAudit,
  installGumCounter,
  note,
  openApp,
  readStage,
  seedConsent,
  type ClassifierSnap,
} from './helpers'

// CLS-03 (mục 7.35, D-061): model phân loại huấn luyện (public/models/classifier.onnx, không commit). Chỉ chạy khi máy
// có file và sha256 khớp models.json, đúng điều kiện vite.config.ts (resolveClassifier) dùng để chọn model; CI chưa có
// model nên bỏ qua (classify.spec vẫn kiểm đường ống với stub). Ca mặt dùng public/spike-assets/face.png (người thật,
// không có trong dataset) như classify.spec.
const MODEL_FILE = 'public/models/classifier.onnx'
const FACE_FILE = 'public/spike-assets/face.png'
const FACE_SRC = '/spike-assets/face.png'

function trainedModelReady(): string | null {
  if (!existsSync(MODEL_FILE)) return `chưa có ${MODEL_FILE} (tools/train/export_onnx.py)`
  const manifest = JSON.parse(readFileSync('public/models/models.json', 'utf8')) as {
    classifier: { sha256: string }
  }
  const sha = createHash('sha256').update(readFileSync(MODEL_FILE)).digest('hex')
  return sha === manifest.classifier.sha256 ? null : `${MODEL_FILE} lệch sha256 của models.json`
}
const skipReason = trainedModelReady()

const readCls = (page: Page): Promise<ClassifierSnap> =>
  page.evaluate(() => window.__wct!.classifier!.snapshot())

test('build mặc định dùng model huấn luyện khi file khớp models.json; ?classifier=stub đè về stub', async ({
  page,
}) => {
  test.skip(skipReason !== null, skipReason ?? '')
  await seedConsent(page)
  // Không qua openApp để không bị ghim stub: đây là mặc định của build.
  await page.goto('about:blank')
  await page.goto('/#/app?debug=1&source=synthetic&logo=0')
  await expect(page.locator('canvas#stage')).toBeVisible()
  const byDefault = await readCls(page)
  expect(byDefault.modelPath).toBe('/models/classifier.onnx')
  expect(byDefault.started).toBe(false)
  await openApp(page, '?debug=1&source=synthetic')
  expect((await readCls(page)).modelPath).toBe('/models/classifier-stub.onnx')
  note(
    'mặc định: /models/classifier.onnx; ?classifier=stub (openApp): /models/classifier-stub.onnx',
  )
})

test('model huấn luyện trên mặt người thật ngoài dataset (face.png cục bộ): sẵn sàng, gắn "person" vào mặt, nhãn không có "demo"', async ({
  page,
}) => {
  test.skip(skipReason !== null, skipReason ?? '')
  test.skip(!existsSync(FACE_FILE), `thiếu ${FACE_FILE} (asset spike cục bộ, không commit)`)
  test.setTimeout(180_000)
  await installGumCounter(page)
  await seedConsent(page)
  await openApp(page, '?debug=1&source=synthetic&classifier=model')
  await expect(page.locator('canvas#stage')).toBeVisible()
  const st = await readStage(page)
  await installGateAudit(page)
  // Như classify.spec: ảnh 958 × 1358 vẽ tỉ lệ 0,5 tại IMG trên nền magenta; mặt khoảng FACE_CAM (px camera).
  const IMG = { x: 400, y: 20, w: 479, h: 679 }
  const FACE_CAM = { x: 560, y: 70, w: 170, h: 210 }
  await page.evaluate(
    ([src, img]) => window.__scenario!.scene({ person: null, face: { src, ...img } }),
    [FACE_SRC, IMG] as const,
  )
  await page.waitForFunction(() => window.__wct?.face?.snapshot().ready === true, undefined, {
    timeout: 120_000,
  })
  const L = st.layout
  const center = { x: FACE_CAM.x + FACE_CAM.w / 2, y: FACE_CAM.y + FACE_CAM.h / 2 }
  const sx = (st.settings.mirror ? L.cam.w - center.x : center.x) * L.scale + L.board.x
  const sy = center.y * L.scale + L.board.y
  const N = 16
  const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi, v))
  const col = clamp(Math.round((sx - L.board.x) / L.c - N / 2), L.cols - N)
  const row = clamp(Math.round((sy - L.board.y) / L.c - N / 2), L.rows - N)
  await page.evaluate(
    ([c, r, n]) => window.__scenario!.run(`windowAt(${c},${r},${n})`),
    [col, row, N],
  )
  await page.waitForFunction(() => window.__wct?.classifier?.snapshot().ready === true, undefined, {
    timeout: 120_000,
  })
  // Như classify.spec: đọc trong trang theo rAF tới khi cùng một snapshot có mặt và nhãn của ít nhất 3 kết quả.
  const l = await page.evaluate(
    () =>
      new Promise<{
        subject: { probs: number[]; roiShortPx: number }
        face: { status: string; subjectType: string; confidence?: number; visible: number }
        accepted: number
      }>((resolve, reject) => {
        const t0 = performance.now()
        const poll = () => {
          const s = window.__wct!.loop!.snapshot()
          const face = s.output.faces[0]
          if (face && s.subject && s.classifyGate.accepted >= 3)
            return resolve({ subject: s.subject, face, accepted: s.classifyGate.accepted })
          if (performance.now() - t0 > 90_000)
            return reject(new Error('hết 90 s chờ mặt có nhãn trong cùng snapshot'))
          requestAnimationFrame(poll)
        }
        poll()
      }),
  )
  const c = await readCls(page)
  expect(c.modelPath).toBe('/models/classifier.onnx')
  expect(['wasm', 'webgpu']).toContain(c.ep)
  expect(c.stats.errors).toBe(0)
  expect(l.face.subjectType).toBe('person')
  expect(l.subject.probs[0]).toBeGreaterThanOrEqual(0.7)
  expect(l.face.confidence).toBeCloseTo(l.subject.probs[0], 6)
  // Lớp hướng dẫn gọi tên nhãn và không còn câu "model demo theo màu" (D-051).
  await expect(page.getByTestId('guide')).toContainText('Người')
  await expect(page.getByTestId('guide')).not.toContainText('demo')
  note(
    `model ${c.modelPath}, EP ${c.ep}, init ${c.stats.initMs.toFixed(0)} ms, warm-up ${c.stats.warmupMs.toFixed(0)} ms, infer p50 ${c.stats.p50InferMs.toFixed(1)} / p95 ${c.stats.p95InferMs.toFixed(1)} ms; mặt ${l.face.status} → ${l.face.subjectType} ${(l.face.confidence ?? 0).toFixed(3)} (probs ${l.subject.probs.map((p) => p.toFixed(3)).join('/')}, ROI ${l.subject.roiShortPx} px, ${l.accepted} kết quả)`,
  )
  await expectGateClean(page)
})
