// GRID-01: canvas output theo DPR. ResizeObserver đo hộp px thiết bị (device-pixel-content-box, fallback
// contentRect × devicePixelRatio), đặt canvas.width/height và báo store để layout tính lại và epoch++.
import { useEffect, type RefObject } from 'react'
import type { StageStore } from '../loop/store'

export function useStageCanvas(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  store: StageStore,
): void {
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const apply = (w: number, h: number) => {
      const W = Math.max(1, Math.round(w))
      const H = Math.max(1, Math.round(h))
      if (canvas.width !== W) canvas.width = W
      if (canvas.height !== H) canvas.height = H
      store.setStageSize({ w: W, h: H })
    }
    // Đo ngay một lần: ResizeObserver chỉ bắn trong bước render, có thể chậm một frame hoặc không chạy khi
    // document không được render (pane ẩn); RO sau đó tinh chỉnh theo hộp px thiết bị chính xác.
    const rect = canvas.getBoundingClientRect()
    const dpr0 = window.devicePixelRatio || 1
    if (rect.width > 0 && rect.height > 0) apply(rect.width * dpr0, rect.height * dpr0)
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const box = entry.devicePixelContentBoxSize?.[0]
      if (box) apply(box.inlineSize, box.blockSize)
      else {
        const dpr = window.devicePixelRatio || 1
        apply(entry.contentRect.width * dpr, entry.contentRect.height * dpr)
      }
    })
    try {
      ro.observe(canvas, { box: 'device-pixel-content-box' })
    } catch {
      ro.observe(canvas)
    }
    return () => ro.disconnect()
  }, [canvasRef, store])
}
