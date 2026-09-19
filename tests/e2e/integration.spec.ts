import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import {
  expectCanvasWhite,
  expectGateClean,
  handsAtCell,
  installGateAudit,
  installGumCounter,
  note,
  openApp,
  readFace,
  readLoop,
  readStage,
  seedConsent,
  setFakeHands,
  type LoopSnap,
} from './helpers'

// INT-01 (mục 7.16): đổi nguồn cửa sổ là đổi cấu hình (epoch++); tab ẩn và camera dừng đóng vùng (tab-hidden,
// no-camera) và mở lại khi hết; tay giả lập mở cửa sổ thì worker mặt nhận buffer, bỏ một tay thì vùng đóng, mặt xóa,
// accepting tắt. Phần mặt thật chạy cục bộ với public/spike-assets/face.png.
const FACE_FILE = 'public/spike-assets/face.png'
const FACE_SRC = '/spike-assets/face.png'
/** Như faceGate.spec: ảnh 958 × 1358 vẽ tỉ lệ 0,5 tại IMG; mặt khoảng FACE_CAM (px camera). */
const IMG = { x: 400, y: 20, w: 479, h: 679 }
const FACE_CAM = { x: 560, y: 70, w: 170, h: 210 }
const FACE_FULL = [24, 128, 56]
const FACE_PARTIAL = [249, 171, 0]

async function openSynthetic(page: Page) {
  await installGumCounter(page)
  await seedConsent(page)
  await openApp(page, '?debug=1&source=synthetic')
  await expect(page.locator('canvas#stage')).toBeVisible()
  const st = await readStage(page)
  await installGateAudit(page)
  return st
}

/** Chọn nguồn tay rồi đọc layout sau khi hai thanh đầu ngón và độ nhạy đã hiện (canvas nhỏ lại). */
async function selectHandsAndLayout(page: Page) {
  await page.getByLabel('Nguồn cửa sổ').selectOption('hands')
  await expect(page.getByLabel('N min')).toBeVisible()
  let st = await readStage(page)
  for (;;) {
    await page.waitForTimeout(150)
    const next = await readStage(page)
    if (next.stageSize.w === st.stageSize.w && next.stageSize.h === st.stageSize.h) return next
    st = next
  }
}

/**
 * Giả lập tab ẩn hoặc hiện: ghi đè document.visibilityState rồi phát visibilitychange, và đọc ngay trạng thái vùng
 * trong cùng lượt (trước mọi rAF) để kiểm đóng ngay theo sự kiện.
 */
function setHidden(page: Page, hidden: boolean): Promise<LoopSnap['reveal']> {
  return page.evaluate((h) => {
    if (h) {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      })
    } else {
      delete (document as unknown as { visibilityState?: string }).visibilityState
    }
    document.dispatchEvent(new Event('visibilitychange'))
    return window.__wct!.loop!.snapshot().reveal
  }, hidden)
}

/** Đếm pixel màu overlay mặt trên canvas output. */
function faceOverlayPixels(page: Page): Promise<number> {
  return page.evaluate(
    ([full, partial]) => {
      const c = document.querySelector<HTMLCanvasElement>('canvas#stage')!
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
      let n = 0
      for (let i = 0; i < d.length; i += 4) {
        const isFull = d[i] === full[0] && d[i + 1] === full[1] && d[i + 2] === full[2]
        const isPart = d[i] === partial[0] && d[i + 1] === partial[1] && d[i + 2] === partial[2]
        if (isFull || isPart) n++
      }
      return n
    },
    [FACE_FULL, FACE_PARTIAL] as const,
  )
}

