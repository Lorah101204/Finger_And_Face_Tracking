import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import {
  expectCanvasWhite,
  expectGateClean,
  installGateAudit,
  installGumCounter,
  note,
  openApp,
  readFace,
  readLoop,
  readStage,
  seedConsent,
  type LoopSnap,
  type StageSnap,
} from './helpers'

// FACE-02 (mục 7.12), chạy cục bộ: cần public/spike-assets/face.png (asset spike S1, không commit). Ảnh 958 × 1358 vẽ
// vào camera tổng hợp tại IMG (tỉ lệ 0,5); mặt nằm khoảng FACE_CAM (ước lượng, chỉ dùng để đặt cửa sổ). Kiểm: full khi
// mặt trọn trong cửa sổ, partial khi cửa sổ cắt mặt, overlay không bao giờ ra ngoài stageRect, đóng thì mặt biến mất
// kể cả khi kết quả về muộn (delayWorker), kết quả quá tuổi bị loại.
const FACE_FILE = 'public/spike-assets/face.png'
const FACE_SRC = '/spike-assets/face.png'
const IMG = { x: 400, y: 20, w: 479, h: 679 }
const FACE_CAM = { x: 560, y: 70, w: 170, h: 210 }
const FULL = [24, 128, 56]
const PARTIAL = [249, 171, 0]
const N = 16

test.skip(!existsSync(FACE_FILE), `cần ${FACE_FILE} (asset spike, không commit)`)

type Pt = { x: number; y: number }
type Rect = { x: number; y: number; w: number; h: number }

function camToStage(p: Pt, st: StageSnap): Pt {
  const { board, scale, camVisibleRect: cv } = st.layout
  const dx = (p.x - cv.x) * scale
  return {
    x: st.settings.mirror ? board.x + board.w - dx : board.x + dx,
    y: board.y + (p.y - cv.y) * scale,
  }
}

function stageToCam(p: Pt, st: StageSnap): Pt {
  const { board, scale, camVisibleRect: cv } = st.layout
  const dx = st.settings.mirror ? board.x + board.w - p.x : p.x - board.x
  return { x: cv.x + dx / scale, y: cv.y + (p.y - board.y) / scale }
}

/** Cửa sổ n ô có tâm gần điểm camera cho trước, kẹp trong bảng. */
function windowAround(pCam: Pt, n: number, st: StageSnap): { col: number; row: number } {
  const s = camToStage(pCam, st)
  const { board, c, cols, rows } = st.layout
  const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi, v))
  return {
    col: clamp(Math.round((s.x - board.x) / c - n / 2), cols - n),
    row: clamp(Math.round((s.y - board.y) / c - n / 2), rows - n),
  }
}

function run(page: Page, command: string): Promise<unknown> {
  return page.evaluate((cmd) => window.__scenario!.run(cmd), command)
}

/**
 * Đợi một snapshot vòng lặp thỏa điều kiện và trả đúng snapshot đó (đọc hai lần thì mặt có thể đã đổi giữa chừng khi
 * suy luận chậm dưới tải của cả bộ e2e).
 */
async function waitLoop(
  page: Page,
  pred: (l: LoopSnap) => boolean,
  timeout = 60_000,
): Promise<LoopSnap> {
  const t0 = Date.now()
  for (;;) {
    const l = await readLoop(page)
    if (pred(l)) return l
    if (Date.now() - t0 > timeout) throw new Error(`hết ${timeout} ms chờ trạng thái vòng lặp`)
    await page.waitForTimeout(100)
  }
}

async function openFaceScene(page: Page): Promise<StageSnap> {
  await installGumCounter(page)
  await seedConsent(page)
  await openApp(page, '?debug=1&source=synthetic')
  await expect(page.locator('canvas#stage')).toBeVisible()
  const st = await readStage(page)
  await installGateAudit(page)
  await page.evaluate(
    ([src, img]) => window.__scenario!.scene({ person: null, face: { src, ...img } }),
    [FACE_SRC, IMG] as const,
  )
  // Nạp wasm, model và biên dịch shader (GPU delegate qua SwiftShader) trong lúc cả bộ e2e chạy song song với các ca
  // tay (HAND-01, worker CPU liên tục) có thể mất hơn một phút.
  await page.waitForFunction(() => window.__wct?.face?.snapshot().ready === true, undefined, {
    timeout: 120_000,
  })
  return st
}

/**
 * Overlay mặt phải xuất hiện trong rect (ít nhất minInside pixel) và không có pixel nào ngoài rect, đo trong cùng một
 * lần đọc canvas; poll vì dưới tải của cả bộ e2e mặt có thể hết hạn rồi về lại giữa hai lần đọc.
 */
