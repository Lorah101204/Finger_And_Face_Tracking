import { expect, test, type Page } from '@playwright/test'

// Tiện ích chung cho e2e (WEB-00, CAM-01, GRID-01). Định tuyến hash (D-020): trang chào là "/" hoặc "/#/",
// sân khấu là "/#/app". window.__wct do src/debug/*Probe.ts cài; kiểu ở đây là bản rút gọn đủ cho test.
export type CameraProbe = {
  frames: number
  lastFrameId: number
  gaps: number
  duplicates: number
  firstTs: number
  lastTs: number
  fps: number
}
export type CameraSnap = {
  state: { status: string; deviceId?: string; reason?: string; width?: number; height?: number }
  stalled: boolean
  hidden: boolean
  epoch: number
  devices: { deviceId: string; label: string }[]
}
type Rect = { x: number; y: number; w: number; h: number }
export type StageSnap = {
  settings: {
    cols: number
    rows: number
    showLines: boolean
    mirror: boolean
    windowSource: 'mouse' | 'hands'
    handednessSwap: boolean
    fingers: number[]
    raisedOnly: boolean
    sensitivity: {
      minCutoff: number
      beta: number
      hysteresisCells: number
      nMin: number
      pointMaxAgeMs: number
    }
  }
  stageSize: { w: number; h: number }
  camSize: { w: number; h: number } | null
  layout: {
    c: number
    cols: number
    rows: number
    board: Rect
    scale: number
    stage: { w: number; h: number }
    cam: { w: number; h: number }
    camVisibleRect: Rect
  }
  epoch: number
}
export type RevealWindow = { col: number; row: number; n: number }
export type CellBox = { col: number; row: number; w: number; h: number }
/**
 * ROI-02, ROI-03: hình điều khiển: cửa sổ vuông (chuột, có `window`) hoặc đa giác bao lồi các đầu ngón (tay, có
 * `polygonStage`, px stage). Kiểu nới lỏng (không phân biệt theo kind) để test chuột đọc `shape.window` không cần thu
 * hẹp kiểu.
 */