test('đổi nguồn cửa sổ là đổi cấu hình (epoch++); tab ẩn đóng ngay với tab-hidden và epoch++, accepting tắt, canvas trắng; hiện lại thì mở lại (chuột và tay)', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const s0 = await openSynthetic(page)
  await page.keyboard.press('Space')
  await expect.poll(async () => (await readLoop(page)).reveal.kind).toBe('open')
  const e0 = (await readLoop(page)).epoch

  // Chuột → tay: store epoch++ (đóng config-changed cùng frame, rồi nguồn tay đóng few-points vì chưa có tay).
  // Hai thanh đầu ngón và độ nhạy hiện ra làm canvas nhỏ lại: thêm một lần epoch++ của layout nếu kích thước đổi.
  await page.getByLabel('Nguồn cửa sổ').selectOption('hands')
  await expect
    .poll(async () => (await readLoop(page)).reveal)
    .toEqual({ kind: 'closed', reason: 'few-points' })
  const s1 = await selectHandsAndLayout(page)
  const resize1 = s1.stageSize.h !== s0.stageSize.h ? 1 : 0
  const e1 = s1.epoch
  expect(e1).toBe(e0 + 1 + resize1)
  // Tay → chuột: store epoch++, cửa sổ chuột (vẫn mở về logic) mở lại: closed → open epoch++; canvas lớn lại thì
  // layout epoch++ và cửa sổ đóng config-changed rồi mở lại lần nữa (thêm 1 nếu resize tới sau lần mở đầu).
  await page.getByLabel('Nguồn cửa sổ').selectOption('mouse')
  await expect.poll(async () => (await readLoop(page)).reveal.kind).toBe('open')
  await expect.poll(async () => (await readStage(page)).stageSize.h).toBe(s0.stageSize.h)
  await page.waitForTimeout(300)
  const e2 = (await readLoop(page)).epoch
  expect((await readLoop(page)).reveal.kind).toBe('open')
  expect(e2).toBeGreaterThanOrEqual(e1 + 2 + resize1)
  expect(e2).toBeLessThanOrEqual(e1 + 2 + 2 * resize1)

  // Tab ẩn: đóng ngay trong sự kiện (không chờ rAF), epoch++, mặt không nhận buffer, canvas trắng, thông điệp.
  expect(await setHidden(page, true)).toEqual({ kind: 'closed', reason: 'tab-hidden' })
  const hidden = await readLoop(page)
  expect(hidden.epoch).toBe(e2 + 1)
  expect(hidden.output.status).toBe('covered')
  expect(hidden.output.reveal).toBeNull()
  expect((await readFace(page)).accepting).toBe(false)
  await expectCanvasWhite(page)
  await expect(page.getByTestId('stage-status')).toHaveText(/tab đang ẩn/)
  await expect(page.getByTestId('reveal-stat')).toHaveText(/đóng: tab-hidden/)
  // Hiện lại: cửa sổ chuột mở lại ở frame kế với epoch mới.
  await setHidden(page, false)
  await expect.poll(async () => (await readLoop(page)).reveal.kind).toBe('open')
  expect((await readLoop(page)).epoch).toBe(e2 + 2)
  expect((await readFace(page)).accepting).toBe(true)

  // Nguồn tay với tay giả lập (hai ngón cái, trỏ để bốn đầu ngón tạo hình chữ nhật như ROI-02): cũng đóng ngay khi tab
  // ẩn và mở lại cùng ô khi hiện.
  const st = await selectHandsAndLayout(page)
  await page.evaluate(() => window.__scenario!.run('fingers(4,8)'))
  // Tứ giác chữ nhật 12,3 × 8,2 ô quanh góc ô (32, 18): ô lấn quá 0,25 ô (hysteresis) → hộp cột 26..37, hàng 14..21,
  // đầy 96 ô (ROI-02).
  const BOX = { col: 26, row: 14, w: 12, h: 8 }
  await setFakeHands(page, handsAtCell(st.layout, 32, 18, 8.2))
  await expect.poll(async () => (await readLoop(page)).mask?.box, { timeout: 15_000 }).toEqual(BOX)
  expect((await readLoop(page)).mask?.cellCount).toBe(96)
  const eHands = (await readLoop(page)).epoch
  expect(await setHidden(page, true)).toEqual({ kind: 'closed', reason: 'tab-hidden' })
  expect((await readLoop(page)).output.points).toEqual([])
  await setHidden(page, false)
  await expect.poll(async () => (await readLoop(page)).mask?.box, { timeout: 15_000 }).toEqual(BOX)
  expect((await readLoop(page)).epoch).toBe(eHands + 2)
  note(
    `epoch: mở ${e0} → tay ${e1} → chuột ${e2} → tab ẩn ${e2 + 1} → hiện ${e2 + 2}; tay giả lập: ẩn/hiện ${eHands} → ${eHands + 2},` +
      ` cùng hộp (${BOX.col}, ${BOX.row}) ${BOX.w}×${BOX.h}`,
  )
  await setFakeHands(page, null)
  await expectGateClean(page)
})

