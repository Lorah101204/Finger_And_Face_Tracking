// HAND-01: chỉ số landmark bàn tay theo MediaPipe Hand Landmarker (21 điểm). Ở core/ để hands/ (tracker, slots) và
// mask/compositor (overlay debug) dùng chung mà không phụ thuộc nhau.
/** Đầu ngón: cái 4, trỏ 8, giữa 12, áp út 16, út 20 (HAND-02 dùng cho slot). */
export const TIP_INDEX = { thumb: 4, index: 8, middle: 12, ring: 16, pinky: 20 } as const
export const FINGER_TIPS: readonly number[] = [4, 8, 12, 16, 20]
/** Cổ tay và bốn khớp MCP: tâm lòng bàn tay là trung bình của các điểm này (ổn định hơn tâm bbox khi xòe ngón). */
export const PALM_INDEX: readonly number[] = [0, 5, 9, 13, 17]
export const WRIST_INDEX = 0
export const HAND_LANDMARKS = 21