export type RevealShapeSnap = {
  kind: 'window' | 'polygon'
  window: RevealWindow
  polygonStage: { x: number; y: number }[]
}
export type MaskSnap = {
  epoch: number
  shape: RevealShapeSnap
  box: CellBox
  /** Uint8Array qua evaluate thành object chỉ số → giá trị */
  cells: Record<string, number>
  cellCount: number
  stageRect: Rect
  cameraRect: Rect
  holesCam: Rect[]
  limited: boolean
}
export type RestrictedStatsSnap = {
  builds: number
  bitmaps: number
  tooSmall: number
  noFrame: number
  lastTaskId: number
  lastRoiCam: Rect | null
  lastLetterbox: { scale: number; dx: number; dy: number; size: number } | null
  lastCrop: { w: number; h: number } | null
  lastKind: 'ok' | 'too-small' | 'no-frame' | null
}
export type ValidatedFaceSnap = {
  status: 'full' | 'partial'
  bboxStage: Rect
  landmarksStage: { x: number; y: number }[]
  /** CLS-02: tỉ lệ landmark còn trong vùng mở; nhãn và độ tin cậy theo quy tắc unknown. */
  visible: number
  subjectType: string
  confidence?: number
}
export type FrameOutputSnap = {
  epoch: number
  frameId: number
  ts: number
  status: 'covered' | 'searching' | 'too-small' | 'face-candidate' | 'partial-face'
  reveal: {
    shape: RevealShapeSnap
    box: CellBox
    cells: { col: number; row: number }[]
    stageRect: Rect
    cameraRect: Rect
    limited: boolean
  } | null
  points: {
    hand: 'left' | 'right'
    tip: number
    trackId: number
    valid: boolean
    reason?: string
    pStage: { x: number; y: number }
  }[]
  faces: ValidatedFaceSnap[]
}
/** ROI-03: trạng thái đầu ngón qua loop.snapshot().fingers. */
export type FingerStatusSnap = {
  hand: 'left' | 'right'
  trackId: number
  tip: number
  valid: boolean
  reason?: string
  pStage: { x: number; y: number }
  pCam: { x: number; y: number }
  ts: number
  ageMs: number
  score: number
}
/** HAND-01: HandFrame và snapshot hand pipeline qua window.__wct.hands. */
export type HandTrackSnap = {
  id: number
  handedness: 'left' | 'right'
  score: number
  palmCenterCam: { x: number; y: number }
  bboxCam: Rect
  landmarksCam: { x: number; y: number }[]
  landmarksWorld?: { x: number; y: number; z: number }[]
  /** ROI-04: ngón duỗi/gập theo track. */
  pose?: Record<
    number,
    {
      raised: boolean
      ratio: number
      angle: number | null
      abduction: number | null
      inPalm: boolean
      streak: number
    }
  >
  lastSeenTs: number
  frameId: number
}
export type HandFrameSnap = {
  frameId: number
  ts: number
  hands: HandTrackSnap[]
  uncertain: boolean
}
export type HandsSnap = {
  client: {
    started: boolean
    ready: boolean
    failed: boolean
    delegate: 'GPU' | 'CPU' | null
    busy: boolean
    pendingFrameId: number | null
    stats: {
      submitted: number
      results: number
      discarded: number
      errors: number
      lastInferMs: number
      p50InferMs: number
      p95InferMs: number
      lastBitmapMs: number
      lastHands: number
      initMs: number
      warmupMs: number
    }
    lastError: string | null
  }
  latest: HandFrameSnap | null
  swap: boolean
  fake: boolean
  stats: { fed: number; skipped: number; results: number }
  tracker: {
    frames: number
    uncertainFrames: number
    created: number
    dropped: number
    relabeled: number
    matched: number
  }
}
export type SubjectSnap = {
  epoch: number
  taskId: number
  frameId: number
  probs: number[]
  roiShortPx: number
  at: number
  ageMs: number
}