async function expectOverlayIn(page: Page, r: Rect, minInside: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const px = await overlayPixels(page, r)
        return px.inside > minInside && px.outside === 0
      },
      { timeout: 30_000 },
    )
    .toBe(true)
}

/** Đếm pixel màu overlay mặt (full hoặc partial) trong và ngoài rect trên canvas output. */
function overlayPixels(page: Page, r: Rect): Promise<{ inside: number; outside: number }> {
  return page.evaluate(
    ([r, full, partial]) => {
      const c = document.querySelector<HTMLCanvasElement>('canvas#stage')!
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
      let inside = 0
      let outside = 0
      for (let y = 0; y < c.height; y++)
        for (let x = 0; x < c.width; x++) {
          const i = (y * c.width + x) * 4
          const isFull = d[i] === full[0] && d[i + 1] === full[1] && d[i + 2] === full[2]
          const isPart = d[i] === partial[0] && d[i + 1] === partial[1] && d[i + 2] === partial[2]
          if (!isFull && !isPart) continue
          if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) inside++
          else outside++
        }
      return { inside, outside }
    },
    [r, FULL, PARTIAL] as const,
  )
}

test('mặt trọn trong cửa sổ: full, landmark và overlay chỉ trong stageRect, bbox camera nằm trong ảnh', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const st = await openFaceScene(page)
  const center = { x: FACE_CAM.x + FACE_CAM.w / 2, y: FACE_CAM.y + FACE_CAM.h / 2 }
  const { col, row } = windowAround(center, N, st)
  await run(page, `windowAt(${col},${row},${N})`)
  const L = await waitLoop(
    page,
    (l) =>
      l.output.status === 'face-candidate' &&
      l.output.faces.length === 1 &&
      l.output.faces[0].status === 'full',
  )
  const sr = L.mask!.stageRect
  const f = L.output.faces[0]
  expect(f.landmarksStage.length).toBeGreaterThan(400)
  for (const p of f.landmarksStage) {
    expect(p.x).toBeGreaterThanOrEqual(sr.x)
    expect(p.x).toBeLessThan(sr.x + sr.w)
    expect(p.y).toBeGreaterThanOrEqual(sr.y)
    expect(p.y).toBeLessThan(sr.y + sr.h)
  }
  const b = f.bboxStage
  expect(b.x).toBeGreaterThanOrEqual(sr.x)
  expect(b.y).toBeGreaterThanOrEqual(sr.y)
  expect(b.x + b.w).toBeLessThanOrEqual(sr.x + sr.w)
  expect(b.y + b.h).toBeLessThanOrEqual(sr.y + sr.h)
  // bbox về không gian camera phải nằm trong ảnh đã vẽ (kiểm ánh xạ ngược, kể cả mirror).
  const c1 = stageToCam({ x: b.x, y: b.y }, st)
  const c2 = stageToCam({ x: b.x + b.w, y: b.y + b.h }, st)
  for (const p of [c1, c2]) {
    expect(p.x).toBeGreaterThanOrEqual(IMG.x - 1)
    expect(p.x).toBeLessThanOrEqual(IMG.x + IMG.w + 1)
    expect(p.y).toBeGreaterThanOrEqual(IMG.y - 1)
    expect(p.y).toBeLessThanOrEqual(IMG.y + IMG.h + 1)
  }
  expect(Math.abs(c1.x - c2.x)).toBeGreaterThan(80)
  await expectOverlayIn(page, sr, 100)
  // Dưới tải của cả bộ e2e mặt có thể hết hạn vài giây rồi về lại: chờ tới 30 s cho thông điệp.
  await expect(page.getByTestId('stage-status')).toHaveText(/Thấy khuôn mặt/, { timeout: 30_000 })
  // Vài suy luận đầu trong headless có thể chậm hơn 250 ms (bị loại vì quá tuổi); gate vẫn phải nhận được kết quả.
  expect(L.faceGate.accepted).toBeGreaterThan(0)
  expect(L.faceGate.rejected.epoch).toBe(0)
  const ov = await overlayPixels(page, sr)
  note(
    `full: ${f.landmarksStage.length} landmark trong stageRect, bbox ${Math.round(b.w)}×${Math.round(b.h)} px; overlay` +
      ` trong ${ov.inside} px, ngoài ${ov.outside} px; gate nhận ${L.faceGate.accepted}, loại cũ ${L.faceGate.rejected.stale}`,
  )
  await expectGateClean(page)
})

