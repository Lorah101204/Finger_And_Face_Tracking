import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import {
  HAND_LEFT,
  HAND_RIGHT,
  expectCanvasWhite,
  expectGateClean,
  installGateAudit,
  installGumCounter,
  note,
  openApp,
  readHands,
  readLoop,
  readStage,
  seedConsent,
} from './helpers'

// HAND-01 (mục 7.13): hand pipeline chạy khi nguồn cửa sổ là "Tay" với worker thật trong Chromium headless. Phần
// không cần ảnh: worker chỉ khởi tạo khi chọn tay, nền tổng hợp không có tay, rời nguồn tay thì dừng. Phần có tay
// thật chạy cục bộ với public/spike-assets/hands.jpg (asset spike S3, 640 × 960, không commit): nhãn trái/phải theo
// S3 (tay dưới bên trái khung là tay trái, tay trên bên phải là tay phải), id ổn định khi ảnh di chuyển, overlay
// trên nền trắng, cờ đảo trái/phải.
const HANDS_FILE = 'public/spike-assets/hands.jpg'
const HANDS_SRC = '/spike-assets/hands.jpg'
/** Ảnh 640 × 960 vẽ tỉ lệ 0,75 vào giữa khung 1280 × 720. */
const IMG = { x: 400, y: 0, w: 480, h: 720 }

async function openSynthetic(page: Page) {
  await installGumCounter(page)
  await seedConsent(page)
  await openApp(page, '?debug=1&source=synthetic')
  await expect(page.locator('canvas#stage')).toBeVisible()
  const st = await readStage(page)
  // QA-01: gate cứng đo trên các đoạn ảnh đứng yên (đoạn ảnh chạy được bỏ qua).
  await installGateAudit(page)
  return st
}

async function selectHands(page: Page): Promise<void> {
  await page.getByLabel('Nguồn cửa sổ').selectOption('hands')
  // Nạp wasm và model trong lúc cả bộ e2e chạy song song có thể mất hơn một phút.
  await page.waitForFunction(
    () => window.__wct?.hands?.snapshot().client.ready === true,
    undefined,
    {
      timeout: 90_000,
    },
  )
}

/**
 * Đếm pixel màu overlay tay trái và phải trên canvas output: màu đặc (tay tươi) hoặc màu pha 45% với trắng (tay cũ
 * hơn 150 ms: trong headless mỗi frame mất khoảng 100 ms nên overlay lúc tươi lúc mờ), dung sai ±2 mỗi kênh.
 */
function overlayPixels(page: Page): Promise<{ left: number; right: number }> {
  return page.evaluate(
    ([l, r]) => {
      const c = document.querySelector<HTMLCanvasElement>('canvas#stage')!
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
      const faded = (col: readonly number[]) => col.map((v) => Math.round(v * 0.45 + 255 * 0.55))
      const near = (i: number, col: readonly number[]) =>
        Math.abs(d[i] - col[0]) <= 2 &&
        Math.abs(d[i + 1] - col[1]) <= 2 &&
        Math.abs(d[i + 2] - col[2]) <= 2
      const lf = faded(l)
      const rf = faded(r)
      let left = 0
      let right = 0
      for (let i = 0; i < d.length; i += 4) {
        if (near(i, l) || near(i, lf)) left++
        else if (near(i, r) || near(i, rf)) right++
      }
      return { left, right }
    },
    [HAND_LEFT, HAND_RIGHT] as const,
  )
}