export type LoopSnap = {
  running: boolean
  frames: number
  /** PERF-02: số frame có vẽ và số lần buildMask. */
  paints: number
  maskBuilds: number
  /** BRAND-01: lớp logo đang được vẽ. */
  logoVisible: boolean
  reveal: { kind: 'closed'; reason: string } | { kind: 'open'; mask: MaskSnap }
  mask: MaskSnap | null
  epoch: number
  restricted: RestrictedStatsSnap | null
  output: FrameOutputSnap
  classifyGate: {
    accepted: number
    rejected: Record<string, number>
    last: SubjectSnap | null
  }
  subject: SubjectSnap | null
  faceGate: {
    accepted: number
    facesDropped: number
    rejected: Record<string, number>
    /** QA-01: kết quả hợp lệ gần nhất (tác vụ, ROI của tác vụ, tuổi lúc nhận, số mặt). */
    lastAccepted: {
      taskId: number
      epoch: number
      roiCam: Rect
      ageMs: number
      faces: number
    } | null
  }
  handsActive: boolean
  hands: HandFrameSnap | null
  fingers: FingerStatusSnap[]
  /** PERF-01 */
  timing: { render: LatencySnap; tick: LatencySnap }
}
export type LatencySnap = { p50: number; p95: number; n: number; last: number }
/** PERF-01: window.__wct.stats.snapshot() (src/debug/stats.ts). */
export type StatsSnap = {
  fpsOutput: number
  handHz: number
  faceHz: number
  classifierHz: number
  face: { p50: number; p95: number; submitted: number; dropped: number; pending: number }
  hand: { p50: number; p95: number; fed: number; skipped: number }
  render: LatencySnap
  tick: LatencySnap
  epoch: number
  status: FrameOutputSnap['status']
  windowMs: number
  samples: number
  sampledAt: number
}
export type RestrictedMetaSnap = {
  epoch: number
  frameId: number
  ts: number
  taskId: number
  roiCam: Rect
}
/** Phân tích một buffer tại probe onRestrictedFrame (tests/e2e/restricted.spec.ts). */
export type RfAnalysis = {
  w: number
  h: number
  bad: number
  blue: number
  gray: number
  hash: number
  meta: RestrictedMetaSnap
}
export type ProbesSnap = {
  enabled: boolean
  counters: {
    faceDetectSubmitted: number
    faceDetectDropped: number
    classifierSubmitted: number
    restrictedFrames: number
    outputFrames: number
  }
  workerDelayMs: number
  faceMaxAgeMs: number
  minIntervalMs: { restricted: number; output: number }
  onOutputFrame(cb: (img: ImageData) => void): () => void
  onRestrictedFrame(cb: (img: ImageData, meta: RestrictedMetaSnap) => void): () => void
}
export type FaceSnap = {
  ready: boolean
  failed: boolean
  delegate: 'GPU' | 'CPU' | null
  accepting: boolean
  busy: boolean
  pendingTaskId: number | null
  rejectedUpTo: number
  stats: {
    submitted: number
    dropped: number
    results: number
    discarded: number
    errors: number
    lastInferMs: number
    p50InferMs: number
    p95InferMs: number
    lastFaces: number
    initMs: number
    warmupMs: number
  }
  minIntervalMs: number
  lastError: string | null
}
/** ROI-01: tay giả lập (src/debug/fakeHands.ts), px camera chưa mirror. */
export type FakeHandSpec = {
  x: number
  y: number
  spread?: number
  score?: number
  /** ROI-04: ngón đang giơ (mặc định cả năm). */
  raised?: (4 | 8 | 12 | 16 | 20)[]
}
export type FakeHandsSpec = {
  left?: FakeHandSpec | null
  right?: FakeHandSpec | null
  uncertain?: boolean
  ageMs?: number
  jitter?: number
  orbit?: { radius: number; periodMs: number }
}
/** BRAND-01: lớp logo qua window.__wct.logo (src/debug/logoProbe.ts). */
export type LogoSnap = {
  enabled: boolean
  visible: boolean
  ready: boolean
  rect: Rect | null
  /** Ba khung "VERIFY:", "Human", "AI ETHIC CAMPAIGN" trong px stage. */
  frames: Rect[]
  /** D-058: viền khung trên vạch ô (module k × c px); false khi lưới thô và logo giữ cỡ cố định. */
  snapped: boolean
  module: number
}

