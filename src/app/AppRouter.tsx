import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useSearchParams } from 'react-router'
import { LandingPage } from './pages/LandingPage'
import { useConsent } from './session'
import { StageErrorBoundary, StageFallback } from './StageBoundary'
import { loadStage } from './stageLoader'

// PERF-03 (D-063): sân khấu là chunk riêng (stageChunk.ts). Một Suspense bọc Routes: HashRouter đổi route trong
// startTransition nên trang chào giữ nguyên tới khi chunk sẵn sàng (không nhấp nháy khung chờ); khung chờ chỉ hiện khi
// mở thẳng #/app. Chưa đồng ý thì về "/" ngay mà không tải chunk (StagePage vẫn giữ lệnh chuyển hướng của nó).
const StagePage = lazy(() => loadStage().then((m) => ({ default: m.StagePage })))

function StageRoute() {
  const consented = useConsent()
  const [searchParams] = useSearchParams()
  // Link kiosk `#/app?mode=present` khi chưa đồng ý về màn hình bắt đầu kiosk (`#/?mode=present`), không về trang thường.
  const landing = searchParams.get('mode') === 'present' ? '/?mode=present' : '/'
  return consented ? (
    <StageErrorBoundary>
      <StagePage />
    </StageErrorBoundary>
  ) : (
    <Navigate to={landing} replace />
  )
}

// WEB-00: "/" trang chào và đồng ý, "/app" sân khấu (chỉ sau khi đồng ý). Đường dẫn khác về "/".
export function AppRouter() {
  return (
    <Suspense fallback={<StageFallback />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/app" element={<StageRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
