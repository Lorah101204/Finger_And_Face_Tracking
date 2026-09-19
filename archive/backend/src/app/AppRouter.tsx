import { Navigate, Route, Routes } from 'react-router'
import { AdminPage } from './pages/AdminPage'
import { LandingPage } from './pages/LandingPage'
import { StagePage } from './pages/StagePage'

// WEB-00: "/" trang chào và đồng ý, "/app" sân khấu (chỉ sau khi đồng ý), "/admin" nhật ký.
export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/app" element={<StagePage />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