/** ROI-01: trạng thái HandWindowSource qua window.__wct.handWindow. */
export type HandWindowSnap = {
  solves: number
  resets: number
  lastFrameId: number
  polygon: { x: number; y: number }[] | null
  reason: string | null
  measure: {
    raw: { x: number; y: number }[]
    filtered: { x: number; y: number }[]
    bbox: Rect
    shortCells: number
    areaCells: number
  } | null
}
/** CLS-02: ClassifierClient qua window.__wct.classifier. */
export type ClassifierSnap = {
  started: boolean
  ready: boolean
  failed: boolean
  ep: string | null
  accepting: boolean
  busy: boolean
  pendingTaskId: number | null
  rejectedUpTo: number
  stats: {
    submitted: number
    dropped: number
    results: number
    discarded: number
    errors: number
    lastInferMs: number
    p50InferMs: number
    p95InferMs: number
    initMs: number
    warmupMs: number
    lastProbs: number[]
  }
  minIntervalMs: number
  lastError: string | null
  modelPath: string
}
/** CLS-01: dataset mode qua window.__wct.dataset (src/dataset/recorder.ts). */
export type SampleMetaSnap = {
  id: string
  sessionId: string
  subjectId: string
  label: string
  lighting: string
  mannequinType: string
  ts: number
  capturedAt: string
  epoch: number
  frameId: number
  taskId: number
  cameraRect: Rect
  crop: { w: number; h: number }
  cellsBox: { w: number; h: number }
  cellCount: number
  holes: number
  n: number
  sizeClass: string
  position: string
  edges: string[]
  grid: { w: number; h: number }
  mirror: boolean
}
export type SessionSnap = {
  sessionId: string
  subjectId: string
  label: string
  participantConsent: boolean
  startedAt: string
  stoppedAt: string | null
  samples: number
  app: { consentVersion: string; rateHz: number }
}
export type RecorderSnap = {
  enabled: boolean
  recording: boolean
  session: SessionSnap | null
  count: number
  inMemory: number
  bytes: number
  pending: number
  dropped: number
  rateHz: number
  sink: string | null
  error: string | null
}
/** QA-01: kết quả so buffer với ảnh tham chiếu (installGateAudit). */
/** LOG-02 */
export type LogEventSnap = {
  id?: number
  ts: number
  type: string
  payload: Record<string, unknown>
}
export type LogSnap = {
  enabled: boolean
  count: number
  lastTs: number | null
  pending: number
  storeReady: boolean
  error: string | null
}
export type GateAuditSnap = {
  frames: number
  clean: number
  skipped: number
  pending: number
  maxDiff: number
  dirty: { taskId: number; mismatch: number; maxDiff: number; roiCam: Rect }[]
}
export type ScenarioApi = {
  run(command: string, ...args: unknown[]): unknown
  scene(patch?: object): unknown
  hands(spec: FakeHandsSpec | null): FakeHandsSpec | null
  list(): string[]
}

declare global {
  interface Window {
    __gumCalls: number
    __wct?: {
      camera?: { probe: CameraProbe; snapshot: () => CameraSnap }
      stage?: { snapshot: () => StageSnap }
      loop?: { snapshot: () => LoopSnap; events: EventTarget }
      probes?: ProbesSnap
      face?: { snapshot: () => FaceSnap }
      hands?: { snapshot: () => HandsSnap }
      handWindow?: { snapshot: () => HandWindowSnap }
      logo?: { snapshot: () => LogoSnap }
      stats?: { snapshot: () => StatsSnap }
      classifier?: { snapshot: () => ClassifierSnap }
      /** LOG-02: nhật ký cục bộ (src/debug/logProbe.ts). */
      log?: {
        snapshot: () => LogSnap
        list: (filter?: { type?: string; day?: string }) => Promise<LogEventSnap[]>
        csv: (filter?: { type?: string; day?: string }) => Promise<string>
        clear: () => Promise<void>
        prune: () => Promise<void>
        flush: () => Promise<void>
        appendRaw: (events: LogEventSnap[]) => Promise<number>
      }
      /** QA-02: môi trường trình duyệt (src/debug/envProbe.ts). */
      env?: {
        snapshot: () => {
          ua: string
          browser: { name: string; version: string }
          platform: string
          threads: number
          deviceMemoryGB: number | null
          dpr: number
          secureContext: boolean
          crossOriginIsolated: boolean
          webgl: string | null
          features: Record<string, boolean>
        }
        gpuAdapter: () => Promise<{
          vendor: string
          architecture: string
          description: string
        } | null>
      }
      dataset?: {
        snapshot: () => RecorderSnap
        metas: () => SampleMetaSnap[]
        samples: () => { meta: SampleMetaSnap; png: Blob }[]
        sessions: () => SessionSnap[]
        zip: () => Promise<Uint8Array>
      }
    }
    __scenario?: ScenarioApi
    __outCount?: number
    __outSize?: number[]
    __rfCount?: number
    __rf?: RfAnalysis
    __frameEvents?: number
    __lastStatus?: string
    __gateAudit?: GateAuditSnap
  }
}

