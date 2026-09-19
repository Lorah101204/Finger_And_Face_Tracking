// ROI-00: đọc trạng thái vòng lặp (RevealState, mask, số frame, epoch) qua window.__wct.loop cho e2e và debug.
// FACE-02: kèm events (EventTarget phát 'frame' với FrameOutput).
import type { FrameLoop } from '../loop/frameLoop'
import { wct } from './wctGlobal'

export function installLoopProbe(loop: FrameLoop): () => void {
  const g = wct()
  const entry = { snapshot: loop.snapshot, events: loop.events }
  g.loop = entry
  return () => {
    if (g.loop === entry) delete g.loop
  }
}