test('worker tay chỉ khởi tạo khi chọn nguồn "Tay"; nền không có tay thì HandFrame rỗng; rời nguồn tay thì dừng và xóa', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await openSynthetic(page)
  // 8 fps: worker tay xử lý mọi frame mới (~100 ms mỗi frame trong headless) nên giảm nhịp nguồn để cả bộ e2e không
  // quá tải khi chạy song song.
  await page.evaluate(() => window.__scenario!.scene({ fps: 8 }))
  await expect(page.getByTestId('hands-stat')).toHaveText(/tay: tắt/)
  const h0 = await readHands(page)
  expect(h0.client.started).toBe(false)
  expect(h0.latest).toBeNull()
  await page.waitForTimeout(1000)
  expect((await readHands(page)).client.started).toBe(false)

  await selectHands(page)
  await expect(page.getByTestId('hands-stat')).toHaveText(/sẵn sàng \((GPU|CPU)/)
  await expect
    .poll(async () => (await readHands(page)).stats.results, { timeout: 60_000 })
    .toBeGreaterThan(2)
  const h1 = await readHands(page)
  expect(h1.client.failed).toBe(false)
  expect(h1.latest).not.toBeNull()
  expect(h1.latest!.hands).toEqual([])
  expect(h1.latest!.uncertain).toBe(false)
  expect(h1.tracker.created).toBe(0)
  const lp = await readLoop(page)
  expect(lp.handsActive).toBe(true)
  expect(lp.reveal).toEqual({ kind: 'closed', reason: 'few-points' })
  expect(lp.output.status).toBe('covered')
  await expectCanvasWhite(page)
  // Worker mặt không nhận gì khi vùng đóng (I1): tay không mở được cửa sổ ở HAND-01.
  expect(await page.evaluate(() => window.__wct!.probes!.counters.faceDetectSubmitted)).toBe(0)
  await expect(page.getByTestId('hands-stat')).toHaveText(/không thấy tay/)

  await page.getByLabel('Nguồn cửa sổ').selectOption('mouse')
  await expect(page.getByTestId('hands-stat')).toHaveText(/tay: tắt/)
  await expect.poll(async () => (await readLoop(page)).handsActive).toBe(false)
  const fed0 = (await readHands(page)).stats.fed
  await page.waitForTimeout(700)
  const h2 = await readHands(page)
  expect(h2.stats.fed).toBe(fed0)
  expect(h2.latest).toBeNull()
  expect((await readLoop(page)).hands).toBeNull()
})