export const CONSENT_KEY = 'wct.consent'
export const CONSENT_VERSION = '2026-09-17'
export const LANDING_URL = /\/(#\/)?$/
/** URL sân khấu; openApp thêm `?logo=0` (BRAND-01) nên chấp nhận query. */
export const APP_URL = /#\/app(\?[^#]*)?$/

/** Màu vạch lưới (src/mask/compositor.ts GRID_LINE_RGBA). */
export const GRID_GRAY = [230, 230, 230, 255]
export const WHITE = [255, 255, 255, 255]

/** Bọc navigator.mediaDevices.getUserMedia để đếm (I10); mode deny giả lập người dùng từ chối quyền. */
export async function installGumCounter(page: Page, mode: 'pass' | 'deny' = 'pass'): Promise<void> {
  await page.addInitScript((mode: 'pass' | 'deny') => {
    window.__gumCalls = 0
    const md = navigator.mediaDevices
    if (!md) return
    const orig = md.getUserMedia.bind(md)
    md.getUserMedia = (c) => {
      window.__gumCalls++
      if (mode === 'deny') {
        return Promise.reject(new DOMException('Permission denied', 'NotAllowedError'))
      }
      return orig(c)
    }
  }, mode)
}

export function gumCalls(page: Page): Promise<number> {
  return page.evaluate(() => window.__gumCalls)
}

/**
 * Ghi lại mọi yêu cầu kiểu fetch/xhr/beacon/websocket và mọi đường dẫn /api (I9: client không gọi máy chủ nào).
 * Ngoại lệ duy nhất: GET không query, cùng máy dev, tới /models/ (model, wasm) hoặc /node_modules/ (wasm khi dev):
 * đó là nạp file tĩnh của chính app (worker mặt nạp bằng fetch), không có dữ liệu nào rời trình duyệt.
 */
export function watchApiLikeRequests(page: Page): string[] {
  const seen: string[] = []
  page.on('request', (req) => {
    const url = new URL(req.url())
    const type = req.resourceType()
    const fetchLike = ['fetch', 'xhr', 'ping', 'eventsource', 'websocket'].includes(type)
    if (!fetchLike && !url.pathname.startsWith('/api')) return
    const localAsset =
      req.method() === 'GET' &&
      url.search === '' &&
      ['127.0.0.1', 'localhost'].includes(url.hostname) &&
      (url.pathname.startsWith('/models/') || url.pathname.startsWith('/node_modules/'))
    if (!localAsset) seen.push(`${req.method()} ${url.pathname}`)
  })
  return seen
}

/**
 * Đặt đồng ý bằng evaluate sau khi đã mở trang, không dùng addInitScript: init script chạy lại ở mọi lần điều hướng
 * và sẽ ghi đè giá trị mà test vừa thu hồi.
 */
export async function seedConsent(page: Page, value: string = CONSENT_VERSION): Promise<void> {
  await page.goto('/')
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [CONSENT_KEY, value])
}

/**
 * Mở #/app (kèm query, ví dụ '?debug=1&source=synthetic') trong một document mới: với hash routing, goto cùng document
 * không nạp lại trang và cache đồng ý. BRAND-01: thêm `logo=0` khi query chưa nói gì về logo, để mọi ca pixel hiện có
 * chạy trên màn che trơn; logo.spec bật rõ bằng `logo=1`.
 */
export async function openApp(page: Page, query = ''): Promise<void> {
  const q = /[?&]logo=/.test(query) ? query : query ? `${query}&logo=0` : '?logo=0'
  await page.goto('about:blank')
  await page.goto(`/#/app${q}`)
}

/**
 * INT-01: bật camera giả của Chromium từ nút "Bật camera" và chờ chạy. Cửa sổ (kể cả chuột) chỉ mở khi camera cấp
 * frame (gate no-camera), nên các ca cửa sổ chuột với camera thật phải bật camera trước.
 */
