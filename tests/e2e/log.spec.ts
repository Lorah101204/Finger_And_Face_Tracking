import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import {
  CONSENT_VERSION,
  installGumCounter,
  note,
  openApp,
  readLoop,
  readStage,
  seedConsent,
  startFakeCamera,
  watchApiLikeRequests,
  type LogEventSnap,
} from './helpers'

// LOG-02 (mục 7.25, D-022, D-046): nhật ký cục bộ chỉ ghi sự kiện metadata vào IndexedDB của trình duyệt, mặc định
// tắt, xem tại chỗ, xuất CSV, xóa; không có đường mạng. Ca 1 chạy một phiên thật với camera giả và cửa sổ chuột rồi
// kiểm CSV; ca 2 kiểm giới hạn 30 ngày và 10 000 bản ghi bằng cách ghi thẳng vào kho.
const readLog = (page: Page) => page.evaluate(() => window.__wct!.log!.snapshot())
const listLog = (page: Page, filter?: { type?: string; day?: string }) =>
  page.evaluate((f) => window.__wct!.log!.list(f), filter)
const flushLog = (page: Page) => page.evaluate(() => window.__wct!.log!.flush())
const todayInPage = (page: Page) =>
  page.evaluate(() => {
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  })

const IMAGE_KEYS = /frame|image|bitmap|landmark|crop|pixel|png|jpeg|base64|blob/i
/** Payload là metadata: JSON ≤ 1 KB, không khóa gợi ảnh, không chuỗi dài hay data URL. */
function expectMetadataOnly(events: LogEventSnap[]): void {
  for (const e of events) {
    const json = JSON.stringify(e.payload)
    expect(json.length, `${e.type}: ${json.slice(0, 80)}`).toBeLessThanOrEqual(1024)
    expect(json).not.toMatch(/data:[a-z]+\//i)
    for (const [k, v] of Object.entries(e.payload)) {
      expect(k).not.toMatch(IMAGE_KEYS)
      if (typeof v === 'string') expect(v.length).toBeLessThan(200)
    }
  }
}

test('mặc định tắt; bật thì ghi consent; phiên camera giả, cửa sổ chuột, đổi lưới, dừng camera → đúng loại sự kiện, chỉ metadata, CSV tải về, bảng lọc, giữ qua tải lại, xóa; không gọi mạng', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const seen = watchApiLikeRequests(page)
  await installGumCounter(page)
  await seedConsent(page)
  await openApp(page)
  await expect(page.locator('canvas#stage')).toBeVisible()
  await readStage(page)

  // Mặc định tắt: không có khóa, không bản ghi, trạng thái ở thanh trên.
  await expect(page.getByTestId('log-stat')).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('wct.log'))).toBeNull()
  await expect(page.getByLabel('Ghi nhật ký cục bộ')).not.toBeChecked()
  await expect.poll(async () => (await readLog(page)).storeReady).toBe(true)
  expect((await readLog(page)).count).toBe(0)
  await startFakeCamera(page)
  await page.getByRole('button', { name: 'Dừng camera' }).click()
  await flushLog(page)
  expect((await readLog(page)).count).toBe(0)

  // Bật: ghi consent hiện tại, khóa localStorage, thanh trên hiện số bản ghi.
  await page.getByLabel('Ghi nhật ký cục bộ').check()
  await expect(page.getByTestId('log-stat')).toHaveText(/^nhật ký bật · \d+$/)
  expect(await page.evaluate(() => localStorage.getItem('wct.log'))).toBe('1')
  await expect.poll(async () => (await readLog(page)).count).toBeGreaterThanOrEqual(1)

  // Phiên: camera giả, cửa sổ chuột (Space mở, Esc đóng), đổi lưới, dừng camera.
  await startFakeCamera(page)
  await page.keyboard.press('Space')
  await expect.poll(async () => (await readLoop(page)).reveal.kind).toBe('open')
  await page.keyboard.press('Escape')
  await expect.poll(async () => (await readLoop(page)).reveal.kind).toBe('closed')
  await page.getByLabel('Lưới', { exact: true }).selectOption('0')
  await expect.poll(async () => (await readStage(page)).settings.cols).toBe(32)
  await page.getByRole('button', { name: 'Dừng camera' }).click()
  await expect
    .poll(async () => (await listLog(page)).map((e) => e.type).includes('camera-stop'))
    .toBe(true)
  await flushLog(page)
  const events = await listLog(page)
  const types = events.map((e) => e.type)
  expect(new Set(types)).toEqual(
    new Set([
      'consent',
      'camera-start',
      'reveal-open',
      'reveal-close',
      'config-change',
      'camera-stop',
    ]),
  )
  // Thứ tự ghi và nội dung metadata.
  const idx = (t: string) => types.indexOf(t)
  expect(idx('consent')).toBeLessThan(idx('camera-start'))
  expect(idx('camera-start')).toBeLessThan(idx('reveal-open'))
  expect(idx('reveal-open')).toBeLessThan(idx('reveal-close'))
  expect(idx('reveal-close')).toBeLessThan(idx('camera-stop'))
  const by = (t: string) => events.filter((e) => e.type === t)
  expect(by('consent')[0].payload).toEqual({ version: CONSENT_VERSION, scope: 'device' })
  expect(by('camera-start')[0].payload).toMatchObject({
    width: expect.any(Number),
    height: expect.any(Number),
  })
  expect(by('reveal-open')[0].payload).toMatchObject({
    source: 'mouse',
    shape: 'window',
    cells: 64,
    limited: false,
  })
  expect(by('reveal-close')[0].payload).toMatchObject({ reason: 'user' })
  const cfg = by('config-change').find((e) => (e.payload.changed as string[]).includes('cols'))
  expect(cfg?.payload).toMatchObject({ cols: 32, rows: 18 })
  expect(by('camera-stop')[0].payload).toEqual({ reason: 'user' })
  for (const e of events) {
    expect(e.ts).toBeGreaterThan(Date.now() - 120_000)
    expect(e.id).toEqual(expect.any(Number))
  }
  expectMetadataOnly(events)

  // Xuất CSV: tải về qua <a download>, đúng số dòng và loại, không dữ liệu ảnh.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Xuất CSV' }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/^wct-log-\d{4}-\d{2}-\d{2}\.csv$/)
  const csv = readFileSync((await download.path())!, 'utf8')
  const lines = csv.split('\n').filter((l) => l.length > 0)
  expect(lines[0]).toBe('ts,time,type,payload')
  expect(lines).toHaveLength(events.length + 1)
  for (const [i, e] of events.entries()) {
    expect(lines[i + 1].startsWith(`${e.ts},${new Date(e.ts).toISOString()},${e.type},`)).toBe(true)
  }
  expect(csv).not.toMatch(/data:image|base64/i)

  // Bảng xem tại chỗ: lọc theo loại và ngày.
  await page.getByRole('button', { name: 'Xem nhật ký' }).click()
  const rows = page.getByTestId('log-table').locator('tbody tr[data-type]')
  await expect(rows).toHaveCount(events.length)
  await page.getByLabel('Lọc loại').selectOption('reveal-open')
  await expect(rows).toHaveCount(by('reveal-open').length)
  await expect(rows.first()).toHaveAttribute('data-type', 'reveal-open')
  await page.getByLabel('Lọc loại').selectOption('all')
  await page.getByLabel('Lọc ngày').fill(await todayInPage(page))
  await expect(rows).toHaveCount(events.length)
  await page.getByLabel('Lọc ngày').fill('2000-01-01')
  await expect(rows).toHaveCount(0)
  await expect(page.getByTestId('log-table')).toContainText('không có bản ghi')

  // Tải lại: công tắc giữ (localStorage), bản ghi giữ (IndexedDB), thêm consent của phiên mới.
  await page.reload()
  await expect(page.locator('canvas#stage')).toBeVisible()
  await expect(page.getByTestId('log-stat')).toHaveText(/^nhật ký bật · \d+$/)
  await expect.poll(async () => (await readLog(page)).count).toBe(events.length + 1)

  // Xóa nhật ký: 0 bản ghi, tải lại vẫn 0 (chỉ consent mới); tắt thì mở vùng không ghi thêm.
  await page.getByRole('button', { name: 'Xóa nhật ký' }).click()
  await expect.poll(async () => (await readLog(page)).count).toBe(0)
  await page.reload()
  await expect(page.locator('canvas#stage')).toBeVisible()
  await expect.poll(async () => (await readLog(page)).count).toBe(1)
  await page.getByLabel('Ghi nhật ký cục bộ').uncheck()
  await expect(page.getByTestId('log-stat')).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('wct.log'))).toBe('0')
  await startFakeCamera(page)
  await page.keyboard.press('Space')
  await expect.poll(async () => (await readLoop(page)).reveal.kind).toBe('open')
  await flushLog(page)
  expect((await readLog(page)).count).toBe(1)

  expect(seen).toEqual([])
  note(
    `${events.length} sự kiện trong phiên: ${[...new Set(types)].join(', ')}; CSV ${lines.length - 1} dòng, ${csv.length} ký tự; payload lớn nhất ${Math.max(...events.map((e) => JSON.stringify(e.payload).length))} byte; yêu cầu ngoài tài nguyên tĩnh: 0`,
  )
})

