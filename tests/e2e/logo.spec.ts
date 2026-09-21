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
  type LogoSnap,
  type StageSnap,
} from './helpers'

// BRAND-01 (mục 7.33, D-056, D-057, D-058): logo chiến dịch (ảnh gốc) khảm vào màn che ở góc trên trái, đặt lên lưới
// bảng theo module k ô để viền ba khung trùng vạch ô (lưới thô thì cỡ cố định 30 % stage); có mực xanh lá trong khung
// VERIFY và navy trong khung Human, ngoài rect chỉ
// trắng/xám vạch; vùng mở đè lên logo theo từng ô (ô mở hiện camera, ô kề vẫn còn logo) và đóng thì logo về ngay;
// công tắc, `?logo=0` và sessionStorage; frame tĩnh không vẽ lại. Mọi ca khác của bộ e2e mở stage với `logo=0`
// (helpers.openApp) nên không đổi.
const MAGENTA = [255, 0, 255, 255]
const NAVY = [31, 53, 102, 255]

async function openSynthetic(page: Page, query = '?debug=1&source=synthetic&logo=1') {
  await installGumCounter(page)
  await seedConsent(page)
  await openApp(page, query)
  await expect(page.locator('canvas#stage')).toBeVisible()
  await installGateAudit(page)
  const st = await readStage(page)
  await expect.poll(() => readLoop(page).then((l) => l.frames)).toBeGreaterThan(2)
  await expect.poll(() => readLogo(page).then((l) => l.ready && l.visible)).toBe(true)
  return st
}

/** Tâm của ô (col, row) theo layout hiện tại. */
function cellCenter(L: StageSnap['layout'], col: number, row: number): [number, number] {
  return [L.board.x + col * L.c + Math.floor(L.c / 2), L.board.y + row * L.c + Math.floor(L.c / 2)]
}

function cellOf(L: StageSnap['layout'], x: number, y: number) {
  return { col: Math.floor((x - L.board.x) / L.c), row: Math.floor((y - L.board.y) / L.c) }
}

async function waitFrames(page: Page, n: number) {
  const a = (await readLoop(page)).frames
  await expect
    .poll(() => readLoop(page).then((l) => l.frames - a), { timeout: 30_000 })
    .toBeGreaterThanOrEqual(n)
}

/** Đếm pixel theo màu mực trong một rect của canvas: xanh lá (VERIFY), navy (khung, chữ), trắng, magenta (cảnh). */
function countInk(page: Page, r: { x: number; y: number; w: number; h: number }) {
  return page.evaluate((rect) => {
    const ctx = document.querySelector<HTMLCanvasElement>('canvas#stage')!.getContext('2d')!
    const d = ctx.getImageData(
      Math.round(rect.x),
      Math.round(rect.y),
      Math.max(1, Math.round(rect.w)),
      Math.max(1, Math.round(rect.h)),
    ).data
    let green = 0
    let navy = 0
    let white = 0
    let magenta = 0
    for (let i = 0; i < d.length; i += 4) {
      const [R, G, B] = [d[i], d[i + 1], d[i + 2]]
      if (G > R + 20 && G > B + 20) green++
      else if (B > R + 30 && B > G + 30 && R < 90) navy++
      else if (R > 250 && G > 250 && B > 250) white++
      else if (R > 200 && B > 200 && G < 60) magenta++
    }
    return { green, navy, white, magenta }
  }, r)
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
})