export async function startFakeCamera(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Bật camera' }).click()
  // Khi cả bộ chạy song song (mọi trang nạp wasm worker mặt), camera giả có thể mất hơn 5 s để cấp stream.
  await expect(page.getByRole('status')).toHaveText(/Camera đang chạy/, { timeout: 20_000 })
}

/** Đợi canvas đã có kích thước thiết bị và store đã tính layout. */
export async function readStage(page: Page): Promise<StageSnap> {
  await page.waitForFunction(() => (window.__wct?.stage?.snapshot().stageSize.w ?? 0) > 0)
  return page.evaluate(() => window.__wct!.stage!.snapshot())
}

export function readLoop(page: Page): Promise<LoopSnap> {
  return page.evaluate(() => window.__wct!.loop!.snapshot())
}

/** HAND-01: màu overlay tay trái và phải (src/mask/compositor.ts HAND_LEFT_RGBA, HAND_RIGHT_RGBA). */
export const HAND_LEFT = [142, 36, 170, 255]
export const HAND_RIGHT = [0, 137, 123, 255]

export function readHands(page: Page): Promise<HandsSnap> {
  return page.evaluate(() => window.__wct!.hands!.snapshot())
}

export function readHandWindow(page: Page): Promise<HandWindowSnap> {
  return page.evaluate(() => window.__wct!.handWindow!.snapshot())
}

export function readLogo(page: Page): Promise<LogoSnap> {
  return page.evaluate(() => window.__wct!.logo!.snapshot())
}

export function readStats(page: Page): Promise<StatsSnap> {
  return page.evaluate(() => window.__wct!.stats!.snapshot())
}

/** ROI-01, INT-01: px camera (chưa mirror) của góc ô (k, m) trên bảng; mirror bật nên cột k ứng với x camera đảo. */
export function camAtCell(L: StageSnap['layout'], k: number, m: number, mirror = true) {
  const sx = L.board.x + k * L.c
  const sy = L.board.y + m * L.c
  const vis = L.camVisibleRect
  return {
    x: mirror ? vis.x + (L.board.x + L.board.w - sx) / L.scale : vis.x + (sx - L.board.x) / L.scale,
    y: vis.y + (sy - L.board.y) / L.scale,
  }
}

/**
 * Hai tay giả lập với tâm bốn đầu ngón tại góc ô (k, m) và cạnh ngắn (cao) bằng sideCells ô; hai tay cách nhau 1,5
 * lần cạnh nên cạnh hình vuông của solver là chiều cao.
 */
export function handsAtCell(
  L: StageSnap['layout'],
  k: number,
  m: number,
  sideCells: number,
  extra: Partial<FakeHandsSpec> = {},
): FakeHandsSpec {
  const c = camAtCell(L, k, m)
  const spread = (sideCells * L.c) / L.scale
  const half = 0.75 * spread
  return {
    left: { x: c.x - half, y: c.y, spread },
    right: { x: c.x + half, y: c.y, spread },
    ...extra,
  }
}

/** Tay giả lập qua kịch bản; null để về worker thật. */
export function setFakeHands(page: Page, spec: FakeHandsSpec | null) {
  return page.evaluate((s) => window.__scenario!.hands(s), spec)
}

/** Màu viền cửa sổ (src/mask/compositor.ts WINDOW_OUTLINE_RGBA và bản limited). */
export const OUTLINE = [26, 115, 232, 255]
export const OUTLINE_LIMITED = [217, 48, 37, 255]

export function readFace(page: Page): Promise<FaceSnap> {
  return page.evaluate(() => window.__wct!.face!.snapshot())
}

export function readCamera(page: Page): Promise<CameraSnap> {
  return page.evaluate(() => window.__wct!.camera!.snapshot())
}

export function readProbe(page: Page): Promise<CameraProbe> {
  return page.evaluate(() => ({ ...window.__wct!.camera!.probe }))
}

