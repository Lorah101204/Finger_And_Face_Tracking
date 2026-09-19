// QA-02 (D-045): chọn delegate cho Hand Landmarker theo GPU thật hay giả lập. Đo trên máy mục tiêu (RTX 3050, Chrome và
// Edge 153): GPU delegate 28,5 đến 29,5 Hz (p50 25 đến 27 ms) so với CPU 10,5 đến 11 Hz; trên Chromium headless
// (SwiftShader) GPU chỉ 2 Hz so với CPU 9,5 Hz. Nên mặc định `auto`: GPU khi WebGL chạy trên phần cứng, CPU khi
// renderer là phần mềm (SwiftShader, llvmpipe) hoặc không có WebGL; worker vẫn tự đổi sang delegate còn lại nếu tạo
// landmarker lỗi (HAND-01). Thuần, không đụng DOM: StagePage đọc renderer bằng debug/envProbe.readWebgl().
import type { HandDelegate } from './handProtocol'

export type HandDelegatePref = 'auto' | HandDelegate

const SOFTWARE_RENDERER =
  /swiftshader|llvmpipe|softpipe|software|mesa offscreen|microsoft basic render/i

/** Renderer WebGL là giả lập phần mềm (hoặc không có WebGL). */
export function isSoftwareRenderer(renderer: string | null): boolean {
  return !renderer || SOFTWARE_RENDERER.test(renderer)
}

/** Delegate thực dùng: pref rõ ràng thì giữ nguyên; `auto` → GPU trên phần cứng, CPU trên giả lập hay thiếu WebGL. */
export function resolveHandDelegate(pref: HandDelegatePref, renderer: string | null): HandDelegate {
  if (pref !== 'auto') return pref
  return isSoftwareRenderer(renderer) ? 'CPU' : 'GPU'
}
