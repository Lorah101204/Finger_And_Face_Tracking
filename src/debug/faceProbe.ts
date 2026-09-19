// FACE-01 bước 5: đọc trạng thái FaceClient qua window.__wct.face (ready, delegate, submitted, dropped, inferMs) cho
// e2e và thanh debug. Chỉ đọc trong trang, không gửi đi đâu (I9).
import type { FaceClient, FaceSnapshot } from '../face/faceClient'
import { wct } from './wctGlobal'

export function installFaceProbe(face: FaceClient): () => void {
  const g = wct()
  const entry = { snapshot: () => face.snapshot() }
  g.face = entry
  return () => {
    if (g.face === entry) delete g.face
  }
}

/** Dòng cho thanh debug (chuỗi để useSyncExternalStore so sánh theo giá trị). */
export function describeFace(s: FaceSnapshot): string {
  const st = s.stats
  const state = s.failed
    ? `lỗi: ${s.lastError ?? '?'}`
    : s.ready
      ? `sẵn sàng (${s.delegate}, init ${Math.round(st.initMs)} ms)`
      : 'đang nạp model…'
  return (
    `mặt: ${state} · gửi ${st.submitted} · rớt ${st.dropped} · kết quả ${st.results}` +
    ` (${st.lastFaces} mặt) · loại ${st.discarded} · infer ${st.lastInferMs.toFixed(1)} ms,` +
    ` p50 ${st.p50InferMs.toFixed(1)} ms · nhịp ${Math.round(s.minIntervalMs)} ms`
  )
}
