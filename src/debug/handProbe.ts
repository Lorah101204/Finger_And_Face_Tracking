// HAND-01 bước 5: đọc trạng thái hand pipeline qua window.__wct.hands (worker, số frame gửi, HandFrame mới nhất với
// id và handedness) cho e2e và thanh debug. ROI-01: window.__wct.handWindow đọc HandWindowSource (solver). Chỉ đọc
// trong trang, không gửi đi đâu (I9).
import type { HandPipeline, HandPipelineSnapshot } from '../hands/handPipeline'
import type { HandWindowSource } from '../reveal/handWindowSource'
import { wct } from './wctGlobal'

export function installHandProbe(hands: HandPipeline): () => void {
  const g = wct()
  const entry = { snapshot: () => hands.snapshot() }
  g.hands = entry
  return () => {
    if (g.hands === entry) delete g.hands
  }
}

export function installHandWindowProbe(source: HandWindowSource): () => void {
  const g = wct()
  const entry = { snapshot: () => source.snapshot() }
  g.handWindow = entry
  return () => {
    if (g.handWindow === entry) delete g.handWindow
  }
}

/** Dòng cho thanh debug (chuỗi để useSyncExternalStore so sánh theo giá trị). */
export function describeHands(s: HandPipelineSnapshot, active: boolean): string {
  const c = s.client
  const st = c.stats
  if (!active) return 'tay: tắt (chọn nguồn cửa sổ "Tay" để chạy)'
  if (s.fake) {
    const hands = s.latest
      ? s.latest.hands
          .map((h) => `${h.handedness === 'left' ? 'Trái' : 'Phải'} #${h.id}`)
          .join(', ') || 'không thấy tay'
      : 'chưa có kết quả'
    return `tay: giả lập (kịch bản) · ${hands}${s.latest?.uncertain ? ' · không chắc' : ''}`
  }
  const state = c.failed
    ? `lỗi: ${c.lastError ?? '?'}`
    : c.ready
      ? `sẵn sàng (${c.delegate}, init ${Math.round(st.initMs)} ms)`
      : c.started
        ? 'đang nạp model…'
        : 'chưa chạy'
  const hands = s.latest
    ? s.latest.hands
        .map((h) => `${h.handedness === 'left' ? 'Trái' : 'Phải'} #${h.id} (${h.score.toFixed(2)})`)
        .join(', ') || 'không thấy tay'
    : 'chưa có kết quả'
  const unc = s.latest?.uncertain ? ' · không chắc' : ''
  return (
    `tay: ${state} · gửi ${st.submitted} · kết quả ${st.results} · infer ${st.lastInferMs.toFixed(1)} ms,` +
    ` p50 ${st.p50InferMs.toFixed(1)} ms · ${hands}${unc} · uncertain ${s.tracker.uncertainFrames}` +
    (s.swap ? ' · đảo trái/phải' : '')
  )
}