export function samplePixel(page: Page, x: number, y: number): Promise<number[]> {
  return page.evaluate(
    ([x, y]) => {
      const c = document.querySelector<HTMLCanvasElement>('canvas#stage')!
      return Array.from(c.getContext('2d')!.getImageData(x, y, 1, 1).data)
    },
    [x, y],
  )
}

/**
 * Canvas output không có pixel camera (I4): lấy mẫu bốn góc, tâm và bốn điểm giữa cạnh; mỗi mẫu phải là trắng
 * hoặc đúng màu vạch lưới. Với `pureWhite` (đã tắt vạch lưới) chỉ chấp nhận trắng.
 */
export async function expectCanvasWhite(page: Page, pureWhite = false): Promise<void> {
  const samples = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('canvas#stage')
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return null
    const w = c.width - 1
    const h = c.height - 1
    const mx = Math.floor(w / 2)
    const my = Math.floor(h / 2)
    const pts = [
      [0, 0],
      [w, 0],
      [0, h],
      [w, h],
      [mx, my],
      [mx, 0],
      [mx, h],
      [0, my],
      [w, my],
    ]
    return pts.map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data))
  })
  expect(samples).not.toBeNull()
  for (const px of samples ?? []) {
    if (pureWhite) expect(px).toEqual(WHITE)
    else expect([WHITE, GRID_GRAY]).toContainEqual(px)
  }
}

/**
 * QA-01 (gate cứng 7.2, cách đo thứ hai): với nguồn tổng hợp và cảnh đứng yên, mỗi buffer qua probe onRestrictedFrame
 * được so từng pixel với ảnh tham chiếu dựng lại trong trang từ định nghĩa cảnh (window.__scenario.scene(): nền, vùng
 * người, ảnh tĩnh) chỉ trong roiCam của buffer: crop 1:1, tô xám các lỗ của mask hiện tại rồi letterbox cùng công thức
 * (src/core/letterbox.ts). Lệch quá 2 mức ở bất kỳ pixel nào là buffer có nội dung không thuộc roiCam (pixel ngoài
 * ROI, crop lệch, lỗ không tô). Cảnh có chuyển động hoặc ảnh chưa nạp thì bỏ qua buffer đó (đếm skipped, pending).
 * Đặt nhịp probe tối đa 100 ms để mỗi ca có nhiều buffer được đo. Kết quả ở window.__gateAudit (expectGateClean).
 */
