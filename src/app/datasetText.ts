// CLS-01: chữ hiển thị cho nhãn, điều kiện và dòng trạng thái của dataset mode (tách khỏi component để unit test và
// Fast Refresh).
import type { DatasetLabel, Lighting, MannequinType, RecorderSnapshot } from '../dataset/recorder'

export const LABEL_TEXT: Record<DatasetLabel, string> = {
  person: 'Người',
  mannequin: 'Hình nộm',
  unknown: 'Chưa rõ',
  background: 'Chỉ nền hoặc chỉ tay',
}
export const LIGHTING_TEXT: Record<Lighting, string> = {
  normal: 'Bình thường',
  bright: 'Mạnh',
  dim: 'Yếu',
  backlit: 'Ngược sáng',
}
export const MANNEQUIN_TEXT: Record<MannequinType, string> = {
  none: 'Không',
  plastic: 'Nhựa',
  fabric: 'Vải',
  silicone: 'Silicone',
}

export function describeRecorder(s: RecorderSnapshot): string {
  if (!s.enabled) return 'dataset mode tắt'
  const where = s.sink
    ? `thư mục ${s.sink}`
    : `bộ nhớ (${s.inMemory} mẫu, ${(s.bytes / 1024).toFixed(0)} KB)`
  const state = s.recording
    ? `đang thu ${s.count} mẫu`
    : s.session
      ? `đã dừng, ${s.count} mẫu`
      : 'chưa thu'
  return `${state} · ${s.rateHz} Hz · ${where}${s.error ? ` · lỗi: ${s.error}` : ''}`
}
