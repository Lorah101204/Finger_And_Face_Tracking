// CLS-02: window.__wct.classifier cho e2e (chỉ đọc, I9) và dòng mô tả cho panel debug.
import type { ClassifierClient, ClassifierSnapshot } from '../classify/classifierClient'
import { wct } from './wctGlobal'

export function installClassifierProbe(client: ClassifierClient): () => void {
  const g = wct()
  const probe = { snapshot: () => client.snapshot() }
  g.classifier = probe
  return () => {
    if (g.classifier === probe) delete g.classifier
  }
}

/** Dòng debug: trạng thái worker, EP, số tác vụ, probs gần nhất, p50/p95, nhịp. */
export function describeClassifier(s: ClassifierSnapshot): string {
  const st = s.stats
  const state = s.failed
    ? `lỗi: ${s.lastError ?? '?'}`
    : s.ready
      ? `sẵn sàng (${s.ep}, init ${Math.round(st.initMs)} ms)`
      : s.started
        ? 'đang nạp model…'
        : 'chưa chạy'
  const probs = st.lastProbs.length ? st.lastProbs.map((p) => p.toFixed(2)).join('/') : '-'
  return (
    `phân loại: ${state} · gửi ${st.submitted} · kết quả ${st.results} · loại ${st.discarded} · lỗi ${st.errors}` +
    ` · probs ${probs} · infer p50 ${st.p50InferMs.toFixed(1)} / p95 ${st.p95InferMs.toFixed(1)} ms` +
    ` · nhịp ${Math.round(s.minIntervalMs)} ms`
  )
}
