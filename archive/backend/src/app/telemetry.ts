// LOG-01: gom sự kiện metadata và gửi theo lô; sendBeacon khi rời trang.
// Không có đường nào nhận ảnh, crop hay landmark (bất biến I9): payload chỉ là chuỗi, số, boolean, null.
import { EVENTS_BATCH_MAX, type ClientEvent, type EventPayload, type EventType } from '../../shared/events'
import { api } from './api'
import { getSession } from './session'

const FLUSH_MS = 5000
const FLUSH_COUNT = 20

let queue: ClientEvent[] = []
let timer: ReturnType<typeof setTimeout> | null = null
let sending = false
let installed = false

/** Điểm gọi cho CAM-01 (camera_start, camera_denied, camera_stop), ROI-01 (reveal_*), FACE-02, CLS-02. */
export function logEvent(type: EventType, payload?: EventPayload): void {
  queue.push({ ts: new Date().toISOString(), type, payload })
  if (queue.length >= FLUSH_COUNT) void flush()
  else if (!timer) timer = setTimeout(() => void flush(), FLUSH_MS)
}

export async function flush(): Promise<void> {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (sending || queue.length === 0 || !getSession()) return
  const batch = queue.slice(0, EVENTS_BATCH_MAX)
  queue = queue.slice(batch.length)
  sending = true
  try {
    await api.events(batch)
  } catch {
    // Lô này mất; không giữ lại để hàng đợi không tích tụ khi server lỗi.
  } finally {
    sending = false
  }
  if (queue.length > 0) void flush()
}

function beacon(path: string, body: unknown): void {
  if (typeof navigator.sendBeacon !== 'function') return
  navigator.sendBeacon(path, new Blob([JSON.stringify(body)], { type: 'text/plain' }))
}

function flushWithBeacon(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (!getSession() || queue.length === 0) return
  const batch = queue.splice(0, EVENTS_BATCH_MAX)
  beacon('/api/session/events', { events: batch })
}

export function installTelemetry(): void {
  if (installed) return
  installed = true
  document.addEventListener('visibilitychange', () => {
    logEvent(document.visibilityState === 'hidden' ? 'page_hidden' : 'page_visible')
    if (document.visibilityState === 'hidden') flushWithBeacon()
  })
  window.addEventListener('pagehide', () => {
    flushWithBeacon()
    if (getSession()) beacon('/api/session/end', {})
  })
}

/** Chỉ cho test. */
export function pendingCount(): number {
  return queue.length
}
