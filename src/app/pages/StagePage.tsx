import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { CameraSource } from '../../camera/cameraSource'
import { type CameraErrorKind, type CameraSnapshot } from '../../camera/cameraState'
import { SyntheticCameraSource } from '../../camera/syntheticCameraSource'
import { DEFAULTS, modelWarmList } from '../../core/config'
import type { FrameOutput } from '../../core/types'
import { createEpochCounter } from '../../core/epoch'
import { ClassifierClient } from '../../classify/classifierClient'
import { FaceClient } from '../../face/faceClient'
import { installCameraProbe } from '../../debug/cameraProbe'
import { installClassifierProbe } from '../../debug/classifierProbe'
import { installEnvProbe, readWebgl } from '../../debug/envProbe'
import { documentWarmList, warmServiceWorker } from '../registerSw'
import { installLogProbe } from '../../debug/logProbe'
import { openIdbLogStore } from '../../log/idbStore'
import {
  createLocalLog,
  createMemoryLogStore,
  deviceStore,
  type LogStore,
} from '../../log/localLog'
import { resolveHandDelegate } from '../../hands/handDelegate'
import { defaultSensitivity } from '../../reveal/sensitivity'
import { installFaceProbe } from '../../debug/faceProbe'
import { installHandProbe, installHandWindowProbe } from '../../debug/handProbe'
import { installLoopProbe } from '../../debug/loopProbe'
import { createProbes } from '../../debug/probes'
import { installScenarios } from '../../debug/scenarios'
import { installStageProbe } from '../../debug/stageProbe'
import { createStats } from '../../debug/stats'
import { installStatsProbe } from '../../debug/statsProbe'
import { installDatasetProbe } from '../../debug/datasetProbe'
import { createRecorder } from '../../dataset/recorder'
import {
  directorySinkSupported,
  downloadBytes,
  encodePng,
  pickDirectorySink,
} from '../../dataset/sinks'
import { wct } from '../../debug/wctGlobal'
import { createFrameLoop } from '../../loop/frameLoop'
import { cameraGate, visibilityGate } from '../../loop/closeGate'
import { createStageStore } from '../../loop/store'
import { HandClient } from '../../hands/handClient'
import { createHandPipeline } from '../../hands/handPipeline'
import { paintBackground } from '../../mask/compositor'
import { createRestrictedFrameBuilder } from '../../mask/restrictedFrame'
import { HandWindowSource } from '../../reveal/handWindowSource'
import { MouseWindowSource } from '../../reveal/mouseWindowSource'
import { BrandMark } from '../BrandMark'
import { DebugPanel } from '../DebugPanel'
import { assertCameraAllowed } from '../gate'
import { Guide } from '../Guide'
import {
  buildGuidance,
  cameraPhase,
  MOUSE_KEYS,
  type CameraPhase,
  type WorkerPhase,
} from '../guidance'
import { CONSENT_VERSION, revokeConsent, useConsent } from '../session'
import { SettingsPanel } from '../SettingsPanel'
import { subscribeTick } from '../tick'
import { useFullscreen } from '../useFullscreen'
import { useIdle } from '../useIdle'
import { useStageCanvas } from '../useStageCanvas'
import { useUiState } from '../useUiState'

