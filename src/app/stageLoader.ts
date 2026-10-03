// PERF-03 (D-063): bộ nạp chunk sân khấu (một import() động duy nhất tới StagePage trong src/, unit test kiểm).
import { createChunkLoader, prefetch } from './stageChunk'

export const loadStage = createChunkLoader(() => import('./pages/StagePage'))

/** Nạp trước chunk sân khấu (ý định của người dùng, lúc rảnh); lỗi im lặng. */
export function prefetchStage(): void {
  prefetch(loadStage)
}
