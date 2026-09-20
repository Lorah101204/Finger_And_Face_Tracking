// I18N-01: điểm vào của chuỗi giao diện: `t(lang)` trả từ điển đã chọn (đối tượng tĩnh, không cấp phát), `Strings`
// là kiểu suy từ bản tiếng Việt. Nằm trong core/ để mọi lớp (classify/, hands/, mask/ vẽ nhãn lên canvas) dùng được
// theo lint:boundaries.
import { en } from './en'
import { langStore, type Lang } from './lang'
import { vi } from './vi'

export type Strings = typeof vi

export {
  DEFAULT_LANG,
  LANGS,
  LANG_KEY,
  createLangStore,
  isLang,
  langStore,
  readLang,
  writeLang,
} from './lang'
export type { Lang, LangStore, LangStorageLike } from './lang'

const DICTS: Record<Lang, Strings> = { vi, en }

export function t(lang: Lang = langStore.get()): Strings {
  return DICTS[lang]
}
