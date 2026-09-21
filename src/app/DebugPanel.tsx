import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { CameraSource } from '../camera/cameraSource'
import type { ClassifierClient } from '../classify/classifierClient'
import { describeClassifier } from '../debug/classifierProbe'
import { describeEnv, readEnv } from '../debug/envProbe'
import { cameraCloseReason } from '../camera/cameraState'
import { describeFace } from '../debug/faceProbe'
import { describeHands } from '../debug/handProbe'
import { describeLogo, readLogo } from '../debug/logoProbe'
import type { LogoLayer } from '../mask/logoLayer'
import type { Probes } from '../debug/probes'
import { describeStats, type Stats } from '../debug/stats'
import type { FaceClient } from '../face/faceClient'
import type { HandPipeline } from '../hands/handPipeline'
import { describeFingertips } from '../hands/fingertips'
import {
  describeRestricted,
  describeReveal,
  statusMessage,
  type FrameLoop,
} from '../loop/frameLoop'
import type { StageStore } from '../loop/store'
import { subscribeTick } from './tick'
import { describeHandWindow, type HandWindowSource } from '../reveal/handWindowSource'
import { useStrings } from './useLang'

// UX-01: panel debug tách khỏi panel cài đặt (nút "Debug" trên thanh trên; mở sẵn khi ?debug=1). Giữ nguyên các dòng
// data-testid mà e2e đọc: stage-status (statusMessage của FACE-02), camera-stat (CAM-01), stats-stat (PERF-01),
// reveal, restricted, face, hands, fingers, solver, layout; thumbnail buffer vừa gửi (FACE-01 bước 5) chỉ khi có probe.
// Thu gọn bằng hidden: các dòng vẫn trong DOM nên e2e đọc được cả khi panel đóng. Mọi chuỗi đọc qua
// useSyncExternalStore ở nhịp 250 ms (D-012), không re-render theo frame. UX-03 (D-049): ngăn kéo dưới canvas, lưới
// ba cột chữ mono đọc được thay thanh một dòng cuộn ngang; nội dung từng dòng không đổi.
export type DebugPanelProps = {
  open: boolean
  id: string
  camera: CameraSource
  store: StageStore
  loop: FrameLoop
  face: FaceClient
  hands: HandPipeline
  handWindow: HandWindowSource
  stats: Stats
  probes: Probes
  /** CLS-02: dòng phân loại. */
  classifier?: ClassifierClient
  /** BRAND-01: lớp logo cho dòng logo-stat. */
  logo?: LogoLayer
}

export function DebugPanel({
  open,
  id,
  camera,
  store,
  loop,
  face,
  hands,
  handWindow,
  stats,
  probes,
  classifier,
  logo,
}: DebugPanelProps) {
  const thumbRef = useRef<HTMLCanvasElement>(null)
  // QA-02: môi trường không đổi trong đời trang, đọc một lần (tạo context WebGL để lấy renderer).
  const [envText] = useState(() => describeEnv(readEnv()))
  const d = useStrings().debug
  const snap = useSyncExternalStore(camera.subscribe, camera.getSnapshot)
  const stage = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const frameId = useSyncExternalStore(subscribeTick, () => camera.lastStamp?.frameId ?? -1)
  const revealText = useSyncExternalStore(subscribeTick, () => describeReveal(loop.snapshot()))
  const restrictedText = useSyncExternalStore(subscribeTick, () =>
    describeRestricted(loop.snapshot()),
  )
  const faceText = useSyncExternalStore(subscribeTick, () => describeFace(face.snapshot()))
  const handsText = useSyncExternalStore(subscribeTick, () =>
    describeHands(hands.snapshot(), store.getSnapshot().settings.windowSource === 'hands'),
  )
  const statusText = useSyncExternalStore(subscribeTick, () => {
    const s = loop.snapshot()
    return statusMessage(s.output, s.fingers, s.reveal.kind === 'closed' ? s.reveal.reason : null)
  })
  const fingersText = useSyncExternalStore(subscribeTick, () =>
    describeFingertips(loop.snapshot().fingers),
  )
  const logoText = useSyncExternalStore(subscribeTick, () =>
    logo
      ? describeLogo(readLogo(logo, store.getSnapshot().layout, loop.snapshot().logoVisible))
      : 'logo: không có',
  )
  const statsText = useSyncExternalStore(stats.subscribe, () => describeStats(stats.snapshot()))
  const classifierText = useSyncExternalStore(subscribeTick, () =>
    classifier ? describeClassifier(classifier.snapshot()) : d.noClassifier,
  )
  const solverText = useSyncExternalStore(subscribeTick, () =>
    describeHandWindow(
      handWindow.snapshot(),
      store.getSnapshot().settings.windowSource === 'hands',
    ),
  )

  // FACE-01 bước 5: thumbnail buffer vừa gửi (bằng chứng trực quan của I1), chỉ khi ?debug=1; putImageData, không
  // drawImage. Listener này cũng là lý do probe đọc ngược ở nhịp mặc định (D-012, tối đa 2 Hz).
  useEffect(() => {
    if (!probes.enabled) return
    return probes.onRestrictedFrame((img) => {
      const c = thumbRef.current
      if (!c) return
      if (c.width !== img.width || c.height !== img.height) {
        c.width = img.width
        c.height = img.height
      }
      c.getContext('2d')?.putImageData(img, 0, 0)
    })
  }, [probes])

  const L = stage.layout
  return (
    <section
      id={id}
      className="panel debug"
      aria-label={d.label}
      hidden={!open}
      data-testid="debug-panel"
    >
      <div className="dbg">
        <div className="stats">
          <span className="stat wide" data-testid="stage-status">
            {statusText}
          </span>
          <span className="stat" data-testid="camera-stat">
            {d.epoch} {stage.epoch} · {d.frame} {frameId} · {d.close}:{' '}
            {cameraCloseReason(snap) ?? d.none}
          </span>
          <span className="stat" data-testid="stats-stat">
            {statsText}
          </span>
          <span className="stat" data-testid="reveal-stat">
            {d.region}: {revealText}
          </span>
          <span className="stat" data-testid="restricted-stat">
            {restrictedText}
          </span>
          <span className="stat" data-testid="face-stat">
            {faceText}
          </span>
          <span className="stat" data-testid="classifier-stat">
            {classifierText}
          </span>
          <span className="stat" data-testid="hands-stat">
            {handsText}
          </span>
          <span className="stat" data-testid="fingers-stat">
            {fingersText}
          </span>
          <span className="stat" data-testid="solver-stat">
            {solverText}
          </span>
          <span className="stat" data-testid="logo-stat">
            {logoText}
          </span>
          <span className="stat" data-testid="env-stat">
            {envText}
          </span>
          <span className="stat" data-testid="layout-stat">
            c {L.c} · {d.board} {L.board.w}×{L.board.h} {d.at} ({L.board.x}, {L.board.y}) ·{' '}
            {d.stage} {L.stage.w}×{L.stage.h} · {d.camera} {L.cam.w}×{L.cam.h} · {d.scale}{' '}
            {L.scale.toFixed(3)}
          </span>
        </div>
        {probes.enabled && (
          <canvas
            ref={thumbRef}
            className="thumb"
            width={256}
            height={256}
            data-testid="restricted-thumb"
            aria-label={d.thumb}
          />
        )}
      </div>
    </section>
  )
}
