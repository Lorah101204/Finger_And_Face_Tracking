import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { AppRouter } from './app/AppRouter'
import { installTelemetry } from './app/telemetry'
import './app/app.css'

// WEB-00: định tuyến client; LOG-01: gắn telemetry một lần. Canvas trắng nằm ở /app (bất biến I4).
installTelemetry()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AppRouter />
    </BrowserRouter>
  </StrictMode>,
)
