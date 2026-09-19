/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// SETUP-00. HTTPS chỉ khi VITE_HTTPS=1 (thử trên LAN); localhost đã là secure context cho getUserMedia.
const useHttps = process.env.VITE_HTTPS === '1'

// WEB-00: /api chuyển tiếp sang backend (server/), mặc định cổng 3000; e2e đặt VITE_API_TARGET sang cổng riêng.
const apiTarget = process.env.VITE_API_TARGET ?? 'http://127.0.0.1:3000'

export default defineConfig({
  plugins: [react(), ...(useHttps ? [basicSsl()] : [])],
  server: {
    port: 5173,
    proxy: { '/api': { target: apiTarget, changeOrigin: false } },
  },
  worker: { format: 'es' },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
})
