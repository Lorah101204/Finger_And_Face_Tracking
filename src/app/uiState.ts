// UX-01: trạng thái giao diện của sân khấu (panel cài đặt và panel debug đang mở hay đóng) lưu trong sessionStorage
// của tab (khóa wct.ui): giữ qua lần tải lại trong cùng tab, không lan sang tab khác (kiosk, D-021). Thuần để unit
// test trong Node: storage tiêm vào, giá trị hỏng hay storage bị chặn thì dùng mặc định. UX-03 (D-049) thêm `present`:
// chế độ trình diễn (mọi panel là lớp nổi tự ẩn), mặc định theo tham số URL `mode=present`, giá trị đã lưu được ưu tiên.
export type UiState = {
  settingsOpen: boolean
  debugOpen: boolean
  present: boolean
}

export const UI_KEY = 'wct.ui'

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export function readUiState(storage: StorageLike | null, defaults: UiState): UiState {
  if (!storage) return { ...defaults }
  try {
    const raw = storage.getItem(UI_KEY)
    if (!raw) return { ...defaults }
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return { ...defaults }
    const p = parsed as Record<string, unknown>
    return {
      settingsOpen: typeof p.settingsOpen === 'boolean' ? p.settingsOpen : defaults.settingsOpen,
      debugOpen: typeof p.debugOpen === 'boolean' ? p.debugOpen : defaults.debugOpen,
      present: typeof p.present === 'boolean' ? p.present : defaults.present,
    }
  } catch {
    return { ...defaults }
  }
}

export function writeUiState(storage: StorageLike | null, state: UiState): void {
  if (!storage) return
  try {
    storage.setItem(UI_KEY, JSON.stringify(state))
  } catch {
    // Storage bị chặn (chế độ riêng tư): chỉ giữ trong bộ nhớ.
  }
}

/** sessionStorage của tab, hoặc null khi không truy cập được. */
export function sessionStore(): StorageLike | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}
