// PERF-03 (D-063): màu của lớp vẽ, tách khỏi compositor.ts để trang chào (LandingPreview) dùng cùng bảng màu mà không
// kéo compositor, coords và handLandmarks vào chunk đầu. compositor.ts re-export toàn bộ, nên mọi import cũ vẫn chạy.
import type { Handedness, ValidatedFace } from '../core/types'

/** Xám nhạt của vạch lưới. e2e coi màu này và trắng là "chưa có pixel camera" (mục 7.6). */
export const GRID_LINE_COLOR = '#e6e6e6'
export const GRID_LINE_RGBA: readonly [number, number, number, number] = [230, 230, 230, 255]
/** ROI-00: viền cửa sổ (overlay, vẽ trong stageRect); màu đỏ khi cửa sổ đang bị kẹp ở mép bảng. */
export const WINDOW_OUTLINE_COLOR = '#1a73e8'
export const WINDOW_OUTLINE_LIMITED_COLOR = '#d93025'
export const WINDOW_OUTLINE_RGBA: readonly [number, number, number, number] = [26, 115, 232, 255]
export const WINDOW_OUTLINE_LIMITED_RGBA: readonly [number, number, number, number] = [
  217, 48, 37, 255,
]
/** FACE-02: màu overlay mặt full (xanh lá đậm) và partial (hổ phách, nét đứt). */
export const FACE_FULL_COLOR = '#188038'
export const FACE_PARTIAL_COLOR = '#f9ab00'
/** CLS-02: nền nhãn phân loại theo subjectType. */
export const SUBJECT_COLOR: Record<ValidatedFace['subjectType'], string> = {
  person: '#188038',
  mannequin: '#c5221f',
  unknown: '#5f6368',
}
export const FACE_FULL_RGBA: readonly [number, number, number, number] = [24, 128, 56, 255]
export const FACE_PARTIAL_RGBA: readonly [number, number, number, number] = [249, 171, 0, 255]
/** HAND-01: màu overlay tay trái (tím) và tay phải (xanh ngọc). */
export const HAND_LEFT_COLOR = '#8e24aa'
export const HAND_RIGHT_COLOR = '#00897b'
export const HAND_LEFT_RGBA: readonly [number, number, number, number] = [142, 36, 170, 255]
export const HAND_RIGHT_RGBA: readonly [number, number, number, number] = [0, 137, 123, 255]
/** ROI-03: màu chấm đầu ngón theo tay (cùng màu overlay tay). */
export const FINGER_COLORS: Record<Handedness, string> = {
  left: HAND_LEFT_COLOR,
  right: HAND_RIGHT_COLOR,
}
export const SLOT_RGBA: readonly (readonly [number, number, number, number])[] = [
  [229, 57, 53, 255],
  [251, 140, 0, 255],
  [30, 136, 229, 255],
  [67, 160, 71, 255],
]