test.describe('hai bàn tay thật (cục bộ)', () => {
  test.skip(!existsSync(HANDS_FILE), `cần ${HANDS_FILE} (asset spike, không commit)`)

  /** Cảnh tĩnh với hai bàn tay ở 8 fps; chờ worker sẵn sàng, thấy hai tay và pipeline qua các suy luận đầu. */
  async function openHandsScene(page: Page) {
    const st = await openSynthetic(page)
    await page.evaluate(
      ([src, img]) => window.__scenario!.scene({ fps: 8, person: null, face: { src, ...img } }),
      [HANDS_SRC, IMG] as const,
    )
    await selectHands(page)
    await page.waitForFunction(
      () => (window.__wct?.hands?.snapshot().latest?.hands.length ?? 0) === 2,
      undefined,
      { timeout: 90_000 },
    )
    // Vài suy luận đầu trong headless mất tới một giây; chờ đủ kết quả (CPU delegate khoảng 100 ms mỗi frame khi
    // rảnh, chậm hơn khi cả bộ chạy song song) rồi mới đo id.
    await page.waitForFunction(
      () => window.__wct!.hands!.snapshot().client.stats.results >= 20,
      undefined,
      { timeout: 90_000 },
    )
    return st
  }

  /**
   * Snapshot vòng lặp mà đầu ngón và HandFrame khớp nhau: đầu ngón tính ở frame render trước, kết quả tay có thể về
   * giữa hai lần đọc, nên chờ tới khi ts của từng điểm bằng lastSeenTs của track tương ứng.
   */
  async function consistentLoop(page: Page) {
    for (;;) {
      const l = await readLoop(page)
      const ok =
        l.hands !== null &&
        l.fingers.every((s) => {
          const tr = l.hands!.hands.find((h) => h.id === s.trackId)
          return tr !== undefined && tr.lastSeenTs === s.ts
        })
      if (ok) return l
      await page.waitForTimeout(50)
    }
  }

  /** Track theo vị trí: tay bên trái khung (x nhỏ) và tay bên phải khung. */
  async function byPosition(page: Page) {
    const h = await readHands(page)
    const hands = [...h.latest!.hands].sort((a, b) => a.palmCenterCam.x - b.palmCenterCam.x)
    return { snap: h, leftOfFrame: hands[0], rightOfFrame: hands[1] }
  }

  test('nhãn theo S3 (D-010), overlay hai màu, cửa sổ đóng; id giữ khi đứng yên và khi ảnh di chuyển; đảo trái/phải thì nhãn đảo và id mới', async ({
    page,
  }) => {
    test.setTimeout(300_000)
    await openHandsScene(page)
    const { snap, leftOfFrame, rightOfFrame } = await byPosition(page)
    // Nhãn: tay dưới bên trái khung là tay trái, tay trên bên phải khung là tay phải (S3, frame chưa mirror).
    expect(leftOfFrame.handedness).toBe('left')
    expect(rightOfFrame.handedness).toBe('right')
    expect(leftOfFrame.score).toBeGreaterThan(0.6)
    expect(rightOfFrame.score).toBeGreaterThan(0.6)
    expect(leftOfFrame.landmarksCam).toHaveLength(21)
    for (const h of [leftOfFrame, rightOfFrame]) {
      expect(h.bboxCam.x).toBeGreaterThanOrEqual(IMG.x - 5)
      expect(h.bboxCam.x + h.bboxCam.w).toBeLessThanOrEqual(IMG.x + IMG.w + 5)
    }
    expect(leftOfFrame.palmCenterCam.y).toBeGreaterThan(rightOfFrame.palmCenterCam.y)
    expect(snap.latest!.uncertain).toBe(false)
    await expect(page.getByTestId('hands-stat')).toHaveText(
      /Trái #\d+ \(\d\.\d\d\), Phải #\d+|Phải #\d+ \(\d\.\d\d\), Trái #\d+/,
    )
    const px = await overlayPixels(page)
    expect(px.left).toBeGreaterThan(20)
    expect(px.right).toBeGreaterThan(20)
    // ROI-03: đủ điểm của hai tay thì cửa sổ mở; trong headless điểm xen kẽ quá tuổi nên có lúc đóng stale-point.
    const lp = await readLoop(page)
    if (lp.reveal.kind === 'closed') expect(lp.reveal.reason).toBe('stale-point')
    else expect(lp.fingers.filter((s) => s.valid).length).toBeGreaterThanOrEqual(3)
    expect(lp.hands!.hands).toHaveLength(2)

    // Đứng yên: thêm 6 kết quả không tạo thêm hay xóa track, id giữ.
    const ids = [leftOfFrame.id, rightOfFrame.id]
    const created0 = snap.tracker.created
    const dropped0 = snap.tracker.dropped
    await expect
      .poll(async () => (await readHands(page)).client.stats.results, { timeout: 60_000 })
      .toBeGreaterThan(snap.client.stats.results + 6)
    const still = await byPosition(page)
    expect([still.leftOfFrame.id, still.rightOfFrame.id]).toEqual(ids)
    expect(still.snap.tracker.created).toBe(created0)
    expect(still.snap.tracker.dropped).toBe(dropped0)

    // Chuyển động: đặt lại ảnh cùng vị trí kèm vx, ảnh đi tiếp từ chỗ hiện tại (không nhảy); id giữ qua ≥ 4 kết quả.
    await page.evaluate(
      ([src, img]) => window.__scenario!.scene({ face: { src, ...img, vx: 25 } }),
      [HANDS_SRC, IMG] as const,
    )
    const x0 = still.leftOfFrame.palmCenterCam.x
    const r0 = still.snap.client.stats.results
    for (let k = 0; k < 60; k++) {
      await page.waitForTimeout(500)
      const cur = await byPosition(page)
      expect([cur.leftOfFrame.id, cur.rightOfFrame.id]).toEqual(ids)
      expect([cur.leftOfFrame.handedness, cur.rightOfFrame.handedness]).toEqual(['left', 'right'])
      if (cur.snap.client.stats.results - r0 >= 4 && cur.leftOfFrame.palmCenterCam.x - x0 > 50)
        break
    }
    const moved = await byPosition(page)
    expect(moved.snap.client.stats.results - r0).toBeGreaterThanOrEqual(4)
    expect(moved.leftOfFrame.palmCenterCam.x - x0).toBeGreaterThan(50)
    expect(moved.snap.tracker.created).toBe(created0)
    expect(moved.snap.tracker.uncertainFrames).toBe(0)

    // Đảo trái/phải (D-010): nhãn đảo, tracker reset nên id mới; bỏ đảo thì về như cũ.
    await page.getByLabel('Đảo trái/phải').check()
    await expect
      .poll(async () => (await byPosition(page)).leftOfFrame?.handedness, { timeout: 60_000 })
      .toBe('right')
    const swapped = await byPosition(page)
    expect(swapped.rightOfFrame.handedness).toBe('left')
    expect(Math.min(swapped.leftOfFrame.id, swapped.rightOfFrame.id)).toBeGreaterThan(
      Math.max(...ids),
    )
    expect(swapped.snap.swap).toBe(true)
    await expect(page.getByTestId('hands-stat')).toHaveText(/đảo trái\/phải/)
    await page.getByLabel('Đảo trái/phải').uncheck()
    await expect
      .poll(async () => (await byPosition(page)).leftOfFrame?.handedness, { timeout: 60_000 })
      .toBe('left')
    // Về chế độ chuột để pipeline dừng (giải phóng CPU cho các test khác).
    await page.getByLabel('Nguồn cửa sổ').selectOption('mouse')
    await expect.poll(async () => (await readLoop(page)).handsActive).toBe(false)
    await expectGateClean(page, 0)
  })

  test('mười đầu ngón (ROI-03): đủ điểm khi hai tay trong khung, đúng tay và đúng ngón; cửa sổ bao lồi theo tay thật; bỏ ngón út thì epoch tăng và còn 8 điểm; tay phải rời khung thì đóng few-points, điểm tay trái giữ', async ({
    page,
  }) => {
    test.setTimeout(300_000)
    await openSynthetic(page)
    // Ảnh đặt lệch phải để tay phải (khoảng 2/3 ảnh) gần mép phải khung: chạy sang phải là rời khung sớm.
    const img = { ...IMG, x: 700 }
    await page.evaluate(
      ([src, img]) => window.__scenario!.scene({ fps: 8, person: null, face: { src, ...img } }),
      [HANDS_SRC, img] as const,
    )
    await selectHands(page)
    await page.waitForFunction(
      () => (window.__wct?.hands?.snapshot().latest?.hands.length ?? 0) === 2,
      undefined,
      { timeout: 90_000 },
    )
    await page.waitForFunction(
      () => window.__wct!.hands!.snapshot().client.stats.results >= 20,
      undefined,
      { timeout: 90_000 },
    )
    const L = await consistentLoop(page)
    expect(L.fingers).toHaveLength(10)
    expect(L.output.points).toHaveLength(10)
    // Mười điểm đều có tọa độ; trong headless suy luận ~100 ms nên điểm có thể vừa quá tuổi (stale-point) nhưng không
    // bao giờ thiếu hay chuyển tay.
    for (const p of L.output.points) {
      expect(p.pStage).toBeDefined()
      expect([undefined, 'stale-point']).toContain(p.reason)
    }
    const left = L.hands!.hands.find((h) => h.handedness === 'left')!
    const right = L.hands!.hands.find((h) => h.handedness === 'right')!
    const lf = L.fingers.filter((s) => s.hand === 'left')
    const rf = L.fingers.filter((s) => s.hand === 'right')
    expect(lf.map((s) => s.tip)).toEqual([4, 8, 12, 16, 20])
    expect(rf.map((s) => s.tip)).toEqual([4, 8, 12, 16, 20])
    expect(lf.every((s) => s.trackId === left.id)).toBe(true)
    expect(rf.every((s) => s.trackId === right.id)).toBe(true)
    expect(lf[0].pCam).toEqual(left.landmarksCam[4])
    expect(rf[4].pCam).toEqual(right.landmarksCam[20])
    expect(lf[0].pStage.x).toBeGreaterThan(rf[0].pStage.x) // mirror: tay trái khung hiện bên phải bảng
    await expect(page.getByTestId('fingers-stat')).toHaveText(/trái \d\/5.*phải \d\/5/)

    // ROI-01 với tay thật: nâng tuổi điểm lên 1000 ms (headless suy luận chậm) thì cửa sổ mở ổn định; cạnh bằng
    // min(bboxW, bboxH) của bốn đầu ngón theo ô (±1 do lọc và làm tròn), tâm cửa sổ gần trung bình bốn điểm.
    await page.getByLabel('Tuổi điểm').fill('1000')
    await expect
      .poll(async () => (await readStage(page)).settings.sensitivity.pointMaxAgeMs)
      .toBe(1000)
    await expect
      .poll(async () => (await readLoop(page)).reveal.kind, { timeout: 30_000 })
      .toBe('open')
    // Snapshot nhất quán và đang mở (một frame hiếm hoi mất tay làm đóng tạm thì đọc lại).
    let O = await consistentLoop(page)
    for (let k = 0; k < 20 && O.reveal.kind !== 'open'; k++) {
      await page.waitForTimeout(200)
      O = await consistentLoop(page)
    }
    expect(O.reveal.kind, JSON.stringify(O.reveal)).toBe('open')
    const pts = O.fingers.filter((s) => s.valid).map((s) => s.pStage)
    const xs = pts.map((p) => p.x)
    const ys = pts.map((p) => p.y)
    // ROI-03: mask là tập ô giao với bao lồi các đầu ngón hợp lệ: hộp bao theo ô xấp xỉ hộp bao các điểm (mỗi cạnh
    // lệch tối đa một ô vì ô bị cạnh cắt qua cũng mở), mọi điểm nằm trong hộp nới một ô.
    const bboxW = Math.max(...xs) - Math.min(...xs)
    const bboxH = Math.max(...ys) - Math.min(...ys)
    // Layout đọc lúc này: hai thanh đầu ngón và độ nhạy đã hiện nên canvas nhỏ hơn lúc mở trang.
    const c = (await readStage(page)).layout.c
    expect(O.mask!.shape.kind).toBe('polygon')
    expect(Math.abs(O.mask!.box.w - bboxW / c)).toBeLessThanOrEqual(2)
    expect(Math.abs(O.mask!.box.h - bboxH / c)).toBeLessThanOrEqual(2)
    const r = O.mask!.stageRect
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(r.x - c)
      expect(p.x).toBeLessThanOrEqual(r.x + r.w + c)
      expect(p.y).toBeGreaterThanOrEqual(r.y - c)
      expect(p.y).toBeLessThanOrEqual(r.y + r.h + c)
    }
    expect(O.mask!.cellCount).toBeGreaterThan(0)
    await expect(page.getByTestId('solver-stat')).toHaveText(/mở đa giác/)
    // Đứng yên qua 8 kết quả nữa: hộp bao giữ nguyên và số ô mở chỉ lệch tối đa 3 (hysteresis ô chặn nhấp nháy);
    // dưới tải của cả bộ e2e kết quả có thể thưa hơn tuổi điểm nên một lần đọc thấy đóng tạm được bỏ qua.
    const r0 = (await readHands(page)).client.stats.results
    const boxes = new Set<string>()
    const counts: number[] = []
    while ((await readHands(page)).client.stats.results <= r0 + 8) {
      const l = await readLoop(page)
      if (l.mask) {
        boxes.add(JSON.stringify(l.mask.box))
        counts.push(l.mask.cellCount)
      }
      await page.waitForTimeout(100)
    }
    expect(counts.length).toBeGreaterThanOrEqual(2)
    expect(boxes.size).toBeLessThanOrEqual(2)
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(3)
    // UC-03: bỏ ngón út: epoch tăng (store) và cửa sổ đóng config-changed rồi mở lại (closed → open) với 8 điểm;
    // bật lại thì 10 điểm.
    await expect(page.getByLabel('Ngón út')).toBeChecked()
    const e0 = (await readStage(page)).epoch
    await page.getByLabel('Ngón út').uncheck()
    await expect.poll(async () => (await readStage(page)).settings.fingers).toEqual([4, 8, 12, 16])
    expect((await readStage(page)).epoch).toBeGreaterThanOrEqual(e0 + 1)
    await expect.poll(async () => (await readLoop(page)).fingers.length).toBe(8)
    const L2 = await consistentLoop(page)
    expect(L2.fingers.every((s) => s.tip !== 20)).toBe(true)
    await page.getByLabel('Ngón út').check()
    await expect.poll(async () => (await readLoop(page)).fingers.length).toBe(10)

    // Tay phải rời khung (ảnh chạy sang phải): điểm tay phải ra ngoài bảng rồi track bị xóa; chỉ còn điểm tay trái
    // (một tay) nên đóng few-points và hướng dẫn nêu tay còn thiếu.
    await page.evaluate(
      ([src, img]) => window.__scenario!.scene({ face: { src, ...img, vx: 60 } }),
      [HANDS_SRC, img] as const,
    )
    await expect
      .poll(
        async () => {
          const l = await readLoop(page)
          return (
            l.reveal.kind === 'closed' &&
            l.reveal.reason === 'few-points' &&
            l.output.points.length > 0 &&
            l.output.points.every((p) => p.hand === 'left')
          )
        },
        { timeout: 60_000 },
      )
      .toBe(true)
    const after = await readLoop(page)
    expect(after.output.points.length).toBeGreaterThan(0)
    expect(after.output.points.every((p) => p.pStage !== undefined)).toBe(true)
    expect(after.fingers[0].trackId).toBe(left.id)
    expect(after.reveal).toEqual({ kind: 'closed', reason: 'few-points' })
    await expect(page.getByTestId('stage-status')).toHaveText(/chưa thấy tay phải/)
    await page.getByLabel('Nguồn cửa sổ').selectOption('mouse')
    await expect.poll(async () => (await readLoop(page)).output.points.length).toBe(0)
    await expectGateClean(page, 0)
  })
})

