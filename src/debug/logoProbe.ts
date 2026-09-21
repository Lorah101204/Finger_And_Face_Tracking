// BRAND-01: window.__wct.logo cho e2e (chỉ đọc, I9): công tắc, đang vẽ hay không, lớp chữ sẵn sàng, rect và tập ô
// logo theo layout hiện tại; và dòng logo-stat của panel debug (tiếng Việt, hợp đồng e2e như các dòng khác).
import type { Layout } from '../core/coords'
import type { CellBox, Rect } from '../core/types'
import type { FrameLoop } from '../loop/frameLoop'
import type { StageStore } from '../loop/store'
import type { LogoLayer } from '../mask/logoLayer'
import { wct } from './wctGlobal'

export type LogoSnapshot = {
  enabled: boolean
  visible: boolean
  ready: boolean
  wordmark: boolean
  rect: Rect | null
  box: CellBox | null
  cellCount: number
}

export function readLogo(layer: LogoLayer, layout: Layout, visible: boolean): LogoSnapshot {
  const g = layer.geometry(layout)
  return {
    enabled: layer.enabled,
    visible,
    ready: layer.ready,
    wordmark: layer.wordmark,
    rect: g ? { ...g.rect } : null,
    box: g ? { ...g.cells.box } : null,
    cellCount: g?.cells.cellCount ?? 0,
  }
}

export function installLogoProbe(layer: LogoLayer, store: StageStore, loop: FrameLoop): () => void {
  const g = wct()
  const entry = {
    snapshot: () => readLogo(layer, store.getSnapshot().layout, loop.snapshot().logoVisible),
  }
  g.logo = entry
  return () => {
    if (g.logo === entry) delete g.logo
  }
}

export function describeLogo(s: LogoSnapshot): string {
  if (!s.enabled) return 'logo: tắt'
  if (!s.rect || !s.box) return 'logo: không có ô (bảng rỗng)'
  const state = s.visible ? 'hiện' : 'ẩn (vùng mở)'
  const text = s.wordmark ? (s.ready ? 'chữ sẵn sàng' : 'chữ đang nạp') : 'chỉ khối'
  return (
    `logo: ${state} · ${s.cellCount} ô trong ${s.box.w}×${s.box.h} từ (${s.box.col}, ${s.box.row}) · ` +
    `${s.rect.w}×${s.rect.h} px tại (${s.rect.x}, ${s.rect.y}) · ${text}`
  )
}
