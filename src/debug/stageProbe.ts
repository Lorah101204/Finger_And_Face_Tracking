// GRID-01: đọc layout, cài đặt lưới và epoch qua window.__wct.stage (bước 5: debug hiện c, board, scale, epoch).
import type { StageStore } from '../loop/store'
import { wct } from './wctGlobal'

export function installStageProbe(store: StageStore): () => void {
  const g = wct()
  const entry = { snapshot: store.getSnapshot }
  g.stage = entry
  return () => {
    if (g.stage === entry) delete g.stage
  }
}
