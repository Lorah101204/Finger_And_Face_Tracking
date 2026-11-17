import { describe, expect, it } from 'vitest'
import type { FrameSource } from '../../src/camera/frameSource'
import { computeLayout } from '../../src/core/coords'
import { computeLetterbox } from '../../src/core/letterbox'
import type { Probes } from '../../src/debug/probes'
import { buildMask, polygonShape, windowShape } from '../../src/mask/buildMask'
import { createRestrictedFrameBuilder } from '../../src/mask/restrictedFrame'

// MASK-02 qua canvas giả ghi lại lời gọi (Node không có OffscreenCanvas). Kiểm thứ tự, tham số và thống kê;
// pixel kiểm ở e2e mục 7.10.
const VIDEO = { tag: 'video' } as unknown as CanvasImageSource

class StubCtx {
  fillStyle = ''
  owner: StubCanvas
  log: string[]
  constructor(owner: StubCanvas, log: string[]) {
    this.owner = owner
    this.log = log
  }
  fillRect(...a: number[]) {
    this.log.push(`${this.owner.name}.fillRect ${a.join(',')} ${this.fillStyle}`)
  }
  clearRect(...a: number[]) {
    this.log.push(`${this.owner.name}.clearRect ${a.join(',')}`)
  }
  drawImage(src: unknown, ...a: number[]) {
    const from = src === VIDEO ? 'video' : src instanceof StubCanvas ? src.name : '?'
    this.log.push(`${this.owner.name}.drawImage ${from} ${a.join(',')}`)
  }
  getImageData(x: number, y: number, w: number, h: number) {
    this.log.push(`${this.owner.name}.getImageData ${x},${y},${w},${h}`)
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) } as ImageData
  }
}

class StubCanvas {
  name: string
  width: number
  height: number
  log: string[]
  ctx: StubCtx
  transfers = 0
  constructor(name: string, width: number, height: number, log: string[]) {
    this.name = name
    this.width = width
    this.height = height
    this.log = log
    this.ctx = new StubCtx(this, log)
  }
  getContext() {
    return this.ctx
  }
  transferToImageBitmap() {
    this.transfers++
    this.log.push(`${this.name}.transfer ${this.width}x${this.height}`)
    return { width: this.width, height: this.height, close() {} } as unknown as ImageBitmap
  }
}

function setup(opts: { probes?: Probes; drawable?: CanvasImageSource | null } = {}) {
  const log: string[] = []
  const canvases: StubCanvas[] = []
  const builder = createRestrictedFrameBuilder({
    probes: opts.probes,
    createCanvas: (w, h) => {
      const c = new StubCanvas(canvases.length === 0 ? 'crop' : 'lb', w, h, log)
      canvases.push(c)
      return c as unknown as OffscreenCanvas
    },
  })
  const source = {
    width: 1280,
    height: 720,
    drawable: opts.drawable === undefined ? VIDEO : opts.drawable,
    lastStamp: null,
    onFrame: () => () => {},
    stop() {},
  } as FrameSource
  return { log, canvases, builder, source }
}

// 64 × 36 trên 1280 × 720: c = 20, scale 1 nên cameraRect = stageRect. n = 8 → 160 px; n = 3 → 60 px (< 64).
const L = computeLayout({ w: 1280, h: 720 }, { cols: 64, rows: 36 }, { w: 1280, h: 720 })
const mask = buildMask(windowShape({ col: 10, row: 5, n: 8 }), L, false, 3)
const small = buildMask(windowShape({ col: 10, row: 5, n: 3 }), L, false, 3)
const stamp = { frameId: 42, ts: 1000 }