test('cửa sổ cắt mặt: partial, không landmark ngoài vùng, overlay không ra ngoài, gợi ý mở rộng', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const st = await openFaceScene(page)
  // Mép trái (theo camera) của cửa sổ đặt tại 35 % chiều rộng mặt: mặt hở 65 %, phần còn lại nằm dưới vùng trắng.
  const winCamW = (N * st.layout.c) / st.layout.scale
  const left = FACE_CAM.x + 0.35 * FACE_CAM.w
  const { col, row } = windowAround(
    { x: left + winCamW / 2, y: FACE_CAM.y + FACE_CAM.h / 2 },
    N,
    st,
  )
  await run(page, `windowAt(${col},${row},${N})`)
  const L = await waitLoop(
    page,
    (l) => l.output.status === 'partial-face' && l.output.faces[0]?.status === 'partial',
  )
  const sr = L.mask!.stageRect
  const f = L.output.faces[0]
  expect(f.landmarksStage.length).toBeGreaterThan(50)
  for (const p of f.landmarksStage) {
    expect(p.x).toBeGreaterThanOrEqual(sr.x)
    expect(p.x).toBeLessThan(sr.x + sr.w)
  }
  await expectOverlayIn(page, sr, 50)
  await expect(page.getByTestId('stage-status')).toHaveText(/bị cắt: mở rộng/, { timeout: 30_000 })
  const ov = await overlayPixels(page, sr)
  note(
    `partial (mặt hở 65 %): ${f.landmarksStage.length} landmark, tất cả trong stageRect; overlay trong ${ov.inside} px,` +
      ` ngoài ${ov.outside} px`,
  )
  await expectGateClean(page)
})

test('delayWorker(500) rồi đóng: mặt biến mất ngay và không hiện lại; mở lại thì có mặt; kết quả quá tuổi bị loại', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const st = await openFaceScene(page)
  const center = { x: FACE_CAM.x + FACE_CAM.w / 2, y: FACE_CAM.y + FACE_CAM.h / 2 }
  const { col, row } = windowAround(center, N, st)
  await run(page, `windowAt(${col},${row},${N})`)
  await expect
    .poll(async () => (await readLoop(page)).output.status, { timeout: 30_000 })
    .toBe('face-candidate')

  // Kết quả đang chạy sẽ về muộn 500 ms; đóng ngay: frame kế không còn mặt, và khi kết quả về cũng không hiện.
  await run(page, 'delayWorker(500)')
  await page.waitForTimeout(150)
  await run(page, 'coverAll')
  await expect.poll(async () => (await readLoop(page)).output.status).toBe('covered')
  expect((await readLoop(page)).output.faces).toEqual([])
  await page.waitForTimeout(900)
  const after = await readLoop(page)
  expect(after.output.status).toBe('covered')
  expect(after.output.faces).toEqual([])
  expect(after.mask).toBeNull()
  await expectCanvasWhite(page)
  const px = await overlayPixels(page, { x: 0, y: 0, w: 0, h: 0 })
  expect(px.outside).toBe(0)

  // Mở lại không trễ: mặt về với epoch mới.
  await run(page, 'delayWorker(0)')
  await run(page, `windowAt(${col},${row},${N})`)
  await expect
    .poll(async () => (await readLoop(page)).output.status, { timeout: 30_000 })
    .toBe('face-candidate')
  const reopened = await readLoop(page)
  expect(reopened.output.epoch).toBeGreaterThan(st.epoch)

  // Đang mở mà kết quả về muộn hơn 250 ms: bị loại vì quá tuổi, mặt cũ hết hạn, trạng thái về searching.
  const stale0 = reopened.faceGate.rejected.stale
  await run(page, 'delayWorker(500)')
  await expect
    .poll(async () => (await readLoop(page)).faceGate.rejected.stale, { timeout: 20_000 })
    .toBeGreaterThan(stale0)
  await expect
    .poll(async () => (await readLoop(page)).output.status, { timeout: 20_000 })
    .toBe('searching')
  expect((await readLoop(page)).output.faces).toEqual([])
  await expect(page.getByTestId('stage-status')).toHaveText(/Đang tìm khuôn mặt/)
  const g = (await readLoop(page)).faceGate
  note(
    `delayWorker(500) rồi đóng: mặt rỗng ngay và sau 900 ms, overlay 0 px; mở lại epoch ${st.epoch} → ${reopened.output.epoch};` +
      ` kết quả muộn > 250 ms bị loại: stale ${stale0} → ${g.rejected.stale}`,
  )
  await expectGateClean(page)
})

