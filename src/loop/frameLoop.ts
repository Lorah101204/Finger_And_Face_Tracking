// Vòng lặp mỗi frame (mục 4.4). ROI-00 dựng khung: bước 3 (WindowSource), 4 (buildMask một lần, RevealState, epoch)
// và 5 (compositor). MASK-01: compositor.render vẽ camera từ FrameSource.drawable chỉ trong stageRect. MASK-02: bước 6,
// buffer giới hạn theo nhịp khi vùng mở và nguồn có frame mới. FACE-01: gửi buffer cho FaceClient khi worker rảnh,
// accepting theo trạng thái vùng và rejectAll khi đóng hoặc đổi epoch (mục 5.10). FACE-02: kết quả về được validate
// theo mask hiện tại (bước 7), ValidatedFace[] vẽ ở bước 5 của frame kế, xóa khi đóng hoặc đổi epoch, hết hạn khi
// worker ngừng trả; FrameOutput (bước 8) phát qua events. HAND-01: bước 2, khi nguồn cửa sổ là tay thì mỗi frame
// feed HandPipeline (gửi frame gốc cho hand.worker khi rảnh) và vẽ overlay debug tay từ HandFrame mới nhất; chưa có
// HandWindowSource nên cửa sổ vẫn đóng tới ROI-01. ROI-03: các đầu ngón từ HandFrame mới nhất (hands/fingers.ts), lý do
// đóng theo mục 5.8, chấm đầu ngón trong overlay, FrameOutput.points và hướng dẫn thiếu điểm. ROI-01: nguồn tay là
// HandWindowSource (sources.hands): mỗi frame trả cửa sổ đã giải (squareSolver) hoặc lý do đóng, kèm các đầu ngón của
// frame (WindowSample.fingers) nên vòng lặp không tự đánh giá điểm nữa. INT-01: CloseGate (camera dừng, đổi camera,
// watchdog, tab ẩn) đóng vùng với no-camera hoặc tab-hidden, ngay khi có sự kiện (tab ẩn thì rAF không chạy) và ở
// mỗi frame; đổi nguồn cửa sổ là đổi cấu hình (store epoch++, đóng config-changed). CLS-02 nối ClassifierClient.
// Chạy bằng requestAnimationFrame; camera cấp FrameStamp riêng qua FrameSource.lastStamp.
import { DEFAULTS } from '../core/config'
import type { EpochCounter } from '../core/epoch'
import { createLatencyWindow, type LatencyStats } from '../core/latency'
import { closedState, stepReveal } from '../core/revealState'
import type {
  ClassifyResult,
  CloseReason,
  FaceResult,
  FrameOutput,
  HandFrame,
  Rect,
  RestrictedFrame,
  RevealMask,
  RevealState,
  FingerStatus,
  ValidatedFace,
} from '../core/types'
import type { FrameSource } from '../camera/frameSource'
import type { Probes } from '../debug/probes'
import type { FaceClient, PendingTask } from '../face/faceClient'
import { validateFace, type RejectReason } from '../face/faceValidate'
import type { HandPipeline } from '../hands/handPipeline'
import { listCells } from '../core/cells'
import { fingertipsGuidance, toPoints } from '../hands/fingertips'
import type { ClassifierClient, ClassifyTask } from '../classify/classifierClient'
import { decideSubject } from '../classify/subjectRule'
import { buildMask } from '../mask/buildMask'
import { render } from '../mask/compositor'
import type { RestrictedFrameBuilder, RestrictedStats } from '../mask/restrictedFrame'
import { noWindow, type WindowSource, type WindowSourceKind } from '../reveal/windowSource'
import type { CloseGate } from './closeGate'
import type { StageStore } from './store'

export type FaceGateStats = {
  /** Số kết quả qua validate (kể cả kết quả 0 mặt). */
  accepted: number
  /** Số mặt bị bỏ vì bbox không giao mask hiện tại. */
  facesDropped: number
  rejected: Record<RejectReason, number>
  /**
   * QA-01: kết quả hợp lệ gần nhất: tác vụ nào, ROI camera của tác vụ đó và tuổi lúc nhận, để e2e kiểm rằng kết quả
   * của tác vụ cũ vẫn được ánh xạ theo ROI cũ khi cửa sổ đã dời (mục 7.1).
   */
  lastAccepted: { taskId: number; epoch: number; roiCam: Rect; ageMs: number; faces: number } | null
}