test('camera thật (giả của Chromium) dừng hay ngừng cấp frame thì vùng đóng no-camera và canvas trắng; chạy lại thì mở lại', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await installGumCounter(page)
  await seedConsent(page)
  await openApp(page, '?debug=1')
  await expect(page.locator('canvas#stage')).toBeVisible()
  // Chưa bật camera: cửa sổ chuột không mở được (no-camera).
  await page.keyboard.press('Space')
  await expect
    .poll(async () => (await readLoop(page)).reveal)
    .toEqual({ kind: 'closed', reason: 'no-camera' })
  await expect(page.getByTestId('stage-status')).toHaveText(/camera chưa cấp frame/)
  await page.getByRole('button', { name: 'Bật camera' }).click()
  await expect(page.getByRole('status')).toHaveText(/Camera đang chạy/, { timeout: 15_000 })
  await expect
    .poll(async () => (await readLoop(page)).reveal.kind, { timeout: 15_000 })
    .toBe('open')

  // Dừng camera: đóng no-camera, canvas trắng; bật lại: mở lại.
  await page.getByRole('button', { name: 'Dừng camera' }).click()
  await expect
    .poll(async () => (await readLoop(page)).reveal)
    .toEqual({ kind: 'closed', reason: 'no-camera' })
  expect((await readFace(page)).accepting).toBe(false)
  await expectCanvasWhite(page)
  await page.getByRole('button', { name: 'Bật camera' }).click()
  await expect(page.getByRole('status')).toHaveText(/Camera đang chạy/, { timeout: 15_000 })
  await expect
    .poll(async () => (await readLoop(page)).reveal.kind, { timeout: 15_000 })
    .toBe('open')

  // Watchdog (D-011): video ngừng cấp frame quá 500 ms → no-camera; phát lại → mở lại.
  const VIDEO = 'video[data-wct-camera]'
  await page.waitForFunction(() => (window.__wct?.camera?.probe.frames ?? 0) >= 5)
  await page.evaluate((sel) => document.querySelector<HTMLVideoElement>(sel)!.pause(), VIDEO)
  await expect
    .poll(async () => (await readLoop(page)).reveal, { timeout: 5_000 })
    .toEqual({ kind: 'closed', reason: 'no-camera' })
  await page.evaluate((sel) => document.querySelector<HTMLVideoElement>(sel)!.play(), VIDEO)
  await expect
    .poll(async () => (await readLoop(page)).reveal.kind, { timeout: 15_000 })
    .toBe('open')
})