export async function installGateAudit(page: Page): Promise<void> {
  await page.evaluate(() => {
    type Person = {
      x: number
      y: number
      w: number
      h: number
      color: string
      vx: number
      vy: number
    }
    type Face = {
      src: string
      x: number
      y: number
      w: number
      h: number
      vx?: number
      vy?: number
    }
    type Scene = {
      width: number
      height: number
      background: string
      person: Person | null
      face: Face | null
    }
    const audit: GateAuditSnap = {
      frames: 0,
      clean: 0,
      skipped: 0,
      pending: 0,
      maxDiff: 0,
      dirty: [],
    }
    window.__gateAudit = audit
    const images = new Map<string, HTMLImageElement>()
    const sceneCanvas = document.createElement('canvas')
    const crop = document.createElement('canvas')
    const lb = document.createElement('canvas')
    const GRAY = 'rgb(128, 128, 128)'
    const p = window.__wct!.probes!
    p.minIntervalMs.restricted = Math.min(p.minIntervalMs.restricted, 100)
    p.onRestrictedFrame((img, meta) => {
      const scene = (window.__scenario?.scene() ?? null) as Scene | null
      if (!scene) {
        audit.skipped++
        return
      }
      const personMoves = scene.person ? scene.person.vx !== 0 || scene.person.vy !== 0 : false
      const faceMoves = scene.face
        ? (scene.face.vx ?? 0) !== 0 || (scene.face.vy ?? 0) !== 0
        : false
      if (personMoves || faceMoves) {
        audit.skipped++
        return
      }
      let faceImg: HTMLImageElement | null = null
      if (scene.face) {
        let im = images.get(scene.face.src)
        if (!im) {
          im = new Image()
          im.src = scene.face.src
          images.set(scene.face.src, im)
        }
        if (!im.complete || im.naturalWidth === 0) {
          audit.pending++
          return
        }
        faceImg = im
      }
      // Ảnh tham chiếu: cảnh → crop 1:1 theo roiCam → lỗ xám → letterbox (cùng ba bước với restrictedFrame.ts).
      const r = meta.roiCam
      const size = img.width
      sceneCanvas.width = scene.width
      sceneCanvas.height = scene.height
      const sc = sceneCanvas.getContext('2d')!
      sc.fillStyle = scene.background
      sc.fillRect(0, 0, scene.width, scene.height)
      if (scene.person) {
        sc.fillStyle = scene.person.color
        sc.fillRect(scene.person.x, scene.person.y, scene.person.w, scene.person.h)
      }
      if (scene.face && faceImg) {
        const f = scene.face
        sc.drawImage(faceImg, 0, 0, faceImg.naturalWidth, faceImg.naturalHeight, f.x, f.y, f.w, f.h)
      }
      crop.width = r.w
      crop.height = r.h
      const cc = crop.getContext('2d')!
      cc.drawImage(sceneCanvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h)
      cc.fillStyle = GRAY
      for (const h of window.__wct!.loop!.snapshot().mask?.holesCam ?? []) {
        cc.fillRect(h.x - r.x, h.y - r.y, h.w, h.h)
      }
      lb.width = size
      lb.height = size
      const lc = lb.getContext('2d')!
      lc.fillStyle = GRAY
      lc.fillRect(0, 0, size, size)
      const scale = size / Math.max(r.w, r.h)
      const dx = Math.floor((size - r.w * scale) / 2)
      const dy = Math.floor((size - r.h * scale) / 2)
      lc.drawImage(crop, 0, 0, r.w, r.h, dx, dy, r.w * scale, r.h * scale)
      const ref = lc.getImageData(0, 0, size, size).data
      const d = img.data
      let mismatch = 0
      let maxDiff = 0
      for (let i = 0; i < d.length; i += 4) {
        const diff = Math.max(
          Math.abs(d[i] - ref[i]),
          Math.abs(d[i + 1] - ref[i + 1]),
          Math.abs(d[i + 2] - ref[i + 2]),
        )
        if (diff > maxDiff) maxDiff = diff
        if (diff > 2) mismatch++
      }
      audit.frames++
      if (maxDiff > audit.maxDiff) audit.maxDiff = maxDiff
      if (mismatch === 0) audit.clean++
      else if (audit.dirty.length < 5)
        audit.dirty.push({ taskId: meta.taskId, mismatch, maxDiff, roiCam: { ...r } })
    })
  })
}

/**
 * Đọc kết quả installGateAudit: không buffer nào lệch tham chiếu và có ít nhất minFrames buffer được đo; ghi số đo
 * vào annotations của test (JSON reporter → tools/test-report.mjs).
 */
export async function expectGateClean(page: Page, minFrames = 1): Promise<GateAuditSnap> {
  const a = await page.evaluate(() => window.__gateAudit!)
  test.info().annotations.push({
    type: 'gate cứng',
    description:
      `${a.frames} buffer so tham chiếu: ${a.clean} khớp, ${a.dirty.length} lệch, maxDiff ${a.maxDiff}` +
      ` (bỏ qua ${a.skipped} cảnh động, ${a.pending} chờ ảnh)`,
  })
  expect(a.dirty).toEqual([])
  expect(a.frames).toBeGreaterThanOrEqual(minFrames)
  return a
}

/** QA-01: ghi một số đo vào annotations của test hiện tại (hiện trong docs/test-report-mask.md). */
export function note(description: string): void {
  test.info().annotations.push({ type: 'đo', description })
}