// QA-01 (mục 7.1 "kéo cửa sổ sang vị trí khác"): tác vụ đang chạy khi cửa sổ dời (cùng epoch) thì kết quả về được ánh
// xạ theo ROI của tác vụ đó (task.roiCam), không theo mask mới: mặt vẫn ở đúng chỗ mặt thật, chỉ giữ landmark trong
// stageRect mới. Để tất định dưới tải: faceMaxAge(4000) nới tuổi tối đa (chỉ ?debug=1), delayWorker(1000) giữ tác vụ
// đang chạy lúc dời, poll theo rAF trong trang bắt đúng lúc tác vụ vừa gửi; kết quả đầu tiên gate nhận sau khi dời
// phải là của ROI cũ (faceGate.lastAccepted.roiCam), rồi kết quả của ROI mới cũng đặt mặt đúng chỗ.
test('kéo cửa sổ khi tác vụ đang chạy: kết quả cũ ánh xạ theo ROI của tác vụ (mặt không dời theo cửa sổ), landmark chỉ trong stageRect mới', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const st = await openFaceScene(page)
  const center = { x: FACE_CAM.x + FACE_CAM.w / 2, y: FACE_CAM.y + FACE_CAM.h / 2 }
  const { col, row } = windowAround(center, N, st)
  const SHIFT = 3
  await run(page, `windowAt(${col},${row},${N})`)
  const L0 = await waitLoop(
    page,
    (l) => l.output.status === 'face-candidate' && l.output.faces[0]?.status === 'full',
  )
  const roiA = L0.mask!.cameraRect
  const b0 = L0.output.faces[0].bboxStage
  const c0 = { x: b0.x + b0.w / 2, y: b0.y + b0.h / 2 }
  const sameRect = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
  const faceAt = (l: LoopSnap) => {
    const f = l.output.faces[0]
    const dx = f.bboxStage.x + f.bboxStage.w / 2 - c0.x
    const dy = f.bboxStage.y + f.bboxStage.h / 2 - c0.y
    expect(Math.abs(dx)).toBeLessThanOrEqual(12)
    expect(Math.abs(dy)).toBeLessThanOrEqual(12)
    const sr = l.mask!.stageRect
    for (const p of f.landmarksStage) {
      expect(p.x).toBeGreaterThanOrEqual(sr.x)
      expect(p.x).toBeLessThan(sr.x + sr.w)
    }
    return { dx, dy, landmarks: f.landmarksStage.length }
  }

  await run(page, 'faceMaxAge(4000)')
  await run(page, 'delayWorker(1000)')
  const sent0 = (await readFace(page)).stats.submitted
  await page.waitForFunction(
    (n) => {
      const f = window.__wct!.face!.snapshot()
      return f.busy && f.stats.submitted > n
    },
    sent0,
    { polling: 'raf', timeout: 15_000 },
  )
  const before = await readLoop(page)
  await run(page, `moveWindow(${col + SHIFT},${row})`)
  // Kết quả đầu tiên gate nhận sau khi dời là của tác vụ đang chạy (ROI cũ): mặt vẫn đúng chỗ, landmark trong stageRect mới.
  // Đọc snapshot ngay trong trang theo rAF: mặt của kết quả chỉ được giữ faceResultMaxAgeMs × 4 (1 s) khi worker trễ
  // 1 s nên vòng poll từ Node (100 ms cộng round-trip khi cả bộ chạy song song) có thể đọc trễ và thấy faces rỗng.
  const L1 = await page.evaluate(
    (n) =>
      new Promise<LoopSnap>((resolve, reject) => {
        const t0 = performance.now()
        const poll = () => {
          const l = window.__wct!.loop!.snapshot()
          if (l.faceGate.accepted > n) return resolve(l)
          if (performance.now() - t0 > 20_000)
            return reject(new Error('hết 20 s chờ kết quả sau khi dời'))
          requestAnimationFrame(poll)
        }
        poll()
      }),
    before.faceGate.accepted,
  )
  expect(L1.mask?.shape.window.col).toBe(col + SHIFT)
  const la = L1.faceGate.lastAccepted!
  expect(sameRect(la.roiCam, roiA)).toBe(true)
  expect(la.faces).toBeGreaterThan(0)
  expect(la.ageMs).toBeGreaterThan(250)
  const old = faceAt(L1)
  // Kết quả của ROI mới cũng đặt mặt đúng chỗ đó (mặt không dời theo cửa sổ).
  await run(page, 'delayWorker(0)')
  const roiB = L1.mask!.cameraRect
  expect(sameRect(roiB, roiA)).toBe(false)
  const L2 = await waitLoop(
    page,
    (l) =>
      l.faceGate.lastAccepted !== null &&
      sameRect(l.faceGate.lastAccepted.roiCam, roiB) &&
      l.output.faces.length > 0,
    30_000,
  )
  const fresh = faceAt(L2)
  await run(page, 'faceMaxAge(0)')
  note(
    `dời ${SHIFT} ô khi tác vụ đang chạy: kết quả ROI cũ (tuổi ${la.ageMs.toFixed(0)} ms, ${old.landmarks} landmark) đặt mặt lệch` +
      ` (${old.dx.toFixed(1)}, ${old.dy.toFixed(1)}) px so với trước khi dời; kết quả ROI mới lệch (${fresh.dx.toFixed(1)},` +
      ` ${fresh.dy.toFixed(1)}) px; landmark đều trong stageRect mới`,
  )
  await expectGateClean(page)
})
