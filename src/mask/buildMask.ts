// MASK-01 bước 1, làm sớm ở ROI-00: hàm duy nhất tạo RevealMask (bất biến I2). ROI-02 (D-038): mask là tập ô. Chuột:
// hộp n × n đầy. Tay (ROI-03, D-047): đa giác bao lồi các đầu ngón (px stage) → rasterizePolygon (core/cells.ts) với
// hysteresis theo ô so với mask của frame trước cùng phiên mở. stageRect và cameraRect là rect nguyên của hộp bao (coords.ts, cameraRect đã
// clip trong camera, kích thước camera nằm trong layout, D-026); holesCam là rect camera của từng ô trong hộp mà
// không mở, để buffer suy luận tô đệm (I1).
import { boxCells, convexHull, isFullBox, rasterizePolygon, type CellSet } from '../core/cells'
import { boxToCameraRect, boxToStageRect, type Layout } from '../core/coords'
import type { Rect, RevealMask, RevealShape, RevealWindow } from '../core/types'

export type BuildMaskOptions = {
  /** cửa sổ chuột bị kẹp ở mép bảng */
  limited?: boolean
  /** mask frame trước cùng phiên mở (hysteresis ô cho đa giác); bỏ qua nếu không phải đa giác */
  prev?: RevealMask | null
  /** biên hysteresis theo ô (mặc định 0) */
  hysteresisCells?: number
}

export function windowShape(window: RevealWindow): RevealShape {
  return { kind: 'window', window: { col: window.col, row: window.row, n: window.n } }
}

export function polygonShape(polygonStage: readonly { x: number; y: number }[]): RevealShape {
  return { kind: 'polygon', polygonStage: polygonStage.map((p) => ({ x: p.x, y: p.y })) }
}

export function buildMask(
  shape: RevealShape,
  layout: Layout,
  mirror: boolean,
  epoch: number,
  opts: BuildMaskOptions = {},
): RevealMask {
  let set: CellSet
  let out: RevealShape
  if (shape.kind === 'window') {
    const w = shape.window
    set = boxCells({ col: w.col, row: w.row, w: w.n, h: w.n })
    out = windowShape(w)
  } else {
    // Bao lồi bất biến với đa giác lồi đã sắp; điểm đưa vào lộn xộn cũng thành đa giác đơn.
    const poly = convexHull(shape.polygonStage)
    const prev = opts.prev && opts.prev.shape.kind === 'polygon' ? opts.prev : null
    set = rasterizePolygon(poly, layout, {
      prev: prev ? { box: prev.box, cells: prev.cells, cellCount: prev.cellCount } : null,
      hysteresisCells: opts.hysteresisCells ?? 0,
    })
    out = { kind: 'polygon', polygonStage: poly }
  }
  const holesCam: Rect[] = []
  if (!isFullBox(set) && set.cellCount > 0) {
    const { box, cells } = set
    for (let j = 0; j < box.h; j++)
      for (let i = 0; i < box.w; i++) {
        if (cells[j * box.w + i] === 1) continue
        const r = boxToCameraRect(
          { col: box.col + i, row: box.row + j, w: 1, h: 1 },
          layout,
          mirror,
        )
        if (r.w > 0 && r.h > 0) holesCam.push(r)
      }
  }
  return {
    epoch,
    shape: out,
    box: { ...set.box },
    cells: set.cells,
    cellCount: set.cellCount,
    stageRect: boxToStageRect(set.box, layout),
    cameraRect: boxToCameraRect(set.box, layout, mirror),
    holesCam,
    limited: opts.limited ?? false,
  }
}