/**
 * Sân khấu: canvas output trắng với vạch lưới (bất biến I4); thanh trên với camera (CAM-01), panel cài đặt (lưới
 * GRID-01, nguồn cửa sổ ROI-00, đầu ngón ROI-03, độ nhạy ROI-01) và panel debug tách riêng (UX-01). Chỉ vào được sau
 * khi đồng ý (WEB-00). Vòng lặp frameLoop vẽ nền, lưới, camera chỉ trong stageRect của mask (MASK-01) và viền cửa
 * sổ. Cổng I10 nằm trong CameraSource.start() qua `gate` (D-025). Một bộ đếm epoch dùng chung cho camera, layout và
 * vùng mở.
 * TEST-00: ?debug=1 bật probe và kịch bản window.__scenario; ?debug=1&source=synthetic thay camera bằng
 * SyntheticCameraSource (không gọi getUserMedia). MASK-02: vòng lặp tạo buffer giới hạn qua
 * createRestrictedFrameBuilder. FACE-01: FaceClient tạo worker mặt lúc mount; vòng lặp gửi buffer khi worker rảnh.
 * FACE-02: overlay mặt đã validate do vòng lặp vẽ. HAND-01, HAND-02: HandClient + HandTracker qua createHandPipeline,
 * worker tay chỉ khởi tạo khi nguồn cửa sổ là "Tay"; các đầu ngón đánh giá mỗi frame. ROI-01, ROI-02, ROI-03:
 * HandWindowSource (fingertips → hullSolver, bao lồi các đầu ngón). INT-01: CloseGate cho vòng lặp (camera thật theo cameraCloseReason, nguồn tổng hợp chỉ theo
 * tab ẩn); đổi nguồn cửa sổ là đổi cấu hình (epoch++ ở store). PERF-01: sampler stats cho panel debug và
 * window.__wct.stats.
 * UX-01 (UC-08): lớp hướng dẫn `Guide` nổi trên canvas nêu bước hiện tại (camera → cửa sổ → khuôn mặt), một thông
 * điệp cho từng pha camera, từng CloseReason và từng FrameOutput.status (guidance.ts); toàn màn hình (useFullscreen,
 * phím F) với thanh và panel thành lớp phủ tự ẩn khi không tương tác; panel cài đặt và panel debug thu gọn được, trạng
 * thái mở hay đóng giữ trong sessionStorage của tab (uiState.ts).
 * UX-03 (D-049): thanh trên ba vùng (brand và camera, pill trạng thái, các nút), cột cài đặt bên phải và ngăn kéo debug
 * dưới canvas (panel trong luồng: mở hay đóng đổi cỡ canvas, epoch++); chế độ trình diễn (`ui.present`, mặc định theo
 * `?mode=present`, nút Trình diễn) dùng chung cơ chế lớp phủ với toàn màn hình (.overlay): mọi panel thành lớp nổi tự
 * ẩn sau 2,5 s không tương tác (useIdle), canvas chiếm trọn .stage nên mở panel không đóng cửa sổ đang mở.
 * CLS-01 (I8): dataset mode (`dataset/recorder.ts`) nhận crop vùng mở qua CropTap của builder buffer, lưu thư mục hay
 * zip cục bộ; thanh DatasetControls trong panel cài đặt, chỉ báo đỏ trên canvas khi đang thu; window.__wct.dataset.
 * LOG-02 (D-022, D-046): nhật ký vận hành cục bộ (`log/localLog.ts`, IndexedDB `wct-log`): chỉ sự kiện metadata do trang
 * này xây từ snapshot chữ và số (consent, camera bật/dừng/lỗi, vùng mở/đóng kèm lý do, đổi cấu hình), công tắc mặc định
 * tắt; thanh LogControls trong panel cài đặt, trạng thái ở thanh trên; window.__wct.log.
 */