test('khớp ô (D-058): ở 64 và 128 cột logo là 21 × 8 ô module, mọi cạnh ba khung nằm trên vạch ô (pixel navy trên vạch, trắng hai bên), cỡ gần 30 % stage; 32 cột quá thô thì cỡ cố định 30 % không khớp ô; mực đúng khung, ngoài rect sạch, mép canvas trắng; frame tĩnh không vẽ lại', async ({
  page,
}) => {
  await openSynthetic(page)
  const widths: number[] = []
  const notes: string[] = []
  for (const preset of ['0', '1', '2']) {
    await page.getByLabel('Lưới', { exact: true }).selectOption(preset)
    const cols = [32, 64, 128][Number(preset)]
    await expect.poll(async () => (await readStage(page)).settings.cols).toBe(cols)
    await waitFrames(page, 3)
    const L = (await readStage(page)).layout
    const logo = await readLogo(page)
    expect(logo.enabled).toBe(true)
    expect(logo.rect).not.toBeNull()
    const r = logo.rect!
    widths.push(r.w)
    expect(r.x + r.w).toBeLessThanOrEqual(L.board.x + L.board.w)
    expect(r.y + r.h).toBeLessThanOrEqual(L.board.y + L.board.h)
    const k = Math.max(1, Math.round((L.stage.w * 0.3) / (21 * L.c)))
    if (21 * k * L.c <= 0.5 * L.stage.w) {
      // Khớp ô: rect và ba khung là bội của ô, đặt cách mép bảng đúng số ô lề.
      expect(logo.snapped).toBe(true)
      expect(logo.module).toBe(k * L.c)
      expect(r.w).toBe(21 * k * L.c)
      expect(r.h).toBe(8 * k * L.c)
      const m = Math.round((0.025 * L.stage.w) / L.c)
      expect(r.x).toBe(L.board.x + m * L.c)
      expect(r.y).toBe(L.board.y + m * L.c)
      for (const f of logo.frames) {
        for (const v of [f.x - L.board.x, f.y - L.board.y, f.w, f.h]) expect(v % L.c).toBe(0)
      }
      // Nét khung nằm trên vạch ô: giữa các cạnh ngoài của logo là navy, 3 px phía ngoài là trắng (cạnh chung giữa
      // hai khung và phía trong có thể chạm chữ nên không lấy mẫu).
      const [fv, fh, fc] = logo.frames
      const edges: [number, number, number, number][] = [
        [Math.round(fv.x + fv.w / 2), fv.y, 0, -3], // cạnh trên VERIFY
        [fv.x + fv.w, Math.round(fv.y + fv.h / 2), 3, 0], // cạnh phải VERIFY
        [fh.x, Math.round(fh.y + fh.h / 2), -3, 0], // cạnh trái Human
        [Math.round(fc.x + fc.w / 2), fc.y + fc.h, 0, 3], // cạnh dưới dòng chiến dịch
      ]
      for (const [x, y, dx, dy] of edges) {
        expect(await samplePixel(page, x, y)).toEqual(NAVY)
        // 3 px phía ngoài: trắng, hoặc xám vạch khi điểm lấy mẫu rơi đúng một vạch ô vuông góc.
        expect([WHITE, GRID_GRAY]).toContainEqual(await samplePixel(page, x + dx, y + dy))
      }
    } else {
      // Lưới thô (32 cột trên stage 960: 21 ô = 630 px > 50 %): cỡ cố định theo stage.
      expect(logo.snapped).toBe(false)
      expect(logo.module).toBe(0)
      expect(r.w).toBe(Math.round(L.stage.w * 0.3))
    }
    const [verify, human] = logo.frames
    const v = await countInk(page, verify)
    const h = await countInk(page, human)
    const right = await countInk(page, { x: r.x + r.w + 4, y: r.y, w: 40, h: r.h })
    const below = await countInk(page, { x: r.x, y: r.y + r.h + 4, w: r.w, h: 40 })
    expect(v.green).toBeGreaterThan(50)
    expect(v.navy).toBeGreaterThan(50)
    expect(h.navy).toBeGreaterThan(50)
    expect(h.green).toBe(0)
    expect(right.green + right.navy + below.green + below.navy).toBe(0)
    notes.push(
      `${cols} cột (ô ${L.c} px): ${r.w}×${r.h} px ${logo.snapped ? `khớp ô, module ${logo.module}` : 'cỡ cố định'}`,
    )
    await expectCanvasWhite(page)
  }
  // Cỡ gần bằng nhau giữa các preset (khớp ô làm tròn theo module).
  expect(Math.max(...widths) / Math.min(...widths)).toBeLessThan(1.15)
  const a = await readLoop(page)
  await waitFrames(page, 20)
  const b = await readLoop(page)
  expect(b.paints - a.paints).toBe(0)
  note(`${notes.join('; ')}; paints +0 sau ${b.frames - a.frames} frame tĩnh`)
})

