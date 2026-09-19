import { Navigate, Route, Routes } from 'react-router'
import { LandingPage } from './pages/LandingPage'
import { StagePage } from './pages/StagePage'

// WEB-00: "/" trang chào và đồng ý, "/app" sân khấu (chỉ sau khi đồng ý). Đường dẫn khác về "/".
export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/app" element={<StagePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