/** CLS-02: kết quả phân loại gần nhất được gate nhận cho epoch đang mở. */
export type SubjectLabel = {
  epoch: number
  taskId: number
  frameId: number
  /** [person, mannequin] */
  probs: number[]
  roiShortPx: number
  /** performance.now() lúc nhận và tuổi kết quả lúc nhận */
  at: number
  ageMs: number
}

export type ClassifyGateStats = {
  accepted: number
  rejected: Record<RejectReason, number>
  last: SubjectLabel | null
}

export type LoopSnapshot = {
  running: boolean
  frames: number
  reveal: RevealState
  mask: RevealMask | null
  epoch: number
  lastTs: number
  /** MASK-02: bản sao thống kê của builder; null khi vòng lặp không có builder. */
  restricted: RestrictedStats | null
  /** FACE-02: FrameOutput của frame gần nhất. */
  output: FrameOutput
  faceGate: FaceGateStats
  /** CLS-02: gate phân loại và nhãn đang gắn (null khi chưa có, đóng vùng hay hết hạn). */
  classifyGate: ClassifyGateStats
  subject: SubjectLabel | null
  /** HAND-01: hand pipeline đang chạy (nguồn cửa sổ là tay) và HandFrame mới nhất. */
  handsActive: boolean
  hands: HandFrame | null
  /** ROI-03: các đầu ngón của frame gần nhất; rỗng với nguồn chuột. */
  fingers: FingerStatus[]
  /** PERF-01: thời gian vẽ (render) và cả tick, ms, cửa sổ 120 frame. */
  timing: { render: LatencyStats; tick: LatencyStats }
}

export type FrameLoop = {
  /** Gắn canvas và bắt đầu rAF; gọi lại với canvas khác thì đổi canvas. */
  attach(canvas: HTMLCanvasElement): void
  /** Dừng rAF, đóng vùng mở (lý do user), bỏ canvas. */
  detach(): void
  snapshot(): LoopSnapshot
  /** FACE-02 bước 5: phát CustomEvent 'frame' với detail là FrameOutput sau mỗi frame. */
  events: EventTarget
}

/** MASK-02: builder và cách tiêu thụ buffer. */
export type RestrictedFeed = {
  builder: RestrictedFrameBuilder
  /** Nhịp tạo buffer tối đa (Hz), mặc định face.targetHz; INT-01 thay bằng nhịp và cờ rảnh của từng worker. */
  targetHz?: number
  /** Nhận buffer khi không có FaceClient; mặc định đóng bitmap ngay. */
  consume?: (frame: RestrictedFrame) => void
}

export type FrameLoopDeps = {
  store: StageStore
  epoch: EpochCounter
  /** Nguồn cửa sổ theo loại (ROI-01: hands là HandWindowSource); vòng lặp chọn theo settings.windowSource mỗi frame. */
  sources: Partial<Record<WindowSourceKind, WindowSource>>
  /** Frame camera gốc (CameraSource, hoặc SyntheticCameraSource ở TEST-00); drawable null khi chưa active. */
  frame: FrameSource
  /** TEST-00: probe output (chỉ đọc ngược khi bật và có listener). */
  probes?: Probes
  /** MASK-02: bỏ trống thì vòng lặp không tạo buffer (ROI-00, MASK-01 vẫn chạy). */
  restricted?: RestrictedFeed
  /** FACE-01: nhận buffer khi rảnh; vòng lặp bật/tắt accepting và rejectAll theo vùng mở. */
  face?: FaceClient
  /** CLS-02: nhận bitmap thứ hai của cùng crop khi rảnh (3 đến 5 Hz, cạnh ROI ≥ minRoiPx); cùng gate epoch, tuổi, mask. */
  classifier?: ClassifierClient
  /** HAND-01: nhận frame gốc mỗi frame khi settings.windowSource là 'hands'; reset khi rời nguồn tay. */
  hands?: HandPipeline
  /** INT-01: lý do đóng theo camera và tab (no-camera, tab-hidden); đóng ngay khi gate báo, không chờ frame kế. */
  gate?: CloseGate
}