export function StagePage() {
  const navigate = useNavigate()
  const consented = useConsent()
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [searchParams] = useSearchParams()
  const debug = searchParams.get('debug') === '1'
  const syntheticWanted = debug && searchParams.get('source') === 'synthetic'
  // QA-02 (D-045): `hands=GPU|CPU` ghi đè delegate của worker tay (mặc định `auto`: GPU trên phần cứng, CPU khi WebGL
  // là phần mềm), `ep=wasm` ép ORT dùng wasm (mặc định webgpu rồi wasm) để benchmark so sánh trên máy mục tiêu.
  const handsParam = searchParams.get('hands')
  const handPref =
    handsParam === 'GPU' || handsParam === 'CPU' ? handsParam : DEFAULTS.hands.delegate
  const forceWasm = searchParams.get('ep') === 'wasm'
  // UX-03: `mode=present` mở sẵn chế độ trình diễn (kiosk); giá trị đã lưu trong tab được ưu tiên như debugOpen.
  const presentParam = searchParams.get('mode') === 'present'
  const [runtime] = useState(() => {
    const epoch = createEpochCounter()
    // D-045: delegate tay theo renderer WebGL; tuổi điểm mặc định theo delegate (CPU chậm hơn nên tuổi lớn hơn).
    const handDelegate = resolveHandDelegate(handPref, readWebgl())
    const store = createStageStore(epoch, { sensitivity: defaultSensitivity(handDelegate) })
    // LOG-02: kho IndexedDB, không mở được thì bộ nhớ (mất khi tải lại); bật thì ghi consent hiện tại.
    const logStore: Promise<LogStore> = openIdbLogStore().catch(() => createMemoryLogStore())
    const localLog = createLocalLog({
      store: logStore,
      storage: deviceStore(),
      onEnable: () =>
        localLog.log('consent', { version: CONSENT_VERSION, scope: DEFAULTS.consent.scope }),
    })
    const mouse = new MouseWindowSource({ getLayout: () => store.getSnapshot().layout })
    const camera = new CameraSource({ gate: assertCameraAllowed, epoch })
    const synthetic = syntheticWanted ? new SyntheticCameraSource() : null
    const probes = createProbes(debug)
    // CLS-01 (I8): dataset mode nhận crop trước letterbox qua CropTap của builder; PNG mã hóa từ ImageData của crop.
    const recorder = createRecorder({
      encode: encodePng,
      consentVersion: CONSENT_VERSION,
      context: () => {
        const st = store.getSnapshot()
        return {
          grid: { w: st.settings.cols, h: st.settings.rows },
          mirror: st.settings.mirror,
          camera: st.camSize,
        }
      },
    })
    const restricted = createRestrictedFrameBuilder({ probes, crops: recorder.tap })
    const face = new FaceClient({ resultDelayMs: () => probes.workerDelayMs })
    // CLS-02: worker phân loại (ONNX Runtime Web) nhận bitmap thứ hai của cùng crop, 3 đến 5 Hz.
    const classifier = new ClassifierClient(
      forceWasm ? { init: { executionProviders: ['wasm'] } } : {},
    )
    const hands = createHandPipeline({
      client: new HandClient({ init: { delegate: handDelegate } }),
      swap: () => store.getSnapshot().settings.handednessSwap,
    })
    const handWindow = new HandWindowSource({
      getContext: () => {
        const s = store.getSnapshot()
        return {
          layout: s.layout,
          mirror: s.settings.mirror,
          fingers: s.settings.fingers,
          minHands: DEFAULTS.hands.minHands,
          sensitivity: s.settings.sensitivity,
        }
      },
      latest: () => hands.latest,
    })
    const loop = createFrameLoop({
      store,
      epoch,
      sources: { mouse, hands: handWindow },
      frame: synthetic ?? camera,
      probes,
      restricted: { builder: restricted },
      face,
      hands,
      classifier,
      gate: synthetic ? visibilityGate() : cameraGate(camera),
    })
    // PERF-01: sampler 4 Hz đọc bộ đếm của vòng lặp, FaceClient và hand pipeline; panel debug và window.__wct.stats.
    const stats = createStats({
      loop: () => {
        const l = loop.snapshot()
        return {
          frames: l.frames,
          epoch: l.epoch,
          status: l.output.status,
          render: l.timing.render,
          tick: l.timing.tick,
        }
      },
      face: () => {
        const f = face.snapshot()
        return {
          results: f.stats.results,
          submitted: f.stats.submitted,
          dropped: f.stats.dropped,
          p50: f.stats.p50InferMs,
          p95: f.stats.p95InferMs,
          pending: f.busy ? 1 : 0,
        }
      },
      classifier: () => ({ results: classifier.stats.results }),
      hands: () => {
        const h = hands.snapshot()
        return {
          results: h.client.stats.results,
          fed: h.stats.fed,
          skipped: h.stats.skipped,
          p50: h.client.stats.p50InferMs,
          p95: h.client.stats.p95InferMs,
        }
      },
    })
    // UX-01: "đang đổi camera" là requesting ngay sau active (đổi thiết bị); requesting lần đầu là xin quyền.
    const camHist = { wasActive: false }
    return {
      camera,
      store,
      mouse,
      handWindow,
      synthetic,
      probes,
      restricted,
      face,
      hands,
      loop,
      stats,
      camHist,
      recorder,
      classifier,
      handDelegate,
      localLog,
      logStore,
    }
  })
  const {
    camera,
    store,
    mouse,
    handWindow,
    loop,
    synthetic,
    probes,
    restricted,
    face,
    hands,
    stats,
    camHist,
    recorder,
    classifier,
    handDelegate,
    localLog,
    logStore,
  } = runtime
  const snap = useSyncExternalStore(camera.subscribe, camera.getSnapshot)
  const stage = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [selected, setSelected] = useState('')
  const [ui, setUi] = useUiState({
    settingsOpen: !presentParam,
    debugOpen: debug,
    present: presentParam,
  })
  const fs = useFullscreen(rootRef)
  // Chế độ lớp phủ: toàn màn hình hoặc trình diễn; không tương tác thì ẩn lớp nổi (canvas không đổi cỡ, D-041).
  const overlay = fs.active || ui.present
  const idle = useIdle(overlay)

  const status = snap.state.status

  useEffect(() => {
    if (!consented) navigate('/', { replace: true })
  }, [consented, navigate])

  useStageCanvas(canvasRef, store)

  // Vẽ ngay khi layout hoặc cài đặt vạch đổi, không chờ rAF (frameLoop vẽ lại mỗi frame khi chạy).
  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    paintBackground(ctx, stage.layout, stage.settings.showLines)
  }, [stage.layout, stage.settings.showLines])

  useEffect(() => {
    const uninstallCamera = installCameraProbe(camera, camera.getSnapshot)
    const uninstallStage = installStageProbe(store)
    const uninstallLoop = installLoopProbe(loop)
    const uninstallFace = installFaceProbe(face)
    const uninstallHands = installHandProbe(hands)
    const uninstallHandWindow = installHandWindowProbe(handWindow)
    const uninstallStats = installStatsProbe(stats)
    const uninstallDataset = installDatasetProbe(recorder)
    const uninstallClassifier = installClassifierProbe(classifier)
    const uninstallEnv = installEnvProbe()
    const uninstallLog = installLogProbe(localLog, logStore)
    stats.start()
    // REL-01 (D-050): sau khi service worker sẵn sàng, báo cho nó cache asset của trang và model mà app đang nạp
    // (không precache lúc install); dev hay không có service worker thì bỏ qua.
    void warmServiceWorker([...documentWarmList(), ...modelWarmList()])
    // LOG-02: mở kho, dọn; đang bật thì ghi consent của phiên này. Mọi payload là chữ và số từ snapshot, không frame.
    void localLog.start()
    // consent của phiên ghi một lần (logOnce) dù StrictMode chạy effect hai lần.
    localLog.logOnce('consent', { version: CONSENT_VERSION, scope: DEFAULTS.consent.scope })
    let camStatus = camera.getSnapshot().state.status
    const offLogCamera = camera.subscribe(() => {
      const st = camera.getSnapshot().state
      if (st.status === camStatus) return
      const prev = camStatus
      camStatus = st.status
      if (st.status === 'active')
        localLog.log('camera-start', {
          width: st.width,
          height: st.height,
          fps: st.frameRate,
          label: st.label,
        })
      else if (st.status === 'ended') localLog.log('camera-stop', { reason: st.reason })
      else if (st.status === 'idle' && prev === 'active')
        localLog.log('camera-stop', { reason: 'user' })
      else if (st.status === 'error')
        localLog.log('camera-error', { kind: st.kind, message: st.message })
    })
    let prevSettings = store.getSnapshot().settings
    const offLogStore = store.subscribe(() => {
      const s = store.getSnapshot().settings
      if (s === prevSettings) return
      const changed = (Object.keys(s) as (keyof typeof s)[]).filter((k) => s[k] !== prevSettings[k])
      prevSettings = s
      if (!changed.length) return
      const payload: Record<string, unknown> = { changed }
      for (const k of changed) payload[k] = s[k]
      localLog.log('config-change', payload)
    })
    let wasOpen = loop.snapshot().reveal.kind === 'open'
    const onLogFrame = (e: Event) => {
      const out = (e as CustomEvent<FrameOutput>).detail
      const open = out.reveal !== null
      if (open === wasOpen) return
      wasOpen = open
      if (open && out.reveal) {
        localLog.log('reveal-open', {
          epoch: out.epoch,
          source: store.getSnapshot().settings.windowSource,
          shape: out.reveal.shape.kind,
          box: out.reveal.box,
          cells: out.reveal.cells.length,
          limited: out.reveal.limited,
        })
      } else {
        const r = loop.snapshot().reveal
        localLog.log('reveal-close', {
          epoch: out.epoch,
          reason: r.kind === 'closed' ? r.reason : 'unknown',
        })
      }
    }
    loop.events.addEventListener('frame', onLogFrame)
    // FACE-01 bước 3: worker mặt khởi tạo lúc app start (nạp wasm và model, warm-up) để không chờ khi mở vùng.
    face.start()
    // CLS-02: worker phân loại khởi tạo lười khi vùng mở lần đầu (vòng lặp gọi classifier.start()).
    const canvas = canvasRef.current
    if (canvas) {
      mouse.attach(canvas)
      loop.attach(canvas)
    }
    // Camera active thì layout dùng kích thước thật của camera; đổi camera hay đổi cỡ đều tăng epoch qua store.
    // Với nguồn tổng hợp, kích thước camera là kích thước cảnh và camera thật không được nối vào layout.
    const offHist = camera.subscribe(() => {
      const st = camera.getSnapshot().state.status
      if (st === 'active') camHist.wasActive = true
      else if (st !== 'requesting') camHist.wasActive = false
    })
    let offCamera = () => {}
    if (synthetic) {
      synthetic.start()
      store.setCamSize({ w: synthetic.width, h: synthetic.height })
    } else {
      offCamera = camera.subscribe(() => {
        const s = camera.getSnapshot()
        store.setCamSize(
          s.state.status === 'active' ? { w: s.state.width, h: s.state.height } : null,
        )
      })
    }
    let uninstallDebug = () => {}
    if (probes.enabled) {
      const uninstallScenarios = installScenarios({ mouse, store, synthetic, probes, hands })
      const g = wct()
      g.probes = probes
      uninstallDebug = () => {
        uninstallScenarios()
        if (g.probes === probes) delete g.probes
      }
    }
    void camera.refreshDevices()
    return () => {
      stats.stop()
      uninstallStats()
      recorder.dispose()
      uninstallDataset()
      loop.detach()
      mouse.detach()
      synthetic?.stop()
      uninstallDebug()
      offCamera()
      offHist()
      uninstallCamera()
      uninstallStage()
      uninstallLoop()
      camera.dispose()
      restricted.dispose()
      face.dispose()
      uninstallFace()
      classifier.dispose()
      uninstallClassifier()
      uninstallEnv()
      loop.events.removeEventListener('frame', onLogFrame)
      offLogStore()
      offLogCamera()
      uninstallLog()
      localLog.dispose()
      hands.dispose()
      uninstallHands()
      handWindow.dispose()
      uninstallHandWindow()
    }
  }, [
    camera,
    store,
    mouse,
    handWindow,
    loop,
    synthetic,
    probes,
    restricted,
    face,
    hands,
    stats,
    camHist,
    recorder,
    classifier,
    localLog,
    logStore,
  ])

  const active = status === 'active'
  const requesting = status === 'requesting'
  const currentId = snap.state.status === 'active' ? snap.state.deviceId : null
  const selectValue = selected || currentId || ''
  const switching = active && selectValue !== currentId
  const msg = synthetic
    ? {
        text: `Nguồn tổng hợp (debug) ${synthetic.width}×${synthetic.height}: không dùng camera thật.`,
        error: false,
      }
    : cameraMessage(snap)

  // UX-01: hướng dẫn đọc ở nhịp 250 ms và ngay khi camera hay cài đặt đổi; chuỗi JSON để so sánh theo giá trị.
  const subscribeGuide = useCallback(
    (cb: () => void) => {
      const offTick = subscribeTick(cb)
      const offCam = camera.subscribe(cb)
      const offStore = store.subscribe(cb)
      return () => {
        offTick()
        offCam()
        offStore()
      }
    },
    [camera, store],
  )
  const guideJson = useSyncExternalStore(subscribeGuide, () => {
    const l = loop.snapshot()
    const s = store.getSnapshot().settings
    const h = hands.snapshot()
    const f = face.snapshot()
    const cam = camera.getSnapshot()
    const phase: CameraPhase = synthetic ? 'synthetic' : cameraPhase(cam, camHist.wasActive)
    return JSON.stringify(
      buildGuidance({
        camera: phase,
        cameraText: synthetic ? undefined : cameraMessage(cam).text,
        source: s.windowSource,
        hands: s.windowSource !== 'hands' ? 'off' : h.fake ? 'ready' : workerPhase(h.client),
        handsSeen: h.latest?.hands.length ?? 0,
        face: workerPhase(f),
        reveal: l.reveal,
        status: l.output.status,
        limited: l.output.reveal?.limited ?? false,
        fingers: l.fingers,
        fingerConfig: s.fingers,
        subject: l.output.faces[0]
          ? { subjectType: l.output.faces[0].subjectType, confidence: l.output.faces[0].confidence }
          : null,
      }),
    )
  })
  const guidance = JSON.parse(guideJson) as ReturnType<typeof buildGuidance>
  // CLS-01: chỉ báo đang thu trên canvas (cả khi toàn màn hình), đọc từ recorder.
  const rec = useSyncExternalStore(recorder.subscribe, recorder.snapshot)
  // LOG-02: trạng thái nhật ký ở thanh trên.
  const logSnap = useSyncExternalStore(localLog.subscribe, localLog.snapshot)
  const keys = stage.settings.windowSource === 'mouse' ? MOUSE_KEYS : null

  function onStart() {
    // Chỉ từ handler bấm nút: CameraSource.start() gọi gate (assertCameraAllowed) rồi mới getUserMedia.
    void camera.start(selectValue || null)
  }

  function onStop() {
    camera.stop()
  }

  function onRevoke() {
    camera.stop()
    revokeConsent()
    navigate('/', { replace: true })
  }

  const rootClass = [
    'stage',
    fs.active && 'fullscreen',
    ui.present && 'present',
    overlay && 'overlay',
    idle && 'idle',
  ]
    .filter(Boolean)
    .join(' ')
  const tone = synthetic ? 'on' : statusTone(snap)
  return (
    <div className={rootClass} ref={rootRef}>
      <div className="chrome">
        <header className="bar top">
          <Link to="/" className="brand" title="Về trang chào">
            <BrandMark />
            Web Camera Tracking
          </Link>
          <span className="sep" aria-hidden="true" />
          <span className="field">
            Camera
            <select
              aria-label="Chọn camera"
              value={selectValue}
              onChange={(e) => setSelected(e.target.value)}
              disabled={requesting}
            >
              <option value="">Mặc định</option>
              {snap.devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          </span>
          {active && !switching ? (
            <button type="button" onClick={onStop}>
              Dừng camera
            </button>
          ) : (
            <button
              type="button"
              className="primary"
              onClick={onStart}
              disabled={!consented || requesting || synthetic !== null}
            >
              {switching ? 'Đổi camera' : 'Bật camera'}
            </button>
          )}
          <span className={`status ${tone}`} role="status" aria-live="polite" title={msg.text}>
            <span className="dot" aria-hidden="true" />
            <span className="text">{msg.text}</span>
          </span>
          {logSnap.enabled && (
            <span
              className="hint"
              data-testid="log-stat"
              style={{ whiteSpace: 'nowrap' }}
              title="Nhật ký cục bộ (LOG-02): chỉ sự kiện metadata trong trình duyệt này; tắt thì không hiện để thanh không xuống dòng"
            >
              nhật ký bật · {logSnap.count}
            </span>
          )}
          <span className="right">
            <button
              type="button"
              aria-expanded={ui.settingsOpen}
              aria-controls="settings-panel"
              onClick={() => setUi({ settingsOpen: !ui.settingsOpen })}
            >
              Cài đặt
            </button>
            <button
              type="button"
              aria-expanded={ui.debugOpen}
              aria-controls="debug-panel"
              onClick={() => setUi({ debugOpen: !ui.debugOpen })}
            >
              Debug
            </button>
            <button
              type="button"
              aria-pressed={ui.present}
              title="Mọi điều khiển thành lớp nổi tự ẩn; canvas chiếm cả màn"
              onClick={() => setUi({ present: !ui.present })}
            >
              Trình diễn
            </button>
            {fs.supported && (
              <button type="button" title="Phím F" onClick={fs.toggle}>
                {fs.active ? 'Thoát toàn màn hình' : 'Toàn màn hình'}
              </button>
            )}
            <button type="button" className="link" onClick={onRevoke}>
              Thu hồi đồng ý
            </button>
          </span>
        </header>
      </div>
      <div className="body">
        <div className="main">
          <div className="view">
            <canvas id="stage" ref={canvasRef} aria-label="Màn pixel trắng" />
            <Guide guidance={guidance} keys={keys} hud={overlay} />
            {rec.recording && (
              <div
                className="rec-badge"
                data-testid="dataset-indicator"
                role="status"
                aria-live="polite"
              >
                <span className="rec-dot" aria-hidden="true" />
                Đang thu dữ liệu · {rec.count} mẫu
              </div>
            )}
          </div>
          <DebugPanel
            open={ui.debugOpen}
            id="debug-panel"
            camera={camera}
            store={store}
            loop={loop}
            face={face}
            hands={hands}
            handWindow={handWindow}
            stats={stats}
            probes={probes}
            classifier={classifier}
          />
        </div>
        <SettingsPanel
          store={store}
          handDelegate={handDelegate}
          open={ui.settingsOpen}
          id="settings-panel"
          recorder={recorder}
          dataset={{
            pickDirectory: directorySinkSupported() ? pickDirectorySink : null,
            download: downloadBytes,
          }}
          log={{ log: localLog, download: downloadBytes }}
        />
      </div>
      {overlay && <div className="present-hint" aria-hidden="true" />}
    </div>
  )
}

