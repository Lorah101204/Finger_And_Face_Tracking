import { expect, test, type Page } from '@playwright/test'
import {
  expectGateClean,
  installGateAudit,
  installGumCounter,
  note,
  openApp,
  readLoop,
  readStage,
  seedConsent,
  type FaceSnap,
} from './helpers'

// FACE-01 (mục 7.11): worker mặt khởi tạo lúc app start và chỉ nhận RestrictedFrame; đóng liên tục thì không gửi
// tác vụ; mở cửa sổ vào vùng chỉ có nền thì có tác vụ và kết quả rỗng. Nguồn tổng hợp mặc định: nửa trái camera xanh
// lá, nửa phải magenta, không có mặt; mirror bật nên bên trái bảng nhìn vào nửa phải camera (magenta).
function readFace(page: Page): Promise<FaceSnap> {
  return page.evaluate(() => window.__wct!.face!.snapshot())
}

function counters(page: Page) {
  return page.evaluate(() => ({ ...window.__wct!.probes!.counters }))
}

/** Trạng thái client và bộ đếm probe trong cùng một lượt evaluate (vòng lặp vẫn gửi tác vụ giữa hai lượt). */
function readBoth(page: Page) {
  return page.evaluate(() => ({
    face: window.__wct!.face!.snapshot(),
    counters: { ...window.__wct!.probes!.counters },
  }))
}

