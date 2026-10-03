// PERF-03 (D-063): ba bước của lớp hướng dẫn, tách khỏi guidance.ts để trang chào (stepper) không kéo guidance,
// fingertips, cells và coords vào chunk đầu. guidance.ts re-export, nên mọi import cũ vẫn chạy.
export type GuidanceStep = 1 | 2 | 3

export const GUIDE_STEP_IDS: readonly GuidanceStep[] = [1, 2, 3]
