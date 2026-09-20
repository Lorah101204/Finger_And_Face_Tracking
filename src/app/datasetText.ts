// CLS-01: chữ hiển thị cho nhãn, điều kiện và dòng trạng thái của dataset mode (tách khỏi component để unit test và
// Fast Refresh). I18N-01: chữ nhãn, ánh sáng, hình nộm nằm trong từ điển (`settings.dataset`), dòng trạng thái theo
// ngôn ngữ.
import { DEFAULT_LANG, t, type Lang } from '../core/i18n'
import type { RecorderSnapshot } from '../dataset/recorder'

export function describeRecorder(s: RecorderSnapshot, lang: Lang = DEFAULT_LANG): string {
  const d = t(lang).settings.dataset.status
  if (!s.enabled) return d.off
  const where = s.sink
    ? d.folder(s.sink)
    : d.memory(s.inMemory, Number((s.bytes / 1024).toFixed(0)))
  const state = s.recording ? d.recording(s.count) : s.session ? d.stopped(s.count) : d.idle
  return `${state} · ${s.rateHz} Hz · ${where}${s.error ? d.error(s.error) : ''}`
}