describe('createRestrictedFrameBuilder', () => {
  it('too-small: không tạo canvas, không tiêu taskId, đếm tooSmall', () => {
    const { builder, canvases, log, source } = setup()
    expect(builder.build(source, small, stamp, 3, 1)).toEqual({
      kind: 'too-small',
      side: 60,
      minRoiPx: 64,
    })
    expect(canvases).toHaveLength(0)
    expect(log).toEqual([])
    expect(builder.stats).toMatchObject({
      builds: 0,
      tooSmall: 1,
      lastTaskId: -1,
      lastKind: 'too-small',
    })
  })

  it('chưa có frame: no-frame, không động tới canvas', () => {
    const { builder, canvases, source } = setup({ drawable: null })
    expect(builder.build(source, mask, stamp, 3, 1)).toEqual({ kind: 'no-frame' })
    expect(canvases).toHaveLength(0)
    expect(builder.stats).toMatchObject({ noFrame: 1, lastKind: 'no-frame' })
  })

  it('ok: crop 1:1 đúng cameraRect từ video, letterbox từ canvas crop (xám trước), transfer; frame đúng metadata', () => {
    const { builder, canvases, log, source } = setup()
    const r = builder.build(source, mask, stamp, 3, 7)
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    const cr = mask.cameraRect
    const lb = computeLetterbox(cr.w, cr.h, 256)
    expect(canvases.map((c) => [c.name, c.width, c.height])).toEqual([
      ['crop', cr.w, cr.h],
      ['lb', 256, 256],
    ])
    expect(log).toEqual([
      `crop.clearRect 0,0,${cr.w},${cr.h}`,
      `crop.drawImage video ${cr.x},${cr.y},${cr.w},${cr.h},0,0,${cr.w},${cr.h}`,
      'lb.fillRect 0,0,256,256 rgb(128, 128, 128)',
      `lb.drawImage crop 0,0,${cr.w},${cr.h},${lb.dx},${lb.dy},${cr.w * lb.scale},${cr.h * lb.scale}`,
      'lb.transfer 256x256',
    ])
    expect(r.frames).toHaveLength(1)
    const f = r.frames[0]
    expect(f).toMatchObject({
      taskId: 7,
      epoch: 3,
      frameId: 42,
      ts: 1000,
      roiCam: cr,
      letterbox: lb,
    })
    expect(f.roiCam).not.toBe(mask.cameraRect)
    expect(f.input).toMatchObject({ width: 256, height: 256 })
    expect(builder.stats).toMatchObject({
      builds: 1,
      bitmaps: 1,
      lastTaskId: 7,
      lastCrop: { w: cr.w, h: cr.h },
      lastKind: 'ok',
    })
  })

  it('tái sử dụng canvas: cùng cỡ không tạo lại; cỡ khác chỉ đổi width/height của canvas crop', () => {
    const { builder, canvases, source } = setup()
    builder.build(source, mask, stamp, 3, 1)
    builder.build(source, mask, stamp, 3, 2)
    expect(canvases).toHaveLength(2)
    const other = buildMask(windowShape({ col: 0, row: 0, n: 12 }), L, false, 3)
    builder.build(source, other, stamp, 3, 3)
    expect(canvases).toHaveLength(2)
    expect([canvases[0].width, canvases[0].height]).toEqual([
      other.cameraRect.w,
      other.cameraRect.h,
    ])
    expect([canvases[1].width, canvases[1].height]).toEqual([256, 256])
    expect(canvases[1].transfers).toBe(3)
    expect(builder.stats.builds).toBe(3)
  })

  it('copies = 2: vẽ lại letterbox rồi transfer lần nữa; hai bitmap khác nhau, cùng taskId, crop chỉ một lần', () => {
    const { builder, canvases, log, source } = setup()
    const r = builder.build(source, mask, stamp, 3, 1, 2)
    if (r.kind !== 'ok') throw new Error(r.kind)
    expect(r.frames).toHaveLength(2)
    expect(r.frames[0].input).not.toBe(r.frames[1].input)
    expect(r.frames[0].taskId).toBe(r.frames[1].taskId)
    expect(canvases[1].transfers).toBe(2)
    expect(log.filter((l) => l.startsWith('lb.fillRect'))).toHaveLength(2)
    expect(log.filter((l) => l.startsWith('crop.drawImage'))).toHaveLength(1)
    expect(builder.stats.bitmaps).toBe(2)
  })

  it('probe: khi wantsRestrictedFrame đúng thì getImageData trước transfer và emit đúng metadata; sai thì không đọc ngược', () => {
    const emitted: unknown[] = []
    let wants = true
    const probes = {
      wantsRestrictedFrame: () => wants,
      emitRestrictedFrame: (img: ImageData, meta: unknown) => emitted.push({ w: img.width, meta }),
    } as unknown as Probes
    const { builder, log, source } = setup({ probes })
    builder.build(source, mask, stamp, 3, 5)
    const read = log.indexOf('lb.getImageData 0,0,256,256')
    expect(read).toBeGreaterThan(-1)
    expect(read).toBeLessThan(log.indexOf('lb.transfer 256x256'))
    expect(emitted).toEqual([
      {
        w: 256,
        meta: { epoch: 3, frameId: 42, ts: 1000, taskId: 5, roiCam: mask.cameraRect },
      },
    ])
    wants = false
    builder.build(source, mask, stamp, 3, 6)
    expect(log.filter((l) => l.includes('getImageData'))).toHaveLength(1)
  })

  it('dispose rồi build lại: tạo canvas mới', () => {
    const { builder, canvases, source } = setup()
    builder.build(source, mask, stamp, 3, 1)
    builder.dispose()
    builder.build(source, mask, stamp, 3, 2)
    expect(canvases).toHaveLength(4)
  })
})

