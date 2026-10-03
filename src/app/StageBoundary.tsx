import { Component, useEffect, useState, type ReactNode } from 'react'
import { allowChunkReload, isChunkLoadError } from './stageChunk'
import { useStrings } from './useLang'

// PERF-03 (D-063): khung chờ và ranh giới lỗi quanh chunk sân khấu (AppRouter). Khi vào từ trang chào, HashRouter đổi
// route trong startTransition nên trang chào vẫn hiện tới khi chunk sẵn sàng; khung chờ chỉ hiện khi mở thẳng #/app
// lúc chunk chưa có: nền trắng như màn che (không nhấp nháy), dòng "đang tải" chỉ hiện sau 400 ms.

export function StageFallback() {
  const s = useStrings()
  const [late, setLate] = useState(false)
  useEffect(() => {
    const id = window.setTimeout(() => setLate(true), 400)
    return () => window.clearTimeout(id)
  }, [])
  return (
    <div className="stage-boot" aria-busy="true" data-testid="stage-boot">
      {late && (
        <p className="muted" role="status">
          {s.boot.loading}
        </p>
      )}
    </div>
  )
}

function BootFailed() {
  const s = useStrings()
  return (
    <div className="stage-boot" role="alert" data-testid="stage-boot-failed">
      <p>{s.boot.failed}</p>
      <button type="button" className="primary" onClick={() => window.location.reload()}>
        {s.boot.reload}
      </button>
    </div>
  )
}

type State = { failed: boolean }

/** Lỗi nạp chunk (deploy mới đã xóa chunk cũ, mất mạng): tải lại trang một lần (allowChunkReload), không thì báo lỗi
 *  có nút tải lại. Lỗi khác không phải việc của ranh giới này: ném tiếp. */
export class StageErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(err: unknown): State {
    if (!isChunkLoadError(err)) throw err
    return { failed: true }
  }

  componentDidCatch(err: unknown): void {
    if (!isChunkLoadError(err)) return
    let storage: Storage | null
    try {
      storage = window.sessionStorage
    } catch {
      storage = null
    }
    if (storage && allowChunkReload(Date.now(), storage)) window.location.reload()
  }

  render(): ReactNode {
    return this.state.failed ? <BootFailed /> : this.props.children
  }
}
