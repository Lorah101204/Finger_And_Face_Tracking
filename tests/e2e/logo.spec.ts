import { expect, test, type Page } from '@playwright/test'
import {
  expectCanvasWhite,
  expectGateClean,
  GRID_GRAY,
  installGateAudit,
  installGumCounter,
  note,
  openApp,
  readLogo,
  readLoop,
  readStage,
  samplePixel,
  seedConsent,
  WHITE,
  type StageSnap,
} from './helpers'

// BRAND-01 (mục 7.33, D-056): logo chiến dịch khảm vào màn che. Cỡ theo bảng, không theo số ô (cùng rect ở ba preset,
// hộp bao ô lệch tối đa một ô); ô logo màu khối đúng #1f3566 (kịch bản logoWordmark(0)); lớp chữ có xanh lá trong khung
// VERIFY và trắng trong khung Human, ngoài rect vẫn trắng/xám vạch; ẩn khi vùng mở và hiện lại 800 ms sau khi đóng;
// công tắc, `?logo=0` và sessionStorage; frame tĩnh không vẽ lại khi logo đứng yên. Mọi ca khác của bộ e2e mở stage với
// `logo=0` (helpers.openApp) nên không đổi.
const NAVY = [31, 53, 102, 255]
const REAPPEAR_MS = 800

async function openSynthetic(page: Page, query = '?debug=1&source=synthetic&logo=1') {
  await installGumCounter(page)
  await seedConsent(page)
  await openApp(page, query)
  await expect(page.locator('canvas#stage')).toBeVisible()
  await installGateAudit(page)
  const st = await readStage(page)
  await expect.poll(() => readLoop(page).then((l) => l.frames)).toBeGreaterThan(2)
  return st
}

/** Tâm của ô (col, row) theo layout hiện tại. */
function cellCenter(L: StageSnap['layout'], col: number, row: number): [number, number] {
  return [L.board.x + col * L.c + Math.floor(L.c / 2), L.board.y + row * L.c + Math.floor(L.c / 2)]
}

/**
 * Ô chắc chắn thuộc khối: ô chứa điểm (12 % bề rộng, 57 % chiều cao) của rect, nằm trong khung "Human" (x 0–0,72,
 * y 0,37–0,76); với ô ≤ 40 px mọi cách căn đều phủ ≥ ½ ô.
 */
function humanCell(L: StageSnap['layout'], r: { x: number; y: number; w: number; h: number }) {
  return {
    col: Math.floor((r.x + r.w * 0.12 - L.board.x) / L.c),
    row: Math.floor((r.y + r.h * 0.57 - L.board.y) / L.c),
  }
}

async function waitFrames(page: Page, n: number) {
  const a = (await readLoop(page)).frames
  await expect
    .poll(() => readLoop(page).then((l) => l.frames - a), { timeout: 30_000 })
    .toBeGreaterThanOrEqual(n)
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
})

test('cỡ cố định theo bảng: cùng rect ở 32, 64 và 128 cột, hộp bao ô lệch tối đa một ô, ô khối đúng màu navy, góc và mép canvas vẫn trắng; frame tĩnh không vẽ lại', async ({
  page,
}) => {
  await openSynthetic(page)
  await page.evaluate(() => window.__scenario!.run('logoWordmark', 0))
  const rects: { x: number; y: number; w: number; h: number }[] = []
  const counts: number[] = []
  const cellSizes: number[] = []
  for (const preset of ['0', '1', '2']) {
    await page.getByLabel('Lưới', { exact: true }).selectOption(preset)
    const cols = [32, 64, 128][Number(preset)]
    await expect.poll(async () => (await readStage(page)).settings.cols).toBe(cols)
    await expect.poll(() => readLogo(page).then((l) => l.visible)).toBe(true)
    await waitFrames(page, 2)
    const st = await readStage(page)
    const L = st.layout
    const logo = await readLogo(page)
    expect(logo.enabled).toBe(true)
    expect(logo.rect).not.toBeNull()
    expect(logo.box).not.toBeNull()
    const r = logo.rect!
    const b = logo.box!
    rects.push({ ...r })
    counts.push(logo.cellCount)
    cellSizes.push(L.c)
    // Hộp bao ô nằm trong rect nới một ô mỗi phía.
    expect(L.board.x + b.col * L.c).toBeGreaterThanOrEqual(r.x - L.c)
    expect(L.board.y + b.row * L.c).toBeGreaterThanOrEqual(r.y - L.c)
    expect(L.board.x + (b.col + b.w) * L.c).toBeLessThanOrEqual(r.x + r.w + L.c)
    expect(L.board.y + (b.row + b.h) * L.c).toBeLessThanOrEqual(r.y + r.h + L.c)
    // Rect theo stage: 30 % bề rộng, lề 2,5 %, neo trên trái, kẹp vào bảng.
    expect(r.w).toBe(Math.round(L.stage.w * 0.3))
    expect(r.x).toBe(Math.max(L.board.x, Math.round(L.stage.w * 0.025)))
    expect(r.y).toBe(Math.max(L.board.y, Math.round(L.stage.w * 0.025)))
    const hc = humanCell(L, r)
    expect(await samplePixel(page, ...cellCenter(L, hc.col, hc.row))).toEqual(NAVY)
    // Ô ngay ngoài hộp bao (phải và dưới) trắng hoặc vạch; góc, tâm và giữa cạnh canvas không có logo.
    const outside = await samplePixel(page, ...cellCenter(L, b.col + b.w + 1, b.row + 1))
    expect([WHITE, GRID_GRAY]).toContainEqual(outside)
    await expectCanvasWhite(page)
  }
  // Cùng cỡ ở ba preset; vị trí chỉ lệch theo mép bảng (dưới một ô của preset thô nhất).
  expect(new Set(rects.map((r) => `${r.w}×${r.h}`)).size).toBe(1)
  const cMax = Math.max(...cellSizes)
  for (const r of rects) {
    expect(Math.abs(r.x - rects[0].x)).toBeLessThan(cMax)
    expect(Math.abs(r.y - rects[0].y)).toBeLessThan(cMax)
  }
  expect(counts[1] / counts[0]).toBeGreaterThan(3)
  expect(counts[2] / counts[1]).toBeGreaterThan(3.3)
  // Logo đứng yên và vùng đóng: paints đứng yên trong 20 frame.
  const a = await readLoop(page)
  await waitFrames(page, 20)
  const bb = await readLoop(page)
  expect(bb.paints - a.paints).toBe(0)
  note(
    `logo ${rects[0].w}×${rects[0].h} px ở cả ba preset (ô ${cellSizes.join('/')} px); ô logo 32/64/128 cột: ${counts.join('/')}; paints +0 sau ${bb.frames - a.frames} frame tĩnh`,
  )
})