test('worker mặt sẵn sàng; đóng 5 s không gửi tác vụ; mở vào vùng nền thì gửi và kết quả 0 mặt; đóng thì ngừng nhận', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await installGumCounter(page)
  await seedConsent(page)
  await openApp(page, '?debug=1&source=synthetic')
  await expect(page.locator('canvas#stage')).toBeVisible()
  await readStage(page)
  await installGateAudit(page)
  await expect(page.getByTestId('face-stat')).toHaveText(/đang nạp|sẵn sàng/)
  // Nạp wasm, model và biên dịch shader (GPU delegate qua SwiftShader) trong lúc cả bộ e2e chạy song song với các ca
  // tay (HAND-01, worker CPU liên tục) có thể mất hơn một phút.
  await page.waitForFunction(() => window.__wct?.face?.snapshot().ready === true, undefined, {
    timeout: 120_000,
  })
  const s0 = await readFace(page)
  expect(s0.failed).toBe(false)
  expect(['GPU', 'CPU']).toContain(s0.delegate)
  expect(s0.accepting).toBe(false)
  expect(s0.stats.initMs).toBeGreaterThan(0)
  await expect(page.getByTestId('face-stat')).toHaveText(/sẵn sàng \((GPU|CPU)/)

  // Khởi động, chưa mở vùng: không có tác vụ nào trong 5 s.
  expect((await counters(page)).faceDetectSubmitted).toBe(0)
  await page.waitForTimeout(5000)
  expect((await counters(page)).faceDetectSubmitted).toBe(0)
  expect((await readFace(page)).stats.submitted).toBe(0)

  // FACE-02: FrameOutput phát qua events mỗi frame; đóng thì status covered và thông điệp tương ứng.
  await page.evaluate(() => {
    window.__frameEvents = 0
    window.__wct!.loop!.events.addEventListener('frame', (e) => {
      window.__frameEvents = (window.__frameEvents ?? 0) + 1
      window.__lastStatus = (e as CustomEvent<{ status: string }>).detail.status
    })
  })
  await page.waitForFunction(() => (window.__frameEvents ?? 0) >= 5)
  expect(await page.evaluate(() => window.__lastStatus)).toBe('covered')
  expect((await readLoop(page)).output).toMatchObject({
    status: 'covered',
    reveal: null,
    faces: [],
  })
  await expect(page.getByTestId('stage-status')).toHaveText(/đang che/)

  // Mở cửa sổ ở bên trái bảng: buffer là nền magenta, không có mặt.
  await page.evaluate(() => window.__scenario!.run('windowAt(2,4,10)'))
  // Chờ gate đã nhận một kết quả: khi cả bộ chạy song song, vài kết quả đầu có thể bị loại vì quá tuổi (worker chậm
  // lúc khởi động), nên không chỉ chờ client có kết quả.
  await expect
    .poll(async () => (await readLoop(page)).faceGate.accepted, { timeout: 30_000 })
    .toBeGreaterThan(0)
  const { face: s1, counters: c1 } = await readBoth(page)
  expect(s1.accepting).toBe(true)
  expect(s1.stats.submitted).toBeGreaterThan(0)
  expect(s1.stats.lastFaces).toBe(0)
  expect(s1.stats.errors).toBe(0)
  expect(s1.stats.p50InferMs).toBeGreaterThan(0)
  expect(s1.minIntervalMs).toBeGreaterThanOrEqual(1000 / 12 - 1e-6)
  expect(c1.faceDetectSubmitted).toBe(s1.stats.submitted)
  expect(c1.classifierSubmitted).toBe(0)
  // Không có mặt: status searching, faces rỗng, gate đã nhận kết quả (0 mặt) mà không loại vì epoch hay tuổi.
  await expect.poll(async () => (await readLoop(page)).output.status).toBe('searching')
  const L1 = await readLoop(page)
  expect(L1.output.faces).toEqual([])
  expect(L1.output.reveal?.shape.window).toEqual({ col: 2, row: 4, n: 10 })
  expect(L1.faceGate.accepted).toBeGreaterThan(0)
  expect(L1.faceGate.rejected.epoch).toBe(0)
  await expect(page.getByTestId('stage-status')).toHaveText(/Đang tìm khuôn mặt/)
  expect(await page.evaluate(() => window.__lastStatus)).toBe('searching')

  // Thumbnail buffer vừa gửi (bằng chứng trực quan của I1): tâm là magenta của nền.
  const thumb = page.getByTestId('restricted-thumb')
  await expect(thumb).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() => {
        const c = document.querySelector<HTMLCanvasElement>(
          'canvas[data-testid="restricted-thumb"]',
        )!
        return Array.from(c.getContext('2d')!.getImageData(128, 128, 1, 1).data)
      }),
    )
    .toEqual([255, 0, 255, 255])

  // Đóng: accepting tắt, tác vụ đang chạy (nếu có) về rồi bị loại, không gửi thêm.
  await page.evaluate(() => window.__scenario!.run('coverAll'))
  await expect.poll(async () => (await readFace(page)).accepting).toBe(false)
  await expect.poll(async () => (await readFace(page)).busy).toBe(false)
  const submitted = (await readFace(page)).stats.submitted
  await page.waitForTimeout(1000)
  const { face: s2, counters: c2 } = await readBoth(page)
  expect(s2.stats.submitted).toBe(submitted)
  expect(s2.pendingTaskId).toBeNull()
  expect(c2.faceDetectSubmitted).toBe(submitted)
  note(
    `worker ${s0.delegate}, init ${Math.round(s0.stats.initMs)} ms; đóng 5 s: 0 tác vụ; mở vào nền: ${s2.stats.submitted} tác vụ,` +
      ` ${s2.stats.results} kết quả 0 mặt, p50 infer ${s2.stats.p50InferMs.toFixed(1)} ms; đóng: không gửi thêm`,
  )
  await expectGateClean(page)
})

