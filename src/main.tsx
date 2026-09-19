import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router'
import { AppRouter } from './app/AppRouter'
import './app/app.css'
import { installSameOriginGuard } from './core/networkGuard'
import { registerServiceWorker } from './app/registerSw'

// WEB-00: định tuyến client bằng HashRouter (D-020) để dist/ chạy trên mọi host tĩnh. Canvas trắng nằm ở #/app
// (bất biến I4). Không có backend, không telemetry (D-019). REL-01 (D-050): fetch của trang chỉ cho cùng origin (I9)
// và service worker cache model, wasm, asset (chỉ bản build; scope là base của trang).
installSameOriginGuard(window)
void registerServiceWorker()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <AppRouter />
    </HashRouter>
  </StrictMode>,
)
