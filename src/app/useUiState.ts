import { useCallback, useState } from 'react'
import { readUiState, sessionStore, writeUiState, type UiState } from './uiState'

// UX-01: hook giữ UiState trong React và ghi sessionStorage mỗi lần đổi (uiState.ts thuần làm phần đọc, ghi).
export function useUiState(defaults: UiState): [UiState, (patch: Partial<UiState>) => void] {
  const [state, setState] = useState(() => readUiState(sessionStore(), defaults))
  const update = useCallback((patch: Partial<UiState>) => {
    setState((prev) => {
      const next = { ...prev, ...patch }
      writeUiState(sessionStore(), next)
      return next
    })
  }, [])
  return [state, update]
}
