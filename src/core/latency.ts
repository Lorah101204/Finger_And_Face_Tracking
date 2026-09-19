// PERF-01: cửa sổ trượt các số đo thời gian (ms) với p50 và p95: inferMs của worker mặt và tay (FaceClient,
// HandClient), thời gian vẽ và thời gian tick của vòng lặp. Thuần: mảng cố định ghi vòng, không cấp phát khi push;
// percentile chỉ sắp xếp bản sao khi được hỏi. Quy ước hạng: sorted[floor(p · (n − 1))], nên p50 đúng bằng cách tính
// cũ của FaceClient (sorted[floor((n − 1) / 2)]) và unit test FACE-01 giữ nguyên.
export type LatencyStats = {
  p50: number
  p95: number
  /** số mẫu đang có trong cửa sổ */
  n: number
  last: number
}

export type LatencyWindow = {
  readonly size: number
  push(ms: number): void
  /** p trong [0, 1]; 0 khi chưa có mẫu. */
  percentile(p: number): number
  stats(): LatencyStats
  reset(): void
}

export const EMPTY_LATENCY: LatencyStats = { p50: 0, p95: 0, n: 0, last: 0 }

export function createLatencyWindow(size = 20): LatencyWindow {
  const cap = Math.max(1, Math.floor(size))
  const buf = new Float64Array(cap)
  let n = 0
  let head = 0
  let last = 0
  const sorted = () => {
    const out = Array.from(n < cap ? buf.subarray(0, n) : buf)
    out.sort((a, b) => a - b)
    return out
  }
  return {
    size: cap,
    push(ms) {
      buf[head] = ms
      head = (head + 1) % cap
      if (n < cap) n++
      last = ms
    },
    percentile(p) {
      if (n === 0) return 0
      const s = sorted()
      const q = Math.min(1, Math.max(0, p))
      return s[Math.floor(q * (n - 1))]
    },
    stats() {
      if (n === 0) return { ...EMPTY_LATENCY }
      const s = sorted()
      return { p50: s[Math.floor(0.5 * (n - 1))], p95: s[Math.floor(0.95 * (n - 1))], n, last }
    },
    reset() {
      n = 0
      head = 0
      last = 0
    },
  }
}