// ROI-02 (D-038): mask tứ giác có lỗ: sau crop, từng lỗ được tô xám đệm trên canvas crop (tọa độ trừ gốc crop) trước
// khi letterbox, nên buffer chỉ còn pixel của ô mở.
describe('createRestrictedFrameBuilder với tứ giác', () => {
  it('tô đệm đúng các lỗ trên canvas crop, giữa crop.drawImage và lb.fillRect', () => {
    // Tam giác gần tứ giác ô (10,5) tới (18,13): 160 × 160 px, nửa dưới trái là lỗ.
    const quad = buildMask(
      polygonShape([
        { x: 201, y: 101 },
        { x: 359, y: 101 },
        { x: 359, y: 259 },
        { x: 358, y: 259 },
      ]),
      L,
      false,
      3,
    )
    expect(quad.holesCam.length).toBeGreaterThan(0)
    const { builder, log, source } = setup()
    const r = builder.build(source, quad, stamp, 3, 9)
    expect(r.kind).toBe('ok')
    const cr = quad.cameraRect
    const fills = log.filter((l) => l.startsWith('crop.fillRect'))
    expect(fills).toHaveLength(quad.holesCam.length)
    for (const h of quad.holesCam) {
      expect(fills).toContain(
        `crop.fillRect ${h.x - cr.x},${h.y - cr.y},${h.w},${h.h} rgb(128, 128, 128)`,
      )
    }
    const draw = log.findIndex((l) => l.startsWith('crop.drawImage'))
    const lbFill = log.findIndex((l) => l.startsWith('lb.fillRect'))
    const firstFill = log.findIndex((l) => l.startsWith('crop.fillRect'))
    expect(firstFill).toBeGreaterThan(draw)
    expect(firstFill).toBeLessThan(lbFill)
    // Lỗ nằm trong crop.
    for (const h of quad.holesCam) {
      expect(h.x).toBeGreaterThanOrEqual(cr.x)
      expect(h.x + h.w).toBeLessThanOrEqual(cr.x + cr.w)
    }
  })

  it('CLS-01 CropTap: hỏi wants(ts) rồi emit ImageData đúng cỡ crop (trước letterbox) kèm metadata; không hỏi thì không getImageData', () => {
    const got: { w: number; h: number; meta: unknown }[] = []
    let want = false
    const log: string[] = []
    const canvases: StubCanvas[] = []
    const builder = createRestrictedFrameBuilder({
      crops: {
        wants: (ts) => {
          log.push(`wants ${ts}`)
          return want
        },
        emit: (img, meta) => got.push({ w: img.width, h: img.height, meta }),
      },
      createCanvas: (w, h) => {
        const c = new StubCanvas(canvases.length === 0 ? 'crop' : 'lb', w, h, log)
        canvases.push(c)
        return c as unknown as OffscreenCanvas
      },
    })
    const source = {
      width: 1280,
      height: 720,
      drawable: VIDEO,
      lastStamp: null,
      onFrame: () => () => {},
      stop() {},
    } as FrameSource
    builder.build(source, mask, stamp, 3, 1)
    expect(got).toEqual([])
    expect(log.filter((l) => l.includes('getImageData'))).toEqual([])
    want = true
    builder.build(source, mask, { frameId: 43, ts: 1500 }, 3, 2)
    const cr = mask.cameraRect
    expect(got).toEqual([
      {
        w: cr.w,
        h: cr.h,
        meta: {
          epoch: 3,
          frameId: 43,
          ts: 1500,
          taskId: 2,
          roiCam: { x: cr.x, y: cr.y, w: cr.w, h: cr.h },
          box: { w: 8, h: 8 },
          cells: 64,
          holes: 0,
          face: null,
        },
      },
    ])
    // getImageData của crop xảy ra sau drawImage video và trước bước letterbox.
    const i = log.findIndex((l) => l === `crop.getImageData 0,0,${cr.w},${cr.h}`)
    expect(i).toBeGreaterThan(
      log.findIndex((l) => l.startsWith('crop.drawImage video') && log.indexOf(l) > 3),
    )
    expect(log.slice(i + 1).some((l) => l.startsWith('lb.drawImage crop'))).toBe(true)
  })
})

