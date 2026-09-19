// CLS-01: window.__wct.dataset cho e2e đọc trạng thái recorder, metadata và mẫu trong bộ nhớ (chỉ đọc, không gửi đi đâu, I9).
import type { Recorder } from '../dataset/recorder'
import { wct } from './wctGlobal'

export function installDatasetProbe(recorder: Recorder): () => void {
  const g = wct()
  const probe = {
    snapshot: () => recorder.snapshot(),
    metas: () => recorder.metas(),
    samples: () => recorder.samples(),
    sessions: () => recorder.sessions(),
    zip: () => recorder.zip(),
  }
  g.dataset = probe
  return () => {
    if (g.dataset === probe) delete g.dataset
  }
}
