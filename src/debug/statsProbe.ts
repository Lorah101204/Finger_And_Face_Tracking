// PERF-01: đọc sampler hiệu năng qua window.__wct.stats cho e2e và soak (tách khỏi stats.ts để stats.ts thuần, unit
// test trong Node không kéo khai báo global của wctGlobal). Chỉ đọc trong trang, không gửi đi đâu (I9).
import type { Stats } from './stats'
import { wct } from './wctGlobal'

export function installStatsProbe(stats: Stats): () => void {
  const g = wct()
  const entry = { snapshot: () => stats.snapshot() }
  g.stats = entry
  return () => {
    if (g.stats === entry) delete g.stats
  }
}