// CLS-05 (D-070, mục 7.42): crop con cho classifier (crop quanh mặt). Rect cắt lại theo cameraRect của mask trước khi
// đọc video, ô lỗ vẫn tô xám (tọa độ theo gốc crop con), dataset mode không nhận crop con, probe nhận kèm sub: true;
// thống kê của buffer cả vùng (builds, lastRoiCam, lastTaskId) không đổi.
describe('createRestrictedFrameBuilder với crop con (CLS-05)', () => {
  it('đọc đúng crop con 1:1 từ video, frame mang roiCam của crop con; thống kê cả vùng giữ nguyên', () => {
    const { builder, log, source } = setup()
    const roi = { x: 240, y: 120, w: 100, h: 100 }
    const r = builder.build(source, mask, stamp, 3, 7, 1, { roi })
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.frames).toHaveLength(1)
    expect(r.frames[0].roiCam).toEqual(roi)
    expect(r.frames[0].taskId).toBe(7)
    expect(r.frames[0].letterbox).toEqual(computeLetterbox(100, 100, 256))
    expect(log).toContain('crop.drawImage video 240,120,100,100,0,0,100,100')
    expect(log.filter((l) => l.startsWith('crop.drawImage'))).toHaveLength(1)
    expect(builder.stats).toMatchObject({
      builds: 0,
      subBuilds: 1,
      bitmaps: 1,
      lastRoiCam: null,
      lastTaskId: -1,
      lastSubRoiCam: roi,
    })
  })

  it('crop con vượt cameraRect được cắt lại (không đọc pixel ngoài hộp bao); quá nhỏ sau khi cắt thì too-small mà không đổi bộ đếm cả vùng', () => {
    const { builder, log, source } = setup()
    const cr = mask.cameraRect
    const r = builder.build(source, mask, stamp, 3, 1, 1, {
      roi: { x: cr.x - 50, y: cr.y - 40, w: 150, h: 160 },
    })
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.frames[0].roiCam).toEqual({ x: cr.x, y: cr.y, w: 100, h: 120 })
    expect(log).toContain(`crop.drawImage video ${cr.x},${cr.y},100,120,0,0,100,120`)
    const tiny = builder.build(source, mask, stamp, 3, 2, 1, {
      roi: { x: cr.x + cr.w - 30, y: cr.y, w: 100, h: 100 },
    })
    expect(tiny).toEqual({ kind: 'too-small', side: 30, minRoiPx: 64 })
    const outside = builder.build(source, mask, stamp, 3, 3, 1, {
      roi: { x: 900, y: 600, w: 100, h: 100 },
    })
    expect(outside.kind).toBe('too-small')
    expect(builder.stats).toMatchObject({ tooSmall: 0, lastKind: null, subBuilds: 1 })
  })

  it('ô lỗ của mask tô xám theo gốc crop con', () => {
    const quad = buildMask(
      polygonShape([
        { x: 201, y: 101 },
        { x: 359, y: 101 },
        { x: 359, y: 259 },
        { x: 358, y: 259 },
      ]),
      L,
      false,
      3,
    )
    const { builder, log, source } = setup()
    const roi = { x: 220, y: 140, w: 120, h: 110 }
    expect(builder.build(source, quad, stamp, 3, 9, 1, { roi }).kind).toBe('ok')
    const fills = log.filter((l) => l.startsWith('crop.fillRect'))
    expect(fills).toHaveLength(quad.holesCam.length)
    for (const h of quad.holesCam)
      expect(fills).toContain(
        `crop.fillRect ${h.x - roi.x},${h.y - roi.y},${h.w},${h.h} rgb(128, 128, 128)`,
      )
  })

  it('dataset mode: crop con không vào CropTap; crop cả vùng mang bbox mặt theo gốc crop (CropMeta.face)', () => {
    const got: { face: unknown }[] = []
    const builder = createRestrictedFrameBuilder({
      crops: { wants: () => true, emit: (_img, meta) => got.push({ face: meta.face }) },
      createCanvas: (w, h) => new StubCanvas('c', w, h, []) as unknown as OffscreenCanvas,
    })
    const { source } = setup()
    const cr = mask.cameraRect
    builder.build(source, mask, stamp, 3, 1, 1, { roi: { x: cr.x, y: cr.y, w: 100, h: 100 } })
    expect(got).toEqual([])
    builder.build(source, mask, stamp, 3, 2, 1, {
      faceCam: { x: cr.x + 30, y: cr.y + 20, w: 50, h: 60 },
    })
    builder.build(source, mask, stamp, 3, 3)
    expect(got).toEqual([{ face: { x: 30, y: 20, w: 50, h: 60 } }, { face: null }])
  })

  it('probe nhận buffer của crop con với sub: true (gate audit của e2e đo cả buffer classifier)', () => {
    const metas: unknown[] = []
    const probes = {
      wantsRestrictedFrame: () => true,
      emitRestrictedFrame: (_img: ImageData, meta: unknown) => metas.push(meta),
    } as unknown as Probes
    const { builder, source } = setup({ probes })
    const roi = { x: 240, y: 120, w: 100, h: 100 }
    builder.build(source, mask, stamp, 3, 4, 1, { roi })
    builder.build(source, mask, stamp, 3, 5)
    expect(metas).toEqual([
      { epoch: 3, frameId: 42, ts: 1000, taskId: 4, roiCam: roi, sub: true },
      { epoch: 3, frameId: 42, ts: 1000, taskId: 5, roiCam: mask.cameraRect },
    ])
  })
})
