// GRID-01: store ngoài React cho sân khấu (lưới, mirror, kích thước stage và camera, layout, epoch), đọc bằng
// useSyncExternalStore. PERF-01 và UX-01 mở rộng (throttle, FrameOutput). Không đụng DOM: unit test được trong Node.
import { DEFAULTS } from '../core/config'
import { computeLayout, type Layout } from '../core/coords'
import type { EpochCounter } from '../core/epoch'
import { clampGrid } from '../core/grid'
import type { FingerTip, Size } from '../core/types'
import {
  clampSensitivity,
  defaultSensitivity,
  sameSensitivity,
  type Sensitivity,
} from '../reveal/sensitivity'
import type { WindowSourceKind } from '../reveal/windowSource'

export type StageSettings = {
  cols: number
  rows: number
  showLines: boolean
  mirror: boolean
  /** ROI-00: nguồn cửa sổ; `hands` từ HAND-01 (chạy hand pipeline). INT-01: đổi nguồn là đổi cấu hình, epoch++. */
  windowSource: WindowSourceKind
  /** HAND-01 (D-010): đảo nhãn trái/phải nếu webcam thật cho nhãn ngược; đổi thì tracker tay reset (id mới). */
  handednessSwap: boolean
  /** ROI-03 (D-047, thay bốn slot của HAND-02): đầu ngón dùng cho mọi tay, đã sắp và bỏ trùng, không rỗng; đổi thì epoch++ và cửa sổ đang mở đóng với config-changed (UC-03). */
  fingers: FingerTip[]
  /** ROI-01 (UC-09): độ nhạy (One Euro, hysteresis, nMin, tuổi điểm); áp dụng ngay, không đổi epoch. */
  sensitivity: Sensitivity
}

export type StageState = {
  settings: StageSettings
  stageSize: Size
  /** null khi camera chưa active: layout dùng kích thước camera mặc định để lưới hiện trước khi có camera (D-026). */
  camSize: Size | null
  layout: Layout
  epoch: number
}

export type StageStore = {
  getSnapshot(): StageState
  subscribe(fn: () => void): () => void
  /**
   * Đổi cols, rows, mirror (tính lại layout), slot hay nguồn cửa sổ: epoch++ và cửa sổ đang mở phải đóng với
   * config-changed; showLines, đảo tay, độ nhạy không đổi epoch.
   */
  setSettings(patch: Partial<StageSettings>): void
  /** Kích thước canvas theo px thiết bị (sau DPR); đổi thì layout tính lại và epoch++. */
  setStageSize(size: Size): void
  /** Kích thước camera đang active hoặc null; đổi thì layout tính lại và epoch++. Luôn phát lại snapshot. */
  setCamSize(size: Size | null): void
}

const PLACEHOLDER_CAM: Size = { w: DEFAULTS.camera.width, h: DEFAULTS.camera.height }

export function createStageStore(
  epoch: EpochCounter,
  initial: Partial<StageSettings> = {},
): StageStore {
  let settings: StageSettings = {
    cols: DEFAULTS.grid.cols,
    rows: DEFAULTS.grid.rows,
    showLines: DEFAULTS.grid.showLines,
    mirror: DEFAULTS.grid.mirror,
    windowSource: 'mouse',
    handednessSwap: DEFAULTS.hands.handednessSwap,
    fingers: [...DEFAULTS.hands.fingers],
    sensitivity: defaultSensitivity(),
    ...initial,
  }
  let stageSize: Size = { w: 0, h: 0 }
  let camSize: Size | null = null
  let layout = relayout()
  let snapshot = build()
  const listeners = new Set<() => void>()

  function relayout(): Layout {
    return computeLayout(stageSize, settings, camSize ?? PLACEHOLDER_CAM)
  }

  function build(): StageState {
    return { settings, stageSize, camSize, layout, epoch: epoch.current }
  }

  function emit(): void {
    snapshot = build()
    for (const l of listeners) l()
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(fn) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    setSettings(patch) {
      const next: StageSettings = { ...settings, ...patch }
      const grid = clampGrid(next)
      next.cols = grid.cols
      next.rows = grid.rows
      const geometry =
        next.cols !== settings.cols ||
        next.rows !== settings.rows ||
        next.mirror !== settings.mirror
      next.fingers = normalizeFingers(next.fingers)
      const fingersChanged = !sameFingers(next.fingers, settings.fingers)
      if (!fingersChanged) next.fingers = settings.fingers
      const sens = clampSensitivity(next.sensitivity)
      const sensChanged = !sameSensitivity(sens, settings.sensitivity)
      next.sensitivity = sensChanged ? sens : settings.sensitivity
      const changed =
        geometry ||
        fingersChanged ||
        sensChanged ||
        next.showLines !== settings.showLines ||
        next.windowSource !== settings.windowSource ||
        next.handednessSwap !== settings.handednessSwap
      if (!changed) return
      const sourceChanged = next.windowSource !== settings.windowSource
      settings = next
      if (geometry) {
        epoch.bump()
        layout = relayout()
      } else if (fingersChanged || sourceChanged) {
        epoch.bump()
      }
      emit()
    },
    setStageSize(size) {
      if (size.w === stageSize.w && size.h === stageSize.h) return
      stageSize = { w: Math.max(0, Math.floor(size.w)), h: Math.max(0, Math.floor(size.h)) }
      epoch.bump()
      layout = relayout()
      emit()
    },
    setCamSize(size) {
      const same =
        size === camSize ||
        (size !== null && camSize !== null && size.w === camSize.w && size.h === camSize.h)
      if (!same) {
        camSize = size ? { w: size.w, h: size.h } : null
        epoch.bump()
        layout = relayout()
      }
      emit()
    },
  }
}

const TIPS: readonly FingerTip[] = [4, 8, 12, 16, 20]

/** Chỉ giữ chỉ số đầu ngón hợp lệ, bỏ trùng, sắp tăng; rỗng thì về mặc định. */
export function normalizeFingers(list: readonly number[]): FingerTip[] {
  const out = TIPS.filter((t) => list.includes(t))
  return out.length ? out : [...DEFAULTS.hands.fingers]
}

function sameFingers(a: readonly FingerTip[], b: readonly FingerTip[]): boolean {
  return a.length === b.length && a.every((t, i) => t === b[i])
}