test('tay giả lập mở cửa sổ thì worker mặt nhận buffer; bỏ một tay thì vùng đóng cùng frame, mặt xóa, accepting tắt, không gửi thêm', async ({
  page,
}) => {
  test.setTimeout(240_000)
  await openSynthetic(page)
  const st = await selectHandsAndLayout(page)
  await setFakeHands(page, handsAtCell(st.layout, 32, 18, 10.2))
  await expect
    .poll(async () => (await readLoop(page)).reveal.kind, { timeout: 15_000 })
    .toBe('open')
  // Worker mặt sẵn sàng (nạp wasm, model, warm-up; chậm khi cả bộ chạy song song) rồi nhận buffer từ cửa sổ theo tay.
  await page.waitForFunction(() => window.__wct?.face?.snapshot().ready === true, undefined, {
    timeout: 120_000,
  })
  await expect
    .poll(() => page.evaluate(() => window.__wct!.probes!.counters.faceDetectSubmitted), {
      timeout: 60_000,
    })
    .toBeGreaterThan(0)
  await expect.poll(async () => (await readLoop(page)).output.status).toBe('searching')
  expect((await readFace(page)).accepting).toBe(true)

  // Bỏ tay phải: chỉ còn năm điểm của tay trái (minHands 2) → đóng few-points; mặt rỗng, accepting tắt, tác vụ cũ bị
  // loại, không gửi thêm.
  await setFakeHands(page, { left: handsAtCell(st.layout, 32, 18, 10.2).left })
  await expect
    .poll(async () => (await readLoop(page)).reveal, { timeout: 15_000 })
    .toEqual({ kind: 'closed', reason: 'few-points' })
  const closed = await readLoop(page)
  expect(closed.output.faces).toEqual([])
  expect(closed.output.points).toHaveLength(5)
  expect(closed.output.points.every((p) => p.valid && p.hand === 'left')).toBe(true)
  const face = await readFace(page)
  expect(face.accepting).toBe(false)
  const sent0 = await page.evaluate(() => window.__wct!.probes!.counters.faceDetectSubmitted)
  await page.waitForTimeout(700)
  expect(await page.evaluate(() => window.__wct!.probes!.counters.faceDetectSubmitted)).toBe(sent0)
  await expect(page.getByTestId('stage-status')).toHaveText(/chưa thấy tay phải/)
  note(`bỏ tay phải: đóng few-points, buffer gửi ${sent0} rồi đứng yên 700 ms, accepting tắt`)
  await setFakeHands(page, null)
  await expectGateClean(page)
})

test.describe('mặt thật trong cửa sổ theo tay (cục bộ)', () => {
  test.skip(!existsSync(FACE_FILE), `cần ${FACE_FILE} (asset spike, không commit)`)

  test('tay giả lập bao quanh mặt: face-candidate với overlay trong cửa sổ; bỏ một tay thì đóng và mặt biến mất ngay', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    await openSynthetic(page)
    await page.evaluate(
      ([src, img]) => window.__scenario!.scene({ person: null, face: { src, ...img } }),
      [FACE_SRC, IMG] as const,
    )
    await selectHandsAndLayout(page)
    await page.waitForFunction(() => window.__wct?.face?.snapshot().ready === true, undefined, {
      timeout: 120_000,
    })
    // Hình vuông 300 px camera quanh tâm mặt (645, 175): hai tay tại x = 420 và 870, đầu ngón ở y = 25 và 325.
    const center = { x: FACE_CAM.x + FACE_CAM.w / 2, y: FACE_CAM.y + FACE_CAM.h / 2 }
    const hands = {
      left: { x: center.x - 225, y: center.y, spread: 300 },
      right: { x: center.x + 225, y: center.y, spread: 300 },
    }
    await setFakeHands(page, hands)
    let L: LoopSnap
    await expect
      .poll(
        async () => {
          L = await readLoop(page)
          return L.output.status === 'face-candidate' && L.output.faces.length === 1
        },
        { timeout: 90_000 },
      )
      .toBe(true)
    const sr = L!.mask!.stageRect
    const b = L!.output.faces[0].bboxStage
    expect(b.x).toBeGreaterThanOrEqual(sr.x)
    expect(b.y).toBeGreaterThanOrEqual(sr.y)
    expect(b.x + b.w).toBeLessThanOrEqual(sr.x + sr.w)
    expect(b.y + b.h).toBeLessThanOrEqual(sr.y + sr.h)
    await expect.poll(() => faceOverlayPixels(page), { timeout: 30_000 }).toBeGreaterThan(50)
    await expect(page.getByTestId('stage-status')).toHaveText(/Thấy khuôn mặt/)

    // Bỏ tay trái: cùng snapshot vừa đóng đã không còn mặt; overlay mặt biến mất.
    await setFakeHands(page, { right: hands.right })
    await expect
      .poll(
        async () => {
          const l = await readLoop(page)
          return l.reveal.kind === 'closed' ? l.output.faces.length : -1
        },
        { timeout: 15_000 },
      )
      .toBe(0)
    expect((await readLoop(page)).reveal).toEqual({ kind: 'closed', reason: 'few-points' })
    await expect.poll(() => faceOverlayPixels(page)).toBe(0)
    expect((await readFace(page)).accepting).toBe(false)
    await setFakeHands(page, null)
    await expectGateClean(page)
  })
})
