// CAM-01: interface FrameSource dùng chung cho CameraSource (webcam) và SyntheticCameraSource (TEST-00).
// Người dùng frame (hand tracker, compositor, restrictedFrame) chỉ biết interface này.
import type { FrameStamp } from '../core/types'

export type FrameListener = (stamp: FrameStamp) => void

export interface FrameSource {
  /** Kích thước frame gốc theo px camera; 0 khi chưa có nguồn. */
  readonly width: number
  readonly height: number
  /** Nguồn cho drawImage: video element (CameraSource) hoặc canvas (SyntheticCameraSource); null khi chưa active. */
  readonly drawable: CanvasImageSource | null
  /** Dấu frame gần nhất; null khi chưa có frame nào. */
  readonly lastStamp: FrameStamp | null
  /** Đăng ký nhận FrameStamp cho mỗi frame mới. Trả hàm hủy đăng ký. */
  onFrame(cb: FrameListener): () => void
  stop(): void
}