test('giới hạn: bản ghi quá 30 ngày bị xóa, quá 10 000 bản ghi xóa cũ trước; xóa về 0', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await installGumCounter(page)
  await seedConsent(page)
  await openApp(page, '?debug=1&source=synthetic')
  await expect(page.locator('canvas#stage')).toBeVisible()
  await expect.poll(async () => (await readLog(page)).storeReady).toBe(true)
  await page.getByLabel('Ghi nhật ký cục bộ').check()
  await expect.poll(async () => (await readLog(page)).count).toBe(1)
  const DAY = 24 * 60 * 60 * 1000
  const t0 = Date.now()
  const added = await page.evaluate(
    async ([now, day]) => {
      const old = [31, 40, 400].map((d) => ({
        ts: now - d * day,
        type: 'camera-start',
        payload: { old: d },
      }))
      const recent = Array.from({ length: 10_005 }, (_, i) => ({
        ts: now - 1_000_000 + i,
        type: 'reveal-open',
        payload: { i },
      }))
      return window.__wct!.log!.appendRaw([...old, ...recent])
    },
    [t0, DAY] as const,
  )
  expect(added).toBe(10_008)
  // appendRaw gọi start(): dọn ngay. 1 consent + 3 cũ + 10 005 → bỏ 3 cũ, rồi cắt 6 cũ nhất (consent và i = 0..4).
  const snap = await readLog(page)
  expect(snap.count).toBe(10_000)
  const all = await listLog(page)
  expect(all).toHaveLength(10_000)
  expect(all.every((e) => e.ts >= t0 - 30 * DAY)).toBe(true)
  expect(all[0].payload).toEqual({ i: 5 })
  expect(all[all.length - 1].payload).toEqual({ i: 10_004 })
  expect(all.some((e) => e.type === 'consent')).toBe(false)
  await expect(page.getByTestId('log-count')).toHaveText(/^10000 bản ghi/)
  // Lọc ngày: mọi bản ghi còn lại cùng ngày hôm nay (ts cách nay 1000 s) trừ khi vừa qua nửa đêm.
  const today = await todayInPage(page)
  const todayCount = (await listLog(page, { day: today })).length
  expect(todayCount === 10_000 || todayCount === 0).toBe(true)
  await page.getByRole('button', { name: 'Xóa nhật ký' }).click()
  await expect.poll(async () => (await readLog(page)).count).toBe(0)
  expect(await listLog(page)).toEqual([])
  note(`ghi thẳng 10 008 bản ghi (3 quá 30 ngày) → còn ${snap.count} sau khi dọn; xóa → 0`)
})
