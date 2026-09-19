import { readFileSync } from 'node:fs'
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
  watchApiLikeRequests,
  type RecorderSnap,
  type SampleMetaSnap,
} from './helpers'

// CLS-01 (mục 7.22, I8, I9, mục 5.12): dataset mode trên nguồn tổng hợp. Không có đồng ý người tham gia thì không thu;
// bật thì có chỉ báo; mẫu là crop đúng cameraRect (pixel khớp cảnh tổng hợp, ranh giới xanh lá/magenta đúng vị trí),
// không bao giờ bằng khung camera; nhịp 2 Hz; đóng vùng hay dừng thì không thu thêm; zip tải về có đúng cấu trúc;
// không có yêu cầu mạng nào.
const GREEN = [0, 255, 0, 255]
const MAGENTA = [255, 0, 255, 255]

async function openSynthetic(page: Page) {
  await installGumCounter(page)
  await seedConsent(page)
  await openApp(page, '?debug=1&source=synthetic')
  await expect(page.locator('canvas#stage')).toBeVisible()
  const st = await readStage(page)
  await installGateAudit(page)
  return st
}

const readRec = (page: Page): Promise<RecorderSnap> =>
  page.evaluate(() => window.__wct!.dataset!.snapshot())
const readMetas = (page: Page): Promise<SampleMetaSnap[]> =>
  page.evaluate(() => window.__wct!.dataset!.metas())

