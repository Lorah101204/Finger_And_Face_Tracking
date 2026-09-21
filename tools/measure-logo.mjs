// BRAND-01 (D-056): measures a raster export of the campaign logo (and, optionally, a mock-up image of the wanted
// result). The geometry that `core/brandLogo.ts` hard-codes comes from the rect attributes of the bundled SVG
// (`src/assets/logo-verify-human.svg`); this tool cross-checks a PNG export against it (frame strokes, ink colors,
// wordmark bounds) and reads a mock-up's cell pitch and block bounding box. Decodes with a canvas in Chromium headless
// (no image library in the tool chain). Ink = alpha ≥ 128; green = g > r + 20 and g > b + 20; everything else navy.
// Frames are the long straight navy runs (≥ 120 px horizontal, ≥ 40 px vertical).
// Usage: node tools/measure-logo.mjs <logo.png> [mockup.png]
/* global Image, document */
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const [logoPath, mockPath] = process.argv.slice(2)
if (!logoPath) {
  console.error('usage: node tools/measure-logo.mjs <logo.png> [mockup.png]')
  process.exit(2)
}
const dataUrl = (p) => 'data:image/png;base64,' + readFileSync(p).toString('base64')

const browser = await chromium.launch()
const page = await browser.newPage()
const out = await page.evaluate(
  async ([logo, mock]) => {
    async function load(src) {
      const img = new Image()
      img.src = src
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const ctx = c.getContext('2d')
      ctx.drawImage(img, 0, 0)
      return { w: c.width, h: c.height, d: ctx.getImageData(0, 0, c.width, c.height).data }
    }
    const L = await load(logo)
    const cls = (i) => {
      const [r, g, b, a] = [L.d[i], L.d[i + 1], L.d[i + 2], L.d[i + 3]]
      if (a < 128) return 0
      return g > r + 20 && g > b + 20 ? 2 : 1
    }
    const m = new Uint8Array(L.w * L.h)
    const colors = [{}, {}, {}]
    for (let y = 0; y < L.h; y++)
      for (let x = 0; x < L.w; x++) {
        const i = (y * L.w + x) * 4
        const v = cls(i)
        m[y * L.w + x] = v
        if (v && L.d[i + 3] === 255) {
          const k = `${L.d[i]},${L.d[i + 1]},${L.d[i + 2]}`
          colors[v][k] = (colors[v][k] ?? 0) + 1
        }
      }
    const bbox = (pred) => {
      let x0 = Infinity,
        y0 = Infinity,
        x1 = -1,
        y1 = -1
      for (let y = 0; y < L.h; y++)
        for (let x = 0; x < L.w; x++)
          if (pred(x, y, m[y * L.w + x])) {
            x0 = Math.min(x0, x)
            x1 = Math.max(x1, x)
            y0 = Math.min(y0, y)
            y1 = Math.max(y1, y)
          }
      return x1 < 0 ? null : [x0, y0, x1, y1]
    }
    const runs = (horizontal, min) => {
      const out = []
      const n = horizontal ? L.h : L.w
      const len = horizontal ? L.w : L.h
      for (let k = 0; k < n; k++) {
        let run = 0,
          best = 0,
          at = 0
        for (let t = 0; t <= len; t++) {
          const v = t < len ? m[horizontal ? k * L.w + t : t * L.w + k] : 0
          if (v === 1) run++
          else {
            if (run > best) {
              best = run
              at = t - run
            }
            run = 0
          }
        }
        if (best >= min) out.push({ k, at, len: best })
      }
      return out
    }
    const top = (o) =>
      Object.entries(o)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
    const res = {
      w: L.w,
      h: L.h,
      ink: bbox((x, y, v) => v > 0),
      green: bbox((x, y, v) => v === 2),
      navyColors: top(colors[1]),
      greenColors: top(colors[2]),
      hLines: runs(true, 120),
      vLines: runs(false, 40),
    }
    if (!mock) return { logo: res }
    const D = await load(mock)
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -1,
      y1 = -1,
      black = 0
    for (let y = 0; y < D.h; y++)
      for (let x = 0; x < D.w; x++) {
        const i = (y * D.w + x) * 4
        if (D.d[i] < 40 && D.d[i + 1] < 40 && D.d[i + 2] < 50) {
          black++
          x0 = Math.min(x0, x)
          x1 = Math.max(x1, x)
          y0 = Math.min(y0, y)
          y1 = Math.max(y1, y)
        }
      }
    // Grid pitch: mean luminance per column (ignoring the black blocks); local minima are the grid lines.
    const colLum = []
    for (let x = 0; x < D.w; x++) {
      let s = 0,
        n = 0
      for (let y = 0; y < D.h; y++) {
        const i = (y * D.w + x) * 4
        const l = 0.299 * D.d[i] + 0.587 * D.d[i + 1] + 0.114 * D.d[i + 2]
        if (l > 60) {
          s += l
          n++
        }
      }
      colLum.push(n ? s / n : 0)
    }
    const minima = []
    for (let x = 1; x < D.w - 1; x++)
      if (colLum[x] < colLum[x - 1] - 3 && colLum[x] <= colLum[x + 1]) minima.push(x)
    return {
      logo: res,
      mock: { w: D.w, h: D.h, blackBox: [x0, y0, x1, y1], blackPx: black, lineCols: minima },
    }
  },
  [dataUrl(logoPath), mockPath ? dataUrl(mockPath) : null],
)
await browser.close()

const group = (items, key) => {
  const g = []
  for (const it of items) {
    const last = g[g.length - 1]
    if (last && it[key] - last.end <= 1) {
      last.end = it[key]
      last.items.push(it)
    } else g.push({ start: it[key], end: it[key], items: [it] })
  }
  return g
}
const { logo, mock } = out
console.log(
  `logo ${logoPath}: ${logo.w} × ${logo.h} px, ink bbox [${logo.ink}], green bbox [${logo.green}]`,
)
console.log(
  `  navy ${logo.navyColors.map(([k, n]) => `rgb(${k}) ×${n}`).join(', ')}; green ${logo.greenColors.map(([k, n]) => `rgb(${k}) ×${n}`).join(', ')}`,
)
for (const g of group(logo.hLines, 'k'))
  console.log(
    `  horizontal stroke y ${g.start}–${g.end}: x ${g.items[0].at}–${g.items[0].at + g.items[0].len - 1}`,
  )
for (const g of group(logo.vLines, 'k'))
  console.log(
    `  vertical stroke x ${g.start}–${g.end}: y ${g.items[0].at}–${g.items[0].at + g.items[0].len - 1}`,
  )
if (mock) {
  const cols = group(
    mock.lineCols.map((x) => ({ x })),
    'x',
  ).map((g) => g.start)
  // Median spacing of the line columns (robust against the extra minima at the block edges).
  const diffs = cols
    .slice(1)
    .map((x, i) => x - cols[i])
    .sort((a, b) => a - b)
  const pitch = diffs.length ? diffs[Math.floor(diffs.length / 2)] : 0
  console.log(
    `mock-up ${mockPath}: ${mock.w} × ${mock.h} px, black blocks bbox [${mock.blackBox}] (${mock.blackPx} px), grid pitch ≈ ${pitch} px (median of ${cols.length} line columns)`,
  )
}