export const EMPTY_OUTPUT: FrameOutput = {
  epoch: 0,
  frameId: -1,
  ts: 0,
  status: 'covered',
  reveal: null,
  points: [],
  faces: [],
}

export function createFrameLoop(deps: FrameLoopDeps): FrameLoop {
  const { store, epoch, sources, frame, probes, restricted, face, hands, gate, classifier } = deps
  const consume = restricted?.consume ?? ((f: RestrictedFrame) => f.input.close())
  const buildIntervalMs = 1000 / (restricted?.targetHz ?? DEFAULTS.face.targetHz)
  // FACE-02: mặt giữ tới kết quả kế; hết hạn nếu worker ngừng trả (4 lần tuổi tối đa) để overlay không đứng hình.
  const faceExpiryMs = DEFAULTS.freshness.faceResultMaxAgeMs * 4
  const events = new EventTarget()
  let canvas: HTMLCanvasElement | null = null
  let ctx: CanvasRenderingContext2D | null = null
  let raf = 0
  let frames = 0
  let lastTs = 0
  let reveal: RevealState = closedState('user')
  let lastLayout = store.getSnapshot().layout
  let lastMirror = store.getSnapshot().settings.mirror
  let lastFingers = store.getSnapshot().settings.fingers
  let fingers: FingerStatus[] = []
  let lastSource: WindowSource | null = null
  let nextTaskId = 1
  let lastBuiltFrameId = -1
  let lastBuildAt = -Infinity
  let lastOpenEpoch = -1
  let faces: ValidatedFace[] = []
  let facesAt = -Infinity
  // CLS-02: nhãn gần nhất của epoch đang mở; gắn vào mặt qua decideSubject, hết hạn theo classifier.labelMaxAgeMs.
  let subject: SubjectLabel | null = null
  let lastClassifyAt = -Infinity
  const classifyGate: ClassifyGateStats = {
    accepted: 0,
    rejected: { epoch: 0, 'rejected-task': 0, stale: 0, 'no-mask': 0 },
    last: null,
  }
  let output: FrameOutput = EMPTY_OUTPUT
  const faceGate: FaceGateStats = {
    accepted: 0,
    facesDropped: 0,
    rejected: { epoch: 0, stale: 0, 'no-mask': 0, 'rejected-task': 0 },
    lastAccepted: null,
  }
  // PERF-01: đo thời gian vẽ và tick (không cấp phát mỗi frame: cửa sổ ghi vòng).
  const renderWin = createLatencyWindow(120)
  const tickWin = createLatencyWindow(120)

  function close(reason: CloseReason): void {
    reveal = stepReveal(reveal, { kind: 'close', reason }, epoch).state
  }

  // FACE-01/02: vùng vừa đóng, vừa mở, hoặc mở lại với epoch mới → xóa mặt, loại tác vụ cũ, accepting theo trạng
  // thái mới (mục 4.4 bước 4, mục 4.6, mục 5.10). Kết quả của tác vụ đã loại về sau sẽ bị bỏ.
  function syncFaceGate(): void {
    const openEpoch = reveal.kind === 'open' ? reveal.mask.epoch : -1
    if (openEpoch === lastOpenEpoch) return
    lastOpenEpoch = openEpoch
    faces = []
    facesAt = -Infinity
    subject = null
    if (face) {
      face.rejectAll()
      face.setAccepting(openEpoch >= 0)
    }
    if (classifier) {
      classifier.rejectAll()
      classifier.setAccepting(openEpoch >= 0)
      // CLS-02: worker phân loại khởi tạo lười khi vùng mở lần đầu (nạp ORT và model chỉ khi cần; trang không mở
      // vùng không tốn wasm), khác worker mặt khởi tạo lúc mount.
      if (openEpoch >= 0 && !classifier.started) classifier.start()
    }
  }

  function emitOutput(now: number, mask: RevealMask | null): void {
    output = {
      epoch: epoch.current,
      frameId: frame.lastStamp?.frameId ?? -1,
      ts: now,
      status: statusOf(mask, faces),
      reveal: mask
        ? {
            shape: mask.shape,
            box: mask.box,
            cells: listCells(mask),
            stageRect: mask.stageRect,
            cameraRect: mask.cameraRect,
            limited: mask.limited,
          }
        : null,
      points: toPoints(fingers),
      faces: mask ? faces : [],
    }
    events.dispatchEvent(new CustomEvent<FrameOutput>('frame', { detail: output }))
  }

  // INT-01: gate báo (tab ẩn, camera dừng) → đóng ngay trong sự kiện, vẽ trắng và phát FrameOutput, vì tab ẩn thì
  // requestAnimationFrame không chạy và kết quả mặt về sau phải bị loại theo epoch mới.
  function closeNow(reason: CloseReason): void {
    if (reveal.kind !== 'open') return
    close(reason)
    syncFaceGate()
    fingers = []
    const { layout, settings } = store.getSnapshot()
    if (ctx) {
      render(ctx, layout, {
        showLines: settings.showLines,
        mirror: settings.mirror,
        drawable: null,
        mask: null,
        faces: [],
        hands: null,
        fingers: [],
      })
    }
    emitOutput(performance.now(), null)
  }
  gate?.subscribe(() => {
    const reason = gate.reason()
    if (reason) closeNow(reason)
  })

  // Bước 7 (FACE-02): kết quả về bất đồng bộ, validate theo epoch, tuổi, mask hiện tại và taskId đã loại (mục 5.10).
  // Kết quả hợp lệ (kể cả 0 mặt) thay danh sách mặt đang hiển thị.
  function onFaceResult(result: FaceResult, task: PendingTask): void {
    const { layout, settings } = store.getSnapshot()
    const now = performance.now()
    const out = validateFace(result, task, {
      currentMask: reveal.kind === 'open' ? reveal.mask : null,
      currentEpoch: epoch.current,
      now,
      layout,
      mirror: settings.mirror,
      rejectedUpTo: face?.rejectedUpTo ?? -1,
      // QA-01: kịch bản faceMaxAge (chỉ ?debug=1) nới tuổi tối đa; 0 là mặc định.
      maxAgeMs: probes && probes.faceMaxAgeMs > 0 ? probes.faceMaxAgeMs : undefined,
    })
    if (out.kind === 'rejected') {
      faceGate.rejected[out.reason]++
      return
    }
    faceGate.accepted++
    faceGate.facesDropped += out.dropped
    faceGate.lastAccepted = {
      taskId: task.taskId,
      epoch: task.epoch,
      roiCam: { ...task.roiCam },
      ageMs: now - result.ts,
      faces: out.faces.length,
    }
    faces = labelFaces(out.faces)
    facesAt = now
  }
  face?.subscribeResults(onFaceResult)

  /** CLS-02 bước 5: nhãn của epoch hiện tại gắn vào từng mặt qua quy tắc unknown (không dùng chuyển động). */
  function labelFaces(list: ValidatedFace[]): ValidatedFace[] {
    return list.map((f) => {
      const d = decideSubject({
        probs: subject?.probs ?? null,
        roiShortPx: subject?.roiShortPx ?? 0,
        faceStatus: f.status,
        visible: f.visible,
      })
      return { ...f, subjectType: d.subjectType, confidence: d.confidence }
    })
  }

  // CLS-02: kết quả phân loại về bất đồng bộ, cùng gate epoch, taskId đã loại, tuổi và vùng mở như mặt (mục 5.11).
  function onClassifyResult(result: ClassifyResult, task: ClassifyTask): void {
    const now = performance.now()
    const reason: RejectReason | null =
      result.epoch !== epoch.current
        ? 'epoch'
        : result.taskId <= (classifier?.rejectedUpTo ?? -1)
          ? 'rejected-task'
          : now - task.ts > DEFAULTS.classifier.resultMaxAgeMs
            ? 'stale'
            : reveal.kind !== 'open'
              ? 'no-mask'
              : null
    if (reason) {
      classifyGate.rejected[reason]++
      return
    }
    classifyGate.accepted++
    subject = {
      epoch: result.epoch,
      taskId: result.taskId,
      frameId: result.frameId,
      probs: [...result.probs],
      roiShortPx: Math.min(task.roiCam.w, task.roiCam.h),
      at: now,
      ageMs: now - result.ts,
    }
    classifyGate.last = subject
    faces = labelFaces(faces)
  }
  classifier?.subscribeResults(onClassifyResult)

  function tick(now: number): void {
    raf = requestAnimationFrame(tick)
    const tickStart = performance.now()
    const { layout, settings } = store.getSnapshot()
    const source = sources[settings.windowSource] ?? null

    // Bước 2 (HAND-01): hand pipeline chạy khi nguồn cửa sổ là tay; frame gốc đi thẳng tới hand.worker (được phép).
    // Rời nguồn tay thì xóa track và HandFrame (cả kết quả về muộn sau đó).
    const handsActive = settings.windowSource === 'hands'
    if (hands) {
      if (handsActive) hands.feed(frame, epoch.current, now)
      else if (hands.latest) hands.reset()
    }

    // Đổi cấu hình (layout mới, mirror, đầu ngón dùng) hay đổi nguồn: cửa sổ đang mở đóng ngay frame này (mục 4.6, UC-03).
    if (
      layout !== lastLayout ||
      settings.mirror !== lastMirror ||
      settings.fingers !== lastFingers
    ) {
      lastLayout = layout
      lastMirror = settings.mirror
      lastFingers = settings.fingers
      if (reveal.kind === 'open') close('config-changed')
    }
    if (source !== lastSource) {
      lastSource = source
      if (reveal.kind === 'open') close('config-changed')
    }

    // Bước 3: gate camera và tab (INT-01) đi trước; rồi nguồn cửa sổ (chuột, hoặc HandWindowSource: fingers →
    // hullSolver, kèm các đầu ngón của frame này).
    const gateReason = gate?.reason() ?? null
    const sample = gateReason
      ? noWindow(gateReason)
      : source
        ? source.current(now)
        : noWindow('user')
    fingers = sample.fingers ?? []
    if (sample.shape && layout.c > 0) {
      // Bước 4: buildMask một lần; đa giác rasterize với hysteresis ô so với mask của frame trước cùng phiên mở
      // (ROI-02); tập ô rỗng (đa giác quá mảnh) thì đóng too-small.
      const shape = sample.shape
      const prevMask = reveal.kind === 'open' ? reveal.mask : null
      reveal = stepReveal(
        reveal,
        {
          kind: 'open',
          build: (ep) =>
            buildMask(shape, layout, settings.mirror, ep, {
              limited: sample.limited,
              prev: prevMask,
              hysteresisCells: settings.sensitivity.hysteresisCells,
            }),
        },
        epoch,
      ).state
      if (reveal.kind === 'open' && reveal.mask.cellCount === 0) close('too-small')
    } else {
      close(sample.shape ? 'config-changed' : sample.reason)
    }

    syncFaceGate()
    if (faces.length > 0 && now - facesAt > faceExpiryMs) faces = []
    if (subject && now - subject.at > DEFAULTS.classifier.labelMaxAgeMs) {
      subject = null
      faces = labelFaces(faces)
    }
    const mask = reveal.kind === 'open' ? reveal.mask : null

    if (ctx) {
      const r0 = performance.now()
      render(ctx, layout, {
        showLines: settings.showLines,
        mirror: settings.mirror,
        drawable: frame.drawable,
        mask,
        faces,
        hands: handsActive && hands ? hands.latest : null,
        now,
        fingers,
      })
      renderWin.push(performance.now() - r0)
      probes?.emitOutputFrame(ctx, { epoch: epoch.current, frameId: frames, ts: now })
    }

    // Bước 6 (MASK-02, FACE-01): buffer giới hạn khi vùng mở, nguồn có frame mới, tới nhịp và có nơi nhận: worker
    // mặt rảnh (FaceClient.canAccept) hoặc probe muốn đọc; không có FaceClient thì theo nhịp cố định. Vẽ output
    // trước để buffer không bao giờ chờ vẽ. taskId chỉ được tiêu khi builder trả ok; too-small không tạo tác vụ.
    // Buffer gửi được thì đếm faceDetectSubmitted, không gửi được (chưa sẵn sàng, bận) thì faceDetectDropped.
    if (restricted && mask) {
      const stamp = frame.lastStamp
      const wantFace = face ? face.canAccept() : false
      const wantProbe = probes?.wantsRestrictedFrame(now) ?? false
      // CLS-02: bitmap thứ hai của cùng crop cho classifier khi rảnh, đến nhịp 3 đến 5 Hz và cạnh ROI đủ lớn.
      const wantCls =
        !!classifier &&
        classifier.canAccept() &&
        now - lastClassifyAt >= classifier.minIntervalMs() &&
        Math.min(mask.cameraRect.w, mask.cameraRect.h) >= DEFAULTS.classifier.minRoiPx
      const forFace = wantFace || wantProbe || !face
      const copies = (forFace ? 1 : 0) + (wantCls ? 1 : 0)
      const interval = face ? Math.max(buildIntervalMs, face.minIntervalMs()) : buildIntervalMs
      if (
        stamp &&
        frame.drawable &&
        stamp.frameId !== lastBuiltFrameId &&
        now - lastBuildAt >= interval &&
        copies > 0
      ) {
        lastBuiltFrameId = stamp.frameId
        lastBuildAt = now
        const r = restricted.builder.build(frame, mask, stamp, epoch.current, nextTaskId, copies)
        if (r.kind === 'ok') {
          nextTaskId++
          let i = 0
          if (forFace) {
            const f = r.frames[i++]
            if (!face) consume(f)
            else if (face.submit(f) === 'submitted') {
              if (probes) probes.counters.faceDetectSubmitted++
            } else if (probes) probes.counters.faceDetectDropped++
          }
          if (wantCls && classifier) {
            const c = r.frames[i]
            if (c && classifier.submit(c) === 'submitted') {
              lastClassifyAt = now
              if (probes) probes.counters.classifierSubmitted++
            }
          }
        }
      }
    }

    // Bước 8 (FACE-02): FrameOutput cho lớp ngoài; dữ liệu xuất chịu cùng gate với overlay (mặt đã validate).
    emitOutput(now, mask)
    frames++
    lastTs = now
    tickWin.push(performance.now() - tickStart)
  }

  return {
    events,
    attach(next) {
      if (canvas === next && raf) return
      canvas = next
      ctx = next.getContext('2d')
      if (!raf) raf = requestAnimationFrame(tick)
    },
    detach() {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      if (reveal.kind === 'open') close('user')
      canvas = null
      ctx = null
    },
    snapshot() {
      return {
        running: raf !== 0,
        frames,
        reveal,
        mask: reveal.kind === 'open' ? reveal.mask : null,
        epoch: epoch.current,
        lastTs,
        restricted: restricted ? { ...restricted.builder.stats } : null,
        output,
        classifyGate: { ...classifyGate, rejected: { ...classifyGate.rejected } },
        subject,
        faceGate: {
          ...faceGate,
          rejected: { ...faceGate.rejected },
          lastAccepted: faceGate.lastAccepted
            ? { ...faceGate.lastAccepted, roiCam: { ...faceGate.lastAccepted.roiCam } }
            : null,
        },
        handsActive: store.getSnapshot().settings.windowSource === 'hands',
        hands: hands?.latest ?? null,
        fingers: fingers.map((s) => ({ ...s })),
        timing: { render: renderWin.stats(), tick: tickWin.stats() },
      }
    },
  }
}