test('lớp chữ: xanh lá trong khung VERIFY, trắng và navy trong khung Human, ngoài rect chỉ trắng/xám vạch; chữ nạp từ SVG bundle, không request nào ra ngoài', async ({
  page,
}) => {
  const external: string[] = []
  page.on('request', (req) => {
    const u = new URL(req.url())
    // blob: là URL trong trang (lớp chữ dựng từ chuỗi SVG trong bundle), không phải request ra ngoài.
    if (u.protocol !== 'blob:' && !['127.0.0.1', 'localhost'].includes(u.hostname))
      external.push(u.href)
  })
  await openSynthetic(page)
  await expect.poll(() => readLogo(page).then((l) => l.ready && l.visible)).toBe(true)
  await waitFrames(page, 3)
  const logo = await readLogo(page)
  expect(logo.wordmark).toBe(true)
  const r = logo.rect!
  const scan = await page.evaluate((rect) => {
    const ctx = document.querySelector<HTMLCanvasElement>('canvas#stage')!.getContext('2d')!
    const count = (x: number, y: number, w: number, h: number) => {
      const d = ctx.getImageData(x, y, w, h).data
      let green = 0
      let white = 0
      let navy = 0
      for (let i = 0; i < d.length; i += 4) {
        const [R, G, B] = [d[i], d[i + 1], d[i + 2]]
        if (G > R + 20 && G > B + 20) green++
        else if (R > 250 && G > 250 && B > 250) white++
        else if (R === 31 && G === 53 && B === 102) navy++
      }
      return { green, white, navy }
    }
    // Khung VERIFY: x 0,28–1, y 0–0,39; khung Human: x 0–0,72, y 0,37–0,76 (core/brandLogo.ts LOGO_FRAMES).
    const verify = count(
      Math.round(rect.x + rect.w * 0.3),
      Math.round(rect.y + rect.h * 0.05),
      Math.round(rect.w * 0.68),
      Math.round(rect.h * 0.3),
    )
    const human = count(
      Math.round(rect.x + rect.w * 0.02),
      Math.round(rect.y + rect.h * 0.4),
      Math.round(rect.w * 0.68),
      Math.round(rect.h * 0.32),
    )
    const right = count(rect.x + rect.w + 4, rect.y, 40, rect.h)
    return { verify, human, right }
  }, r)
  expect(scan.verify.green).toBeGreaterThan(50)
  expect(scan.human.white).toBeGreaterThan(50)
  expect(scan.human.navy).toBeGreaterThan(200)
  expect(scan.human.green).toBe(0)
  expect(scan.right.green + scan.right.navy).toBe(0)
  expect(external).toEqual([])
  note(
    `khung VERIFY: ${scan.verify.green} px xanh lá; khung Human: ${scan.human.white} px trắng, ${scan.human.navy} px navy; ngoài rect 0 px màu logo`,
  )
})