/** UX-03: tone của pill trạng thái camera theo pha (chấm xám, hổ phách, xanh, đỏ). */
function statusTone(s: CameraSnapshot): 'off' | 'wait' | 'on' | 'warn' | 'error' {
  switch (s.state.status) {
    case 'idle':
      return 'off'
    case 'requesting':
      return 'wait'
    case 'active':
      return s.hidden || s.stalled ? 'warn' : 'on'
    default:
      return 'error'
  }
}

function workerPhase(w: { ready: boolean; failed: boolean }): WorkerPhase {
  if (w.failed) return 'error'
  if (w.ready) return 'ready'
  return 'loading'
}

function cameraMessage(s: CameraSnapshot): { text: string; error: boolean } {
  const st = s.state
  switch (st.status) {
    case 'idle':
      return { text: 'Camera chưa bật.', error: false }
    case 'requesting':
      return { text: 'Đang xin quyền camera…', error: false }
    case 'active': {
      if (s.hidden)
        return { text: 'Tab đang ẩn: vùng mở sẽ đóng cho tới khi quay lại.', error: false }
      if (s.stalled)
        return {
          text: `Camera không cấp frame (quá ${DEFAULTS.camera.noFrameWatchdogMs} ms không có frame mới).`,
          error: true,
        }
      const fps = st.frameRate ? ` @ ${Math.round(st.frameRate)} fps` : ''
      return { text: `Camera đang chạy ${st.width}×${st.height}${fps}.`, error: false }
    }
    case 'ended':
      return {
        text:
          st.reason === 'device-removed'
            ? 'Camera đã bị rút. Bấm Bật camera để chạy lại.'
            : 'Camera đã dừng (track kết thúc). Bấm Bật camera để chạy lại.',
        error: true,
      }
    case 'error':
      return { text: errorText(st.kind, st.message), error: true }
  }
}

function errorText(kind: CameraErrorKind, message: string): string {
  switch (kind) {
    case 'not-allowed':
      return 'Bạn đã từ chối quyền camera. Cho phép camera trong trình duyệt rồi bấm lại.'
    case 'not-found':
      return 'Không tìm thấy camera nào.'
    case 'overconstrained':
      return 'Camera không đáp ứng cấu hình yêu cầu. Chọn camera khác.'
    case 'not-readable':
      return 'Không đọc được camera (đang bị ứng dụng khác dùng?).'
    case 'gate':
      return `Không bật được camera: ${message}`
    default:
      return `Lỗi camera: ${message}`
  }
}
