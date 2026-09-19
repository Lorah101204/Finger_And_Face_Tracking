// REL-01 (D-050): chốt I9 ở tầng runtime. Mã của dự án không có fetch/XHR/WebSocket (check:invariants), nhưng thư viện
// thứ ba thì có: @mediapipe/tasks-vision 1.0.1 gom thống kê dùng (số lần suy luận, thời gian) và POST tới
// https://odml.pa.googleapis.com/v1/log mỗi 60 s từ chính worker chạy landmarker, không có tùy chọn tắt. Guard này
// thay `fetch` của scope (worker hay trang) bằng bản chỉ cho cùng origin; yêu cầu khác origin bị từ chối ngay tại chỗ
// (TypeError như mất mạng) nên không có gói tin nào rời trình duyệt. MediaPipe bắt lỗi, ghi `net-send-failed` và
// ngừng gửi. Mọi worker (*.worker.ts) và main.tsx phải gọi installSameOriginGuard(self) trước khi nạp thư viện;
// check:invariants kiểm điều đó. Service worker (public/sw.js) chặn lần nữa ở tầng mạng khi đã kích hoạt.

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export type GuardScope = {
  fetch: FetchLike
  location: { href: string; origin: string }
}

/** Origin của một RequestInfo tương đối với location của scope; URL hỏng thì trả null. */
export function requestOrigin(input: RequestInfo | URL, baseHref: string): string | null {
  try {
    const raw = typeof input === 'string' || input instanceof URL ? String(input) : input.url
    return new URL(raw, baseHref).origin
  } catch {
    return null
  }
}

export type GuardStats = { allowed: number; blocked: string[] }

/**
 * Thay scope.fetch bằng bản chỉ cho cùng origin. Trả về bộ đếm (số yêu cầu cho qua, danh sách URL bị chặn) và hàm
 * gỡ. Gọi lần hai trên cùng scope thì không bọc thêm.
 */
export function installSameOriginGuard(scope: GuardScope): {
  stats: GuardStats
  uninstall(): void
} {
  const marked = scope.fetch as FetchLike & { __wctGuard?: GuardStats }
  if (marked.__wctGuard) return { stats: marked.__wctGuard, uninstall: () => {} }
  const original = scope.fetch
  const stats: GuardStats = { allowed: 0, blocked: [] }
  const guarded: FetchLike & { __wctGuard?: GuardStats } = (input, init) => {
    const origin = requestOrigin(input, scope.location.href)
    if (origin !== scope.location.origin) {
      const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url
      if (stats.blocked.length < 50) stats.blocked.push(url)
      return Promise.reject(
        new TypeError(`wct: yêu cầu khác origin bị chặn (I9): ${url.slice(0, 120)}`),
      )
    }
    stats.allowed++
    return original.call(scope, input, init)
  }
  guarded.__wctGuard = stats
  scope.fetch = guarded
  return {
    stats,
    uninstall() {
      if (scope.fetch === guarded) scope.fetch = original
    },
  }
}