test('ẩn khi vùng mở: cửa sổ chuột xa logo thì ô logo trắng và visible false; đóng thì hiện lại sau 800 ms, chưa hiện ở 200 ms; gate audit sạch', async ({
  page,
}) => {
  const st = await openSynthetic(page)
  await page.evaluate(() => window.__scenario!.run('logoWordmark', 0))
  await expect.poll(() => readLogo(page).then((l) => l.visible)).toBe(true)
  await waitFrames(page, 2)
  const logo = await readLogo(page)
  const L = st.layout
  const hc = humanCell(L, logo.rect!)
  const pt = cellCenter(L, hc.col, hc.row)
  expect(await samplePixel(page, ...pt)).toEqual(NAVY)

  await page.evaluate(() => window.__scenario!.run('windowAt(40,20,8)'))
  await expect.poll(() => readLoop(page).then((l) => l.mask !== null)).toBe(true)
  await expect.poll(() => readLogo(page).then((l) => l.visible)).toBe(false)
  // Giữ cửa sổ mở chừng 15 frame để gate audit đo ít nhất một buffer giới hạn.
  await waitFrames(page, 15)
  expect(await samplePixel(page, ...pt)).toEqual(WHITE)
  const stat = page.getByTestId('logo-stat')
  await expect(stat).toContainText('logo: ẩn (vùng mở)')

  const t0 = Date.now()
  await page.evaluate(() => window.__scenario!.run('coverAll'))
  await expect.poll(() => readLoop(page).then((l) => l.mask === null)).toBe(true)
  await waitFrames(page, 2)
  const early = await readLogo(page)
  const earlyPx = await samplePixel(page, ...pt)
  const tEarly = Date.now() - t0
  await expect.poll(() => readLogo(page).then((l) => l.visible), { timeout: 10_000 }).toBe(true)
  const tBack = Date.now() - t0
  await waitFrames(page, 2)
  expect(await samplePixel(page, ...pt)).toEqual(NAVY)
  await expect(stat).toContainText('logo: hiện')
  if (tEarly < REAPPEAR_MS - 100) {
    expect(early.visible).toBe(false)
    expect(earlyPx).toEqual(WHITE)
  }
  expect(tBack).toBeGreaterThanOrEqual(REAPPEAR_MS - 50)
  await expectGateClean(page, 1)
  note(`đóng vùng: ẩn ở ${tEarly} ms, hiện lại ở ${tBack} ms (mốc ${REAPPEAR_MS} ms)`)
})

test('công tắc "Logo trên màn che" tắt → ô logo trắng ngay; ?logo=0 tắt lúc mở; giữ qua tải lại trong tab (sessionStorage wct.ui); nhãn tiếng Anh', async ({
  page,
}) => {
  const st = await openSynthetic(page)
  await page.evaluate(() => window.__scenario!.run('logoWordmark', 0))
  await expect.poll(() => readLogo(page).then((l) => l.visible)).toBe(true)
  await waitFrames(page, 2)
  const logo = await readLogo(page)
  const hc = humanCell(st.layout, logo.rect!)
  const pt = cellCenter(st.layout, hc.col, hc.row)
  expect(await samplePixel(page, ...pt)).toEqual(NAVY)

  const box = page.getByRole('checkbox', { name: 'Logo trên màn che' })
  await expect(box).toBeChecked()
  await box.uncheck()
  await expect.poll(() => readLogo(page).then((l) => l.enabled)).toBe(false)
  await expect.poll(() => readLoop(page).then((l) => l.logoVisible)).toBe(false)
  await waitFrames(page, 2)
  expect(await samplePixel(page, ...pt)).toEqual(WHITE)
  await expect(page.getByTestId('logo-stat')).toHaveText('logo: tắt')
  expect(JSON.parse(await page.evaluate(() => sessionStorage.getItem('wct.ui')!)).logo).toBe(false)

  // Tải lại cùng tab (không có tham số logo): giữ giá trị đã lưu (tắt).
  await page.goto('about:blank')
  await page.goto('/#/app?debug=1&source=synthetic')
  await expect(page.locator('canvas#stage')).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'Logo trên màn che' })).not.toBeChecked()
  await expect.poll(() => readLogo(page).then((l) => l.enabled)).toBe(false)

  // ?logo=1 đè giá trị đã lưu; ?logo=0 tắt.
  await openApp(page, '?debug=1&source=synthetic&logo=1')
  await expect(page.getByRole('checkbox', { name: 'Logo trên màn che' })).toBeChecked()
  await openApp(page, '?debug=1&source=synthetic&logo=0')
  await expect(page.getByRole('checkbox', { name: 'Logo trên màn che' })).not.toBeChecked()
  await expect.poll(() => readLoop(page).then((l) => l.logoVisible)).toBe(false)
  await expectCanvasWhite(page)

  await openApp(page, '?debug=1&source=synthetic&logo=1&lang=en')
  await expect(page.getByRole('checkbox', { name: 'Logo on the cover' })).toBeChecked()
  note('công tắc, ?logo=0|1 và sessionStorage wct.ui.logo; nhãn "Logo on the cover" với ?lang=en')
})
