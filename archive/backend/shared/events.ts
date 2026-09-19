// Danh sách loại sự kiện nhật ký và giới hạn, dùng chung cho client (src/app/telemetry.ts) và server
// (server/src/routes/session.ts). Chỉ metadata: không có kiểu nào chứa ảnh, crop, landmark hay tọa độ mặt (bất biến I9).

export const EVENT_TYPES = [
  'visit',
  'consent',
  'page_hidden',
  'page_visible',
  'ui_action',
  'camera_start',
  'camera_denied',
  'camera_stop',
  'reveal_open',
  'reveal_close',
  'face_first_seen',
  'classifier_label',
  'error',
] as const

export type EventType = (typeof EVENT_TYPES)[number]

/** Sự kiện chỉ hợp lệ sau khi phiên đã đồng ý (bất biến I10). */
export const CAMERA_EVENT_TYPES: readonly EventType[] = [
  'camera_start',
  'camera_denied',
  'camera_stop',
  'reveal_open',
  'reveal_close',
  'face_first_seen',
  'classifier_label',
]

export const EVENT_PAYLOAD_MAX_BYTES = 2048
export const EVENTS_BATCH_MAX = 50
export const DISPLAY_NAME_MAX = 60
export const CONSENT_VERSION = '2026-09-17'

export type EventPayload = Record<string, string | number | boolean | null>

export type ClientEvent = { ts: string; type: EventType; payload?: EventPayload }