/** FACE-02 bước 4: trạng thái vùng theo mục 4.6 và 5.7. too-small tính từ mask hiện tại (cạnh ngắn cameraRect). */
export function statusOf(
  mask: RevealMask | null,
  faces: readonly ValidatedFace[],
): FrameOutput['status'] {
  if (!mask) return 'covered'
  if (Math.min(mask.cameraRect.w, mask.cameraRect.h) < DEFAULTS.face.minRoiPx) return 'too-small'
  if (faces.some((f) => f.status === 'partial')) return 'partial-face'
  return faces.length > 0 ? 'face-candidate' : 'searching'
}

/**
 * Thông điệp gợi ý cho người dùng theo trạng thái (UX-01 tinh chỉnh câu chữ và vị trí). HAND-02 bước 5: vùng đang
 * che với nguồn tay thì nêu điểm còn thiếu ("đưa hai tay vào khung hình"). ROI-01 bước 4: đủ điểm mà đóng vì
 * too-small thì bảo tách tay; cửa sổ bị kẹp ở mép bảng thì nói rõ (limited).
 */
export function statusMessage(
  output: FrameOutput,
  fingers: readonly FingerStatus[] = [],
  closeReason: CloseReason | null = null,
): string {
  if (output.status === 'covered' && fingers.length > 0) {
    const guide = fingertipsGuidance(fingers)
    if (guide) return guide
    if (closeReason === 'too-small')
      return 'Các đầu ngón quá gần nhau: xòe ngón hoặc tách hai tay ra để cửa sổ đủ cỡ.'
    return 'Đủ đầu ngón: đang mở cửa sổ theo tay…'
  }
  const limited = output.reveal?.limited ? ' Cửa sổ chạm mép bảng (bị kẹp).' : ''
  switch (output.status) {
    case 'covered':
      if (closeReason === 'tab-hidden') return 'Vùng đang che: tab đang ẩn, mở lại khi quay về tab.'
      if (closeReason === 'no-camera') return 'Vùng đang che: camera chưa cấp frame.'
      return 'Vùng đang che: mở cửa sổ để bắt đầu.'
    case 'searching':
      return `Đang tìm khuôn mặt trong vùng mở…${limited}`
    case 'too-small':
      return `Cửa sổ quá nhỏ cho mặt: mở rộng vùng.${limited}`
    case 'face-candidate':
      return `Thấy khuôn mặt trong vùng mở.${limited}`
    case 'partial-face':
      return `Khuôn mặt bị cắt: mở rộng vùng.${limited}`
  }
}

