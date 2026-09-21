// BRAND-01: window.__wct.logo cho e2e (chỉ đọc, I9): công tắc, đang vẽ hay không, ảnh sẵn sàng, rect logo, rect ba
// khung, có khớp ô không và cỡ module (D-058) theo layout hiện tại; và dòng logo-stat của panel debug (tiếng Việt, hợp
// đồng e2e như các dòng khác).
import type { Layout } from '../core/coords'
import type { Rect } from '../core/types'
import type { FrameLoop } from '../loop/frameLoop'
import type { StageStore } from '../loop/store'
import type { LogoLayer } from '../mask/logoLayer'
import { wct } from './wctGlobal'

export type LogoSnapshot = {
  enabled: boolean
  visible: boolean
  ready: boolean
  rect: Rect | null
  /** Ba khung "VERIFY:", "Human", "AI ETHIC CAMPAIGN" trong px stage; rỗng khi không có rect. */
  frames: Rect[]
  /** D-058: viền khung nằm trên vạch ô (module = k × c px); false khi lưới quá thô và logo giữ cỡ cố định. */
  snapped: boolean
  module: number
}

export function readLogo(layer: LogoLayer, layout: Layout, visible: boolean): LogoSnapshot {
  const g = layer.geometry(layout)
  return {
    enabled: layer.enabled,
    visible,
    ready: layer.ready,
    rect: g ? { ...g.rect } : null,
    frames: g ? g.frames.map((f) => ({ ...f })) : [],
    snapped: g?.snapped ?? false,
    module: g?.module ?? 0,
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
  if (!s.rect) return 'logo: không có chỗ (bảng rỗng)'
  const img = s.ready ? 'ảnh sẵn sàng' : 'ảnh đang nạp'
  const snap = s.snapped ? `khớp ô (module ${s.module} px)` : 'không khớp ô (lưới thô)'
  return `logo: ${s.visible ? 'hiện' : 'ẩn'} · ${s.rect.w}×${s.rect.h} px tại (${s.rect.x}, ${s.rect.y}) · ${snap} · ${img}`
}
