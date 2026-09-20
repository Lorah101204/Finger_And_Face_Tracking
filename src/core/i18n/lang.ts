// I18N-01: ngôn ngữ giao diện. Hai ngôn ngữ, mặc định tiếng Việt; tiếng Anh là tùy chọn của người dùng (nút trên trang
// chào, mục Giao diện của cột cài đặt, hoặc `?lang=en` trên URL). Lựa chọn lưu trong localStorage `wct.lang` (theo
// máy, như công tắc nhật ký) vì kiosk cần giữ ngôn ngữ qua tab và lần tải lại. Phần này thuần (không DOM): kho ngoài
// React với subscribe để `useLang()` đọc qua useSyncExternalStore; đọc từ storage và query tiêm vào để unit test.
export type Lang = 'vi' | 'en'

export const LANGS: readonly Lang[] = ['vi', 'en']
export const DEFAULT_LANG: Lang = 'vi'
export const LANG_KEY = 'wct.lang'

export function isLang(v: unknown): v is Lang {
  return v === 'vi' || v === 'en'
}

export type LangStorageLike = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/**
 * Ngôn ngữ lúc khởi động: `?lang=` trên URL (query của hash route hoặc của trang) đi trước, rồi giá trị đã lưu, rồi
 * mặc định. Giá trị lạ hay storage bị chặn thì bỏ qua.
 */
export function readLang(
  storage: LangStorageLike | null,
  query: string | null,
  fallback: Lang = DEFAULT_LANG,
): Lang {
  if (query) {
    try {
      const q = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query).get('lang')
      if (isLang(q)) return q
    } catch {
      // query hỏng: bỏ qua
    }
  }
  if (storage) {
    try {
      const v = storage.getItem(LANG_KEY)
      if (isLang(v)) return v
    } catch {
      // storage bị chặn (chế độ riêng tư)
    }
  }
  return fallback
}

export function writeLang(storage: LangStorageLike | null, lang: Lang): void {
  if (!storage) return
  try {
    storage.setItem(LANG_KEY, lang)
  } catch {
    // chỉ giữ trong bộ nhớ
  }
}

export type LangStore = {
  get(): Lang
  set(lang: Lang): void
  subscribe(cb: () => void): () => void
}

export function createLangStore(initial: Lang = DEFAULT_LANG): LangStore {
  let current = initial
  const listeners = new Set<() => void>()
  return {
    get: () => current,
    set(lang) {
      if (lang === current) return
      current = lang
      for (const l of listeners) l()
    },
    subscribe(cb) {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
  }
}

/** Kho dùng chung của app (main.tsx đặt giá trị lúc khởi động); các hàm vẽ nhãn lên canvas đọc từ đây. */
export const langStore: LangStore = createLangStore()