/** Dòng mô tả ngắn cho thanh debug (chuỗi để useSyncExternalStore so sánh theo giá trị). */
export function describeReveal(s: LoopSnapshot): string {
  if (s.reveal.kind === 'closed') return `đóng: ${s.reveal.reason}`
  const m = s.reveal.mask
  if (m.shape.kind === 'window') {
    const w = m.shape.window
    return `mở n=${w.n} tại (${w.col}, ${w.row})${m.limited ? ' · kẹp mép' : ''}`
  }
  const b = m.box
  return `mở đa giác ${m.cellCount} ô, hộp (${b.col}, ${b.row}) ${b.w}×${b.h}`
}

/** MASK-02: số tác vụ đã tạo, cỡ crop gần nhất và gợi ý mở rộng khi cửa sổ quá nhỏ cho mặt (mục 5.9). */
export function describeRestricted(s: LoopSnapshot): string {
  const r = s.restricted
  if (!r) return 'buffer: không có'
  const crop = r.lastCrop ? ` · crop ${r.lastCrop.w}×${r.lastCrop.h}` : ''
  const small =
    s.reveal.kind === 'open' && r.lastKind === 'too-small'
      ? ` · cửa sổ quá nhỏ cho mặt (cạnh dưới ${DEFAULTS.face.minRoiPx} px), mở rộng thêm`
      : ''
  const g = s.faceGate
  const gate = ` · mặt qua gate ${g.accepted}, loại epoch ${g.rejected.epoch}, cũ ${g.rejected.stale}, không mask ${g.rejected['no-mask']}`
  return `buffer: ${r.builds} tác vụ${crop}${small}${gate}`
}