test('vùng mở cắt logo theo ô: ô mở trên khung Human hiện camera (magenta), ô kề chưa mở vẫn còn mực logo, ngoài cửa sổ logo nguyên; đóng thì logo về ngay; gate audit sạch; không request nào ra ngoài', async ({
  page,
}) => {
  const external: string[] = []
  page.on('request', (req) => {
    const u = new URL(req.url())
    // blob: là URL trong trang (SVG trong bundle), không phải request ra ngoài.
    if (u.protocol !== 'blob:' && !['127.0.0.1', 'localhost'].includes(u.hostname))
      external.push(u.href)
  })
  const st = await openSynthetic(page)
  const L = st.layout
  const logo: LogoSnap = await readLogo(page)
  const human = logo.frames[1]
  const before = await countInk(page, human)
  expect(before.navy).toBeGreaterThan(50)
  // Cửa sổ n ô phủ nửa trái khung Human: từ ô chứa tâm mép trái khung, rộng bằng nửa khung.
  const n = Math.max(2, Math.floor(human.w / 2 / L.c))
  const start = cellOf(L, human.x + L.c / 2, human.y + human.h / 2 - ((n - 1) * L.c) / 2)
  await page.evaluate(
    ([col, row, n]) => window.__scenario!.run('windowAt', col, row, n),
    [start.col, start.row, n],
  )
  await expect.poll(() => readLoop(page).then((l) => l.mask !== null)).toBe(true)
  await waitFrames(page, 15)
  // Ô mở: pixel camera (nửa trái bảng là nền magenta của cảnh tổng hợp với mirror bật).
  const inside = await samplePixel(page, ...cellCenter(L, start.col + 1, start.row + 1))
  expect(inside).toEqual(MAGENTA)
  const openRect = {
    x: L.board.x + start.col * L.c,
    y: L.board.y + start.row * L.c,
    w: n * L.c,
    h: n * L.c,
  }
  // Lùi 4 px để bỏ viền cửa sổ 2 px (xanh dương, vẽ trong ô mở).
  const openInk = await countInk(page, {
    x: openRect.x + 4,
    y: openRect.y + 4,
    w: openRect.w - 8,
    h: openRect.h - 8,
  })
  expect(openInk.green + openInk.navy + openInk.white).toBe(0)
  expect(openInk.magenta).toBeGreaterThan(((openRect.w - 8) * (openRect.h - 8)) / 2)
  // Cột ô ngay bên phải cửa sổ (chưa mở) trong khung Human vẫn có mực navy; phần logo ngoài cửa sổ vẫn nguyên.
  const beside = await countInk(page, {
    x: openRect.x + openRect.w,
    y: human.y,
    w: L.c,
    h: human.h,
  })
  expect(beside.navy).toBeGreaterThan(0)
  expect(beside.magenta).toBe(0)
  const verify = await countInk(page, logo.frames[0])
  expect(verify.green).toBeGreaterThan(50)
  await expect(page.getByTestId('logo-stat')).toContainText('logo: hiện')
  await expectGateClean(page, 1)

  await page.evaluate(() => window.__scenario!.run('coverAll'))
  await expect.poll(() => readLoop(page).then((l) => l.mask === null)).toBe(true)
  await waitFrames(page, 2)
  const after = await countInk(page, human)
  expect(after.magenta).toBe(0)
  expect(Math.abs(after.navy - before.navy)).toBeLessThanOrEqual(2)
  expect(external).toEqual([])
  note(
    `cửa sổ ${n} ô tại (${start.col}, ${start.row}): ${openInk.magenta} px magenta, 0 px mực trong ô mở; ô kề ${beside.navy} px navy; đóng: ${after.navy}/${before.navy} px navy trong khung Human`,
  )
})

test('công tắc "Logo trên màn che" tắt → canvas trắng ngay; ?logo=0 tắt lúc mở; giữ qua tải lại trong tab (sessionStorage wct.ui); nhãn tiếng Anh', async ({
  page,
}) => {
  await openSynthetic(page)
  const logo = await readLogo(page)
  const human = logo.frames[1]
  expect((await countInk(page, human)).navy).toBeGreaterThan(50)

  const box = page.getByRole('checkbox', { name: 'Logo trên màn che' })
  await expect(box).toBeChecked()
  await box.uncheck()
  await expect.poll(() => readLogo(page).then((l) => l.enabled)).toBe(false)
  await expect.poll(() => readLoop(page).then((l) => l.logoVisible)).toBe(false)
  await waitFrames(page, 2)
  const off = await countInk(page, human)
  expect(off.navy + off.green).toBe(0)
  expect(
    await samplePixel(page, Math.round(human.x + human.w / 2), Math.round(human.y + human.h / 2)),
  ).toEqual(WHITE)
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