// QA-01 (mục 7.1 "đổi grid, mirror": kết quả epoch cũ bị loại; mục 7.12): tác vụ đang chạy lúc đổi cấu hình thì kết
// quả về bị FaceClient bỏ trước gate (rejectAll khi epoch đổi, mục 5.10); gate không nhận thêm cho tới tác vụ epoch mới.
test('đổi lưới hoặc mirror khi tác vụ đang chạy: kết quả epoch cũ bị bỏ trước gate, gate không nhận thêm; tác vụ epoch mới mới được nhận', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await installGumCounter(page)
  await seedConsent(page)
  await openApp(page, '?debug=1&source=synthetic')
  await expect(page.locator('canvas#stage')).toBeVisible()
  await readStage(page)
  await installGateAudit(page)
  await page.waitForFunction(() => window.__wct?.face?.snapshot().ready === true, undefined, {
    timeout: 120_000,
  })
  await page.evaluate(() => window.__scenario!.run('windowAt(2,4,10)'))
  await expect
    .poll(async () => (await readLoop(page)).faceGate.accepted, { timeout: 30_000 })
    .toBeGreaterThan(0)
  for (const change of ['grid', 'mirror'] as const) {
    // Kết quả kế về muộn 3 s. Bắt đúng lúc một tác vụ vừa gửi bằng poll theo rAF ngay trong trang (không có độ trễ
    // round-trip) rồi đổi cấu hình ngay: tác vụ đó chắc chắn còn chạy khi epoch đổi. Trễ dài để khi test thấy tác vụ
    // cũ bị bỏ (đọc trễ tới hơn một giây dưới tải) thì tác vụ epoch mới vẫn chưa về.
    await page.evaluate(() => window.__scenario!.run('delayWorker(3000)'))
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
    const f0 = await readFace(page)
    expect(f0.busy).toBe(true)
    if (change === 'grid') await page.getByLabel('Lưới', { exact: true }).selectOption('0')
    else await page.getByLabel('Mirror').uncheck()
    await expect.poll(async () => (await readStage(page)).epoch).toBeGreaterThan(before.epoch)
    // Kết quả của tác vụ cũ về: client bỏ (discarded + 1); tới lúc đó gate chưa nhận thêm gì và không có kết quả nào
    // bị loại vì epoch hay rejected-task (kết quả epoch cũ không tới gate).
    const mid = await page.evaluate(async (d0) => {
      for (;;) {
        const f = window.__wct!.face!.snapshot()
        if (f.stats.discarded > d0) return { face: f, loop: window.__wct!.loop!.snapshot() }
        await new Promise((r) => setTimeout(r, 25))
      }
    }, f0.stats.discarded)
    expect(mid.face.stats.discarded).toBe(f0.stats.discarded + 1)
    expect(mid.loop.faceGate.accepted).toBe(before.faceGate.accepted)
    expect(mid.loop.faceGate.rejected.epoch).toBe(before.faceGate.rejected.epoch)
    expect(mid.loop.faceGate.rejected['rejected-task']).toBe(
      before.faceGate.rejected['rejected-task'],
    )
    // Cửa sổ chuột mở lại với epoch mới; tác vụ epoch mới (không trễ) được gate nhận.
    await page.evaluate(() => window.__scenario!.run('delayWorker(0)'))
    await expect
      .poll(async () => (await readLoop(page)).faceGate.accepted, { timeout: 30_000 })
      .toBeGreaterThan(before.faceGate.accepted)
    const after = await readLoop(page)
    expect(after.reveal.kind).toBe('open')
    expect(after.faceGate.lastAccepted!.epoch).toBeGreaterThan(before.epoch)
    expect(after.faceGate.lastAccepted!.epoch).toBe(after.epoch)
    expect(after.faceGate.rejected.epoch).toBe(before.faceGate.rejected.epoch)
    note(
      `${change}: epoch ${before.epoch} → ${after.epoch}; tác vụ cũ bị bỏ trước gate (discarded ${f0.stats.discarded} →` +
        ` ${mid.face.stats.discarded}), gate không nhận thêm tới lúc đó (${mid.loop.faceGate.accepted}); sau đó nhận` +
        ` ${after.faceGate.accepted}, chỉ epoch mới; loại vì epoch: ${after.faceGate.rejected.epoch}`,
    )
  }
  await expectGateClean(page)
})
