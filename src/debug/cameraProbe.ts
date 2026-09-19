// CAM-01: probe debug đếm frame và kiểm frameId liên tục (tiêu chí "frameId liên tục không trùng").
// Đọc qua window.__wct.camera (UC-11); chỉ là số đếm trong trang, không gửi đi đâu (I9).
import type { CameraSnapshot } from '../camera/cameraState'
import type { FrameSource } from '../camera/frameSource'
import { wct, type CameraProbe } from './wctGlobal'

export type { CameraProbe } from './wctGlobal'

export function installCameraProbe(
  source: FrameSource,
  snapshot: () => CameraSnapshot,
): () => void {
  const probe: CameraProbe = {
    frames: 0,
    lastFrameId: -1,
    gaps: 0,
    duplicates: 0,
    firstTs: 0,
    lastTs: 0,
    fps: 0,
  }
  const off = source.onFrame((stamp) => {
    if (probe.frames === 0) probe.firstTs = stamp.ts
    else if (stamp.frameId <= probe.lastFrameId) probe.duplicates++
    else if (stamp.frameId !== probe.lastFrameId + 1) probe.gaps++
    probe.frames++
    probe.lastFrameId = stamp.frameId
    probe.lastTs = stamp.ts
    const span = probe.lastTs - probe.firstTs
    probe.fps = span > 0 ? ((probe.frames - 1) * 1000) / span : 0
  })
  const g = wct()
  g.camera = { probe, snapshot }
  return () => {
    off()
    if (g.camera?.probe === probe) delete g.camera
  }
}