/** Thư mục trung tâm của zip stored (đủ để đếm mục và đọc dữ liệu). */
function listZip(bytes: Buffer): { name: string; size: number; offset: number }[] {
  let eocd = -1
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('không có EOCD')
  const count = bytes.readUInt16LE(eocd + 10)
  let p = bytes.readUInt32LE(eocd + 16)
  const out: { name: string; size: number; offset: number }[] = []
  for (let i = 0; i < count; i++) {
    const nameLen = bytes.readUInt16LE(p + 28)
    const extraLen = bytes.readUInt16LE(p + 30)
    const commentLen = bytes.readUInt16LE(p + 32)
    out.push({
      name: bytes.subarray(p + 46, p + 46 + nameLen).toString('utf8'),
      size: bytes.readUInt32LE(p + 24),
      offset: bytes.readUInt32LE(p + 42),
    })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

function zipData(bytes: Buffer, e: { size: number; offset: number }): Buffer {
  const nameLen = bytes.readUInt16LE(e.offset + 26)
  const extraLen = bytes.readUInt16LE(e.offset + 28)
  const start = e.offset + 30 + nameLen + extraLen
  return bytes.subarray(start, start + e.size)
}

test('dataset mode: cần đồng ý người tham gia; chỉ báo khi thu; mẫu là crop đúng cameraRect với pixel khớp cảnh; 2 Hz; đóng vùng hay dừng thì không thu; zip đúng cấu trúc; không gọi mạng', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const requests = watchApiLikeRequests(page)
  await openSynthetic(page)
  const bar = page.getByTestId('dataset-bar')
  await expect(page.getByTestId('dataset-indicator')).toHaveCount(0)
  await expect(bar.getByLabel('Nhãn tạm')).toHaveCount(0)
  await page.getByLabel('Thu dữ liệu').check()
  const start = page.getByRole('button', { name: 'Bắt đầu thu' })
  await expect(start).toBeDisabled()
  await expect(page.getByTestId('dataset-stat')).toHaveText(/^chưa thu · 2 Hz · bộ nhớ/)
  await page.getByLabel('Nhãn tạm').selectOption('mannequin')
  await page.getByLabel('Loại hình nộm').selectOption('plastic')
  await page.getByLabel('Ánh sáng').selectOption('dim')
  await page.getByLabel('Mã người tham gia').fill('S-test')

  // Mở cửa sổ trước khi có đồng ý: không thu gì dù vùng mở.
  await page.evaluate(() => window.__scenario!.run('windowAt(28,10,8)'))
  await expect.poll(async () => (await readLoop(page)).reveal.kind).toBe('open')
  await page.waitForTimeout(1200)
  expect((await readRec(page)).count).toBe(0)
  expect(await readMetas(page)).toEqual([])

  await page.getByLabel('Người tham gia đã ký đồng ý').check()
  await expect(start).toBeEnabled()
  await start.click()
  await expect(page.getByTestId('dataset-indicator')).toBeVisible()
  await expect(page.getByTestId('dataset-indicator')).toHaveText(/Đang thu dữ liệu/)
  await expect(page.getByLabel('Mã người tham gia')).toBeDisabled()
  await expect
    .poll(async () => (await readRec(page)).count, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(4)
  await expect(page.getByTestId('dataset-indicator')).toHaveText(/\d+ mẫu/)
  await expect(page.getByTestId('dataset-stat')).toHaveText(/^đang thu \d+ mẫu · 2 Hz · bộ nhớ/)

  // Nhịp: khoảng cách ts giữa hai mẫu liên tiếp ≥ 500 ms (nhịp 2 Hz theo ts frame).
  const metas = await readMetas(page)
  const gaps = metas.slice(1).map((m, i) => m.ts - metas[i].ts)
  for (const g of gaps) expect(g).toBeGreaterThanOrEqual(499)
  const roi = (await readLoop(page)).mask!.cameraRect
  const camera = (await readStage(page)).camSize!

  // Mẫu gần nhất: PNG giải mã trong trang, kích thước đúng cameraRect, pixel khớp cảnh (xanh lá x < 640, magenta x ≥ 640).
  const px = await page.evaluate(async () => {
    const all = window.__wct!.dataset!.samples()
    const s = all[all.length - 1]
    const bmp = await createImageBitmap(s.png)
    const c = new OffscreenCanvas(bmp.width, bmp.height)
    const ctx = c.getContext('2d')!
    ctx.drawImage(bmp, 0, 0)
    const at = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data)
    const w = bmp.width
    const h = bmp.height
    const b = 640 - s.meta.cameraRect.x
    return {
      w,
      h,
      type: s.png.type,
      meta: s.meta,
      left: at(1, h >> 1),
      right: at(w - 2, h >> 1),
      beforeB: at(b - 1, h >> 1),
      atB: at(b, h >> 1),
      topLeft: at(0, 0),
      bottomRight: at(w - 1, h - 1),
    }
  })
  expect(px.type).toBe('image/png')
  expect([px.w, px.h]).toEqual([roi.w, roi.h])
  expect(px.meta.cameraRect).toEqual(roi)
  expect(px.meta.crop).toEqual({ w: roi.w, h: roi.h })
  expect(px.left).toEqual(GREEN)
  expect(px.right).toEqual(MAGENTA)
  expect(px.beforeB).toEqual(GREEN)
  expect(px.atB).toEqual(MAGENTA)
  expect(px.topLeft).toEqual(GREEN)
  expect(px.bottomRight).toEqual(MAGENTA)
  expect(px.meta).toMatchObject({
    label: 'mannequin',
    mannequinType: 'plastic',
    lighting: 'dim',
    subjectId: 'S-test',
    n: 8,
    cellsBox: { w: 8, h: 8 },
    cellCount: 64,
    holes: 0,
    position: 'center',
    edges: [],
    grid: { w: 64, h: 36 },
    mirror: true,
  })
  expect(px.meta.sizeClass).toBe(roi.w < 160 ? 'small' : roi.w < 320 ? 'medium' : 'large')
  // Không mẫu nào bằng khung camera (không có frame gốc).
  for (const m of metas) {
    expect(m.crop.w).toBeLessThan(camera.w)
    expect(m.crop.h).toBeLessThan(camera.h)
  }

  // Đóng vùng: không thu thêm; mở lại: thu tiếp cùng phiên.
  await page.evaluate(() => window.__scenario!.run('coverAll'))
  await expect.poll(async () => (await readLoop(page)).reveal.kind).toBe('closed')
  await page.waitForTimeout(200)
  const c1 = (await readRec(page)).count
  await page.waitForTimeout(1200)
  expect((await readRec(page)).count).toBe(c1)
  await page.evaluate(() => window.__scenario!.run('windowAt(28,10,8)'))
  await expect
    .poll(async () => (await readRec(page)).count, { timeout: 10_000 })
    .toBeGreaterThan(c1)

  // Dừng: chỉ báo tắt, phiên có stoppedAt, không thu thêm.
  await page.getByRole('button', { name: 'Dừng thu' }).click()
  await expect(page.getByTestId('dataset-indicator')).toHaveCount(0)
  await expect.poll(async () => (await readRec(page)).pending).toBe(0)
  const stopped = await readRec(page)
  expect(stopped.recording).toBe(false)
  expect(stopped.session?.stoppedAt).not.toBeNull()
  expect(stopped.session?.samples).toBe(stopped.count)
  await page.waitForTimeout(1200)
  expect((await readRec(page)).count).toBe(stopped.count)
  await expect(page.getByTestId('dataset-stat')).toHaveText(
    new RegExp(`^đã dừng, ${stopped.count} mẫu · 2 Hz · bộ nhớ \\(${stopped.count} mẫu`),
  )

  // Zip tải về: <sessionId>/<id>.png, <id>.json và session.json; PNG có chữ ký, JSON đọc được.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /^Tải zip/ }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/^wct-dataset-.*\.zip$/)
  const bytes = readFileSync((await download.path())!)
  const entries = listZip(bytes)
  const ses = stopped.session!.sessionId
  const pngs = entries.filter((e) => e.name.endsWith('.png'))
  const jsons = entries.filter((e) => /-\d{4}\.json$/.test(e.name))
  expect(pngs).toHaveLength(stopped.count)
  expect(jsons).toHaveLength(stopped.count)
  expect(entries.map((e) => e.name)).toContain(`${ses}/session.json`)
  for (const e of entries) expect(e.name.startsWith(`${ses}/`)).toBe(true)
  const png0 = zipData(bytes, pngs[0])
  expect(Array.from(png0.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  expect(png0.readUInt32BE(16)).toBe(roi.w)
  expect(png0.readUInt32BE(20)).toBe(roi.h)
  const session = JSON.parse(
    zipData(
      bytes,
      entries.find((e) => e.name.endsWith('session.json'))!,
    ).toString('utf8'),
  )
  expect(session).toMatchObject({
    sessionId: ses,
    subjectId: 'S-test',
    label: 'mannequin',
    participantConsent: true,
    samples: stopped.count,
  })
  const meta0 = JSON.parse(zipData(bytes, jsons[0]).toString('utf8'))
  expect(meta0.sessionId).toBe(ses)

  // Tắt công tắc: các trường ẩn, không còn chỉ báo; xóa mẫu trong bộ nhớ.
  await page.getByLabel('Thu dữ liệu').uncheck()
  await expect(page.getByLabel('Nhãn tạm')).toHaveCount(0)
  expect(requests).toEqual([])
  note(
    `${stopped.count} mẫu ${roi.w}×${roi.h} px (cameraRect (${roi.x}, ${roi.y})), khoảng cách ts nhỏ nhất ${Math.min(...gaps).toFixed(0)} ms, zip ${bytes.length} byte với ${entries.length} mục, ranh giới xanh lá/magenta tại x = ${640 - roi.x}`,
  )
  await expectGateClean(page)
})

test('cửa sổ chạm mép camera ghi position edge (mirror: cột 0 của bảng là mép phải camera); nhịp thu chỉnh được', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const st = await openSynthetic(page)
  await page.getByLabel('Thu dữ liệu').check()
  await page.getByLabel('Người tham gia đã ký đồng ý').check()
  await page.getByLabel('Nhịp thu').fill('10')
  await expect(page.getByTestId('dataset-stat')).toHaveText(/10 Hz/)
  await page.getByRole('button', { name: 'Bắt đầu thu' }).click()
  // Cửa sổ ở góc trên trái bảng: mirror bật nên cameraRect chạm mép trên và mép phải camera.
  await page.evaluate(() => window.__scenario!.run('windowAt(0,0,8)'))
  await expect
    .poll(async () => (await readRec(page)).count, { timeout: 10_000 })
    .toBeGreaterThanOrEqual(4)
  const metas = await readMetas(page)
  const m = metas[0]
  const camera = st.camSize!
  expect(m.position).toBe('edge')
  expect(m.edges).toEqual(['top', st.settings.mirror ? 'right' : 'left'])
  expect(m.cameraRect.y).toBe(0)
  expect(st.settings.mirror ? m.cameraRect.x + m.cameraRect.w : m.cameraRect.x).toBe(
    st.settings.mirror ? camera.w : 0,
  )
  const gaps = metas.slice(1).map((x, i) => x.ts - metas[i].ts)
  for (const g of gaps) expect(g).toBeGreaterThanOrEqual(99)
  await page.getByRole('button', { name: 'Dừng thu' }).click()
  note(
    `cửa sổ (0, 0) trên lưới ${st.settings.cols} × ${st.settings.rows}, mirror ${st.settings.mirror}: cameraRect (${m.cameraRect.x}, ${m.cameraRect.y}) ${m.cameraRect.w}×${m.cameraRect.h}, edges ${m.edges.join(', ')}; ${metas.length} mẫu ở 10 Hz, khoảng cách ts nhỏ nhất ${Math.min(...gaps).toFixed(0)} ms`,
  )
  await expectGateClean(page)
})
