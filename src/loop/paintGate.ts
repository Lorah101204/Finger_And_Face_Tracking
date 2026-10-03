// PERF-04 (D-064): vẽ lại sân khấu chỉ khi hình vẽ ra sẽ khác lần vẽ trước. PERF-02 (D-052) chỉ bỏ qua frame tĩnh (không
// có gì động trên màn); khi vùng mở, vòng lặp vẫn vẽ mọi requestAnimationFrame dù camera chỉ cấp khoảng 30 frame/s và
// màn hình chạy 60 đến 144 Hz, nên phần lớn lần vẽ lặp lại đúng hình cũ (mỗi lần một drawImage video và lớp phủ).
// Khóa so sánh là mọi đầu vào của compositor.render():
// - layout (đối tượng), vạch lưới, mirror, ngôn ngữ, lớp logo và version của nó;
// - mask (đối tượng: PERF-02 giữ nguyên đối tượng khi hình không đổi, nên đối tượng mới là hình mới);
// - khi vẽ video (mask có ô và có drawable): drawable và frameId của frame camera;
// - khi vẽ mặt (chỉ trong mask): đối tượng mảng faces (vòng lặp thay mảng khi có kết quả hay nhãn mới);
// - khi vẽ overlay tay: đối tượng HandFrame và cờ "cũ" (now − ts > pointMaxAgeMs làm mờ tay, compositor.drawHands);
// - đầu ngón theo giá trị đúng như drawFingertips vẽ: tay, kiểu (gập, hợp lệ, mờ) và tọa độ đã làm tròn.
// Trường nào compositor bắt đầu vẽ thêm thì phải vào khóa (unit test paintGate đối chiếu từng trường của RenderOptions).
// Không cấp phát mỗi frame: khóa và chữ ký đầu ngón dùng lại bộ nhớ.
import type { Lang } from '../core/i18n'
import type { Layout } from '../core/coords'
import type { FingerStatus, HandFrame, RevealMask, ValidatedFace } from '../core/types'
import type { LogoPainter } from '../mask/compositor'

export type PaintKey = {
  layout: Layout | null
  showLines: boolean
  mirror: boolean
  lang: Lang | undefined
  logo: LogoPainter | null
  logoVersion: number
  mask: RevealMask | null
  /** Nguồn video đang vẽ; null khi không vẽ video. */
  drawable: CanvasImageSource | null
  /** frameId của frame camera đang vẽ; -1 khi không vẽ video. */
  camFrame: number
  /** Mảng mặt đang vẽ; null khi không có mask (mặt chỉ vẽ trong mask). */
  faces: readonly ValidatedFace[] | null
  /** HandFrame của overlay tay; null khi không vẽ overlay. */
  hands: HandFrame | null
  handsStale: boolean
  fingers: readonly FingerStatus[]
}

export function emptyPaintKey(): PaintKey {
  return {
    layout: null,
    showLines: false,
    mirror: false,
    lang: undefined,
    logo: null,
    logoVersion: 0,
    mask: null,
    drawable: null,
    camFrame: -1,
    faces: null,
    hands: null,
    handsStale: false,
    fingers: [],
  }
}

/** Chữ ký đầu ngón đúng như drawFingertips vẽ: [số đầu ngón, rồi mỗi đầu ngón: tay, kiểu, x, y đã làm tròn]. */
export function fingersSignature(fingers: readonly FingerStatus[], out: number[] = []): number[] {
  out.length = 0
  out.push(fingers.length)
  for (const s of fingers)
    out.push(
      s.hand === 'left' ? 0 : 1,
      s.reason === 'folded' ? 2 : s.valid ? 1 : 0,
      Math.round(s.pStage.x),
      Math.round(s.pStage.y),
    )
  return out
}

function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export type PaintGate = {
  /** true khi khóa khác lần vẽ đã commit (hay chưa từng vẽ, hay đã invalidate). */
  changed(key: PaintKey): boolean
  /** Ghi khóa của lần vẽ vừa xong (gọi SAU render, để một render lỗi được vẽ lại ở frame sau). */
  commit(key: PaintKey): void
  /** Canvas bị vẽ đè ngoài vòng lặp, đổi canvas, mất context: lần kế phải vẽ. */
  invalidate(): void
}

export function createPaintGate(): PaintGate {
  const last = emptyPaintKey()
  let valid = false
  let lastSig: number[] = []
  let sig: number[] = []
  return {
    changed(k) {
      if (!valid) return true
      if (
        k.layout !== last.layout ||
        k.showLines !== last.showLines ||
        k.mirror !== last.mirror ||
        k.lang !== last.lang ||
        k.logo !== last.logo ||
        k.logoVersion !== last.logoVersion ||
        k.mask !== last.mask ||
        k.drawable !== last.drawable ||
        k.camFrame !== last.camFrame ||
        k.faces !== last.faces ||
        k.hands !== last.hands ||
        k.handsStale !== last.handsStale
      )
        return true
      if (k.fingers === last.fingers) return false
      sig = fingersSignature(k.fingers, sig)
      return !sameNumbers(sig, lastSig)
    },
    commit(k) {
      Object.assign(last, k)
      // Chữ ký tính lại (changed có thể đã thoát sớm trước khi tính), rồi đổi vai hai mảng để không cấp phát.
      sig = fingersSignature(k.fingers, sig)
      const t = lastSig
      lastSig = sig
      sig = t
      valid = true
    },
    invalidate() {
      valid = false
    },
  }
}
