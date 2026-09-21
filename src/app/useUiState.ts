import { useCallback, useState } from 'react'
import { readUiState, sessionStore, writeUiState, type UiState } from './uiState'

// UX-01: hook giữ UiState trong React và ghi sessionStorage mỗi lần đổi (uiState.ts thuần làm phần đọc, ghi).
// BRAND-01: `overrides` (tham số URL) đè lên giá trị đã lưu ngay lúc đọc và được ghi lại.
export function useUiState(
  defaults: UiState,
  overrides?: Partial<UiState>,
): [UiState, (patch: Partial<UiState>) => void] {
  const [state, setState] = useState(() => {
    const read = readUiState(sessionStore(), defaults)
    if (!overrides) return read
    const next = { ...read, ...overrides }
    writeUiState(sessionStore(), next)
    return next
  })
  const update = useCallback((patch: Partial<UiState>) => {
    setState((prev) => {
      const next = { ...prev, ...patch }
      writeUiState(sessionStore(), next)
      return next
    })
  }, [])
  return [state, update]
}