// ROI-04 (mục 7.32): tư thế thật một tay từ ảnh spike: pointing_up.jpg (chỉ ngón trỏ giơ, ngón cái gập vào lòng bàn tay)
// và thumbs_up.jpg (chỉ ngón cái giơ). Chạy cục bộ khi có asset (npm run spikes:fetch).
const POINT_FILE = 'public/spike-assets/pointing_up.jpg'
const THUMB_FILE = 'public/spike-assets/thumbs_up.jpg'

test.describe('ngón đang giơ trên tay thật (ROI-04, cục bộ)', () => {
  test('pointing_up.jpg: pose chỉ ngón trỏ giơ, bốn ngón folded, few-points nêu số ngón gập; thumbs_up.jpg: chỉ ngón cái giơ', async ({
    page,
  }) => {
    test.skip(
      !existsSync(POINT_FILE) || !existsSync(THUMB_FILE),
      `cần ${POINT_FILE} và ${THUMB_FILE}`,
    )
    test.setTimeout(300_000)
    await openSynthetic(page)
    await selectHands(page)
    // Tuổi điểm 1000 ms để trong headless (suy luận ~100 ms) điểm không thành stale-point trước khi xét gập.
    await page.getByLabel('Tuổi điểm').fill('1000')
    const raisedOf = () =>
      page.evaluate(() => {
        const h = window.__wct!.hands!.snapshot().latest?.hands[0]
        if (!h?.pose) return null
        return [4, 8, 12, 16, 20].filter((t) => h.pose![t]!.raised)
      })
    for (const [src, w, h, expected, stat] of [
      ['/spike-assets/pointing_up.jpg', 358, 376, [8], /phải 1\/5 \(4 folded\)/],
      ['/spike-assets/thumbs_up.jpg', 382, 406, [4], /phải 1\/5 \(4 folded\)/],
    ] as const) {
      // Ảnh vẽ tỉ lệ 1,5 vào giữa khung 1280 × 720.
      const img = {
        x: Math.round(640 - 0.75 * w),
        y: Math.round(360 - 0.75 * h),
        w: Math.round(1.5 * w),
        h: Math.round(1.5 * h),
      }
      await page.evaluate(
        ([s, i]) => window.__scenario!.scene({ fps: 8, person: null, face: { src: s, ...i } }),
        [src, img] as const,
      )
      await page.waitForFunction(
        () => (window.__wct?.hands?.snapshot().latest?.hands.length ?? 0) === 1,
        undefined,
        { timeout: 90_000 },
      )
      const r0 = await page.evaluate(() => window.__wct!.hands!.snapshot().client.stats.results)
      await page.waitForFunction(
        (n) => window.__wct!.hands!.snapshot().client.stats.results >= n + 8,
        r0,
        { timeout: 90_000 },
      )
      const hand = await page.evaluate(() => window.__wct!.hands!.snapshot().latest!.hands[0])
      expect(hand.handedness).toBe('right')
      expect(hand.landmarksWorld).toHaveLength(21)
      await expect.poll(raisedOf, { timeout: 15_000 }).toEqual(expected)
      await expect
        .poll(async () => (await readLoop(page)).reveal)
        .toEqual({
          kind: 'closed',
          reason: 'few-points',
        })
      await expect(page.getByTestId('fingers-stat')).toHaveText(stat)
      await expect(page.getByTestId('guide-detail')).toHaveText(/4 đầu ngón đang gập/)
      note(`${src}: ngón giơ ${JSON.stringify(expected)}, pose ${JSON.stringify(hand.pose)}`)
    }
  })
})
