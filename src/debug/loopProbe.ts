// ROI-00: đọc trạng thái vòng lặp (RevealState, mask, số frame, epoch) qua window.__wct.loop cho e2e và debug.
// FACE-02: kèm events (EventTarget phát 'frame' với FrameOutput). PERF-04 (D-064): invalidate và setPaintAlways để
// e2e và tools/measure-loop.mjs đo A/B việc chỉ vẽ khi hình đổi trong cùng trang.
import type { FrameLoop } from '../loop/frameLoop'
import { wct } from './wctGlobal'

export function installLoopProbe(loop: FrameLoop): () => void {
  const g = wct()
  const entry = {
    snapshot: loop.snapshot,
    events: loop.events,
    invalidate: loop.invalidate,
    setPaintAlways: loop.setPaintAlways,
  }
  g.loop = entry
  return () => {
    if (g.loop === entry) delete g.loop
  }
}
