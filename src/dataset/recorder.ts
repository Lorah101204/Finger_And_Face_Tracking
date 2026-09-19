// CLS-01 bước 2 (I8, mục 5.12): dataset mode chỉ lưu crop vùng mở (bản trước letterbox, nhận qua CropTap của
// restrictedFrame) kèm metadata JSON; không bao giờ có frame gốc, không upload (I9). Thuần: bộ mã hóa PNG, đồng hồ, ngẫu
// nhiên và nơi lưu (sink) tiêm vào để unit test trong Node. Không có sink thì giữ mẫu trong bộ nhớ để tải zip.
import { DEFAULTS } from '../core/config'
import type { CropMeta, CropTap, Rect, Size } from '../core/types'
import { buildZip, type ZipEntry } from './zip'

export const DATASET_LABELS = ['person', 'mannequin', 'unknown', 'background'] as const
export type DatasetLabel = (typeof DATASET_LABELS)[number]
export const LIGHTINGS = ['normal', 'bright', 'dim', 'backlit'] as const
export type Lighting = (typeof LIGHTINGS)[number]
export const MANNEQUIN_TYPES = ['none', 'plastic', 'fabric', 'silicone'] as const
export type MannequinType = (typeof MANNEQUIN_TYPES)[number]
export type SizeClass = 'small' | 'medium' | 'large'
export type Edge = 'top' | 'bottom' | 'left' | 'right'

/** Trường người thu nhập cho một phiên; subjectId ẩn danh (không tên, không ảnh ngoài crop). */
export type SessionFields = {
  subjectId: string
  label: DatasetLabel
  lighting: Lighting
  mannequinType: MannequinType
  note: string
  /** Bước 1: người tham gia đã ký văn bản đồng ý; không có thì không bật được. */
  participantConsent: boolean
}

export type SessionMeta = SessionFields & {
  sessionId: string
  startedAt: string
  stoppedAt: string | null
  samples: number
  app: { consentVersion: string; rateHz: number; grid: Size; camera: Size | null }
}

export type SampleMeta = {
  id: string
  sessionId: string
  subjectId: string
  label: DatasetLabel
  lighting: Lighting
  mannequinType: MannequinType
  /** ts của frame camera và thời điểm lưu (ISO) */
  ts: number
  capturedAt: string
  epoch: number
  frameId: number
  taskId: number
  cameraRect: Rect
  crop: Size
  /** hộp bao theo ô, số ô mở, số lỗ; n là cạnh ngắn theo ô */
  cellsBox: Size
  cellCount: number
  holes: number
  n: number
  sizeClass: SizeClass
  /** cửa sổ chạm mép camera (cắt đầu, cắt vai…) hay ở giữa */
  position: 'center' | 'edge'
  edges: Edge[]
  grid: Size
  mirror: boolean
}

export type Sample = { meta: SampleMeta; png: Blob }

export type CaptureContext = { grid: Size; mirror: boolean; camera: Size | null }

/** Nơi lưu ngoài bộ nhớ (thư mục qua File System Access API); ghi xuyên qua, không giữ blob trong bộ nhớ. */
export type DatasetSink = {
  name: string
  writeSample(sample: Sample): Promise<void>
  writeSession(meta: SessionMeta): Promise<void>
}

export type RecorderSnapshot = {
  /** Dataset mode đang bật (công tắc); `recording` là đang lưu (đã Bắt đầu thu). */
  enabled: boolean
  recording: boolean
  fields: SessionFields
  session: SessionMeta | null
  /** số mẫu của phiên hiện tại, số mẫu đang giữ trong bộ nhớ (mọi phiên), byte PNG trong bộ nhớ */
  count: number
  inMemory: number
  bytes: number
  pending: number
  dropped: number
  lastMeta: SampleMeta | null
  rateHz: number
  maxSamples: number
  sink: string | null
  error: string | null
}

export type RecorderOptions = {
  /** ImageData → PNG (trình duyệt: OffscreenCanvas.convertToBlob); tiêm giả trong unit test. */
  encode: (img: ImageData) => Promise<Blob>
  context: () => CaptureContext
  consentVersion: string
  now?: () => number
  random?: () => number
  rateHz?: number
  maxSamples?: number
}

export type Recorder = {
  snapshot(): RecorderSnapshot
  subscribe(fn: () => void): () => void
  /** CropTap để đưa vào createRestrictedFrameBuilder. */
  readonly tap: CropTap
  setEnabled(on: boolean): void
  setFields(patch: Partial<SessionFields>): void
  setRate(hz: number): void
  setMaxSamples(n: number): void
  setSink(sink: DatasetSink | null): void
  /** Bắt đầu phiên; sai khi chưa bật hoặc chưa có đồng ý của người tham gia. */
  start(): boolean
  stop(): void
  /** Mẫu trong bộ nhớ (không có sink) và metadata của mọi mẫu đã lưu. */
  samples(): readonly Sample[]
  metas(): readonly SampleMeta[]
  sessions(): readonly SessionMeta[]
  clear(): void
  /** Gói zip stored: <sessionId>/<id>.png, <id>.json và session.json cho các mẫu trong bộ nhớ. */
  zip(): Promise<Uint8Array>
  dispose(): void
}

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

export function randomId(len: number, random: () => number = Math.random): string {
  let s = ''
  for (let i = 0; i < len; i++)
    s += ALPHABET[Math.floor(random() * ALPHABET.length) % ALPHABET.length]
  return s
}

export function defaultFields(random: () => number = Math.random): SessionFields {
  return {
    subjectId: `S-${randomId(4, random)}`,
    label: 'person',
    lighting: 'normal',
    mannequinType: 'none',
    note: '',
    participantConsent: false,
  }
}

export function sizeClassOf(crop: Size): SizeClass {
  const side = Math.min(crop.w, crop.h)
  if (side < DEFAULTS.dataset.sizeSmallPx) return 'small'
  if (side < DEFAULTS.dataset.sizeLargePx) return 'medium'
  return 'large'
}

/** Cửa sổ chạm mép camera: crop có thể cắt đầu (top), cắt vai (bottom) hay cắt bên. */
export function edgesOf(roi: Rect, camera: Size | null): Edge[] {
  if (!camera) return []
  const e: Edge[] = []
  if (roi.y <= 0) e.push('top')
  if (roi.y + roi.h >= camera.h) e.push('bottom')
  if (roi.x <= 0) e.push('left')
  if (roi.x + roi.w >= camera.w) e.push('right')
  return e
}

export function createRecorder(opts: RecorderOptions): Recorder {
  const now = opts.now ?? (() => Date.now())
  const random = opts.random ?? Math.random
  let rateHz = opts.rateHz ?? DEFAULTS.dataset.rateHz
  let maxSamples = opts.maxSamples ?? DEFAULTS.dataset.maxSamples
  let enabled = false
  let recording = false
  let fields = defaultFields(random)
  let session: SessionMeta | null = null
  let sink: DatasetSink | null = null
  let lastTs = -Infinity
  let pending = 0
  let dropped = 0
  let seq = 0
  let error: string | null = null
  const memory: Sample[] = []
  const metas: SampleMeta[] = []
  const sessions: SessionMeta[] = []
  const listeners = new Set<() => void>()
  let snap: RecorderSnapshot | null = null

  function emit(): void {
    snap = null
    for (const l of listeners) l()
  }

  function bytesInMemory(): number {
    let b = 0
    for (const s of memory) b += s.png.size
    return b
  }

  function build(): RecorderSnapshot {
    return {
      enabled,
      recording,
      fields,
      session,
      count: session?.samples ?? 0,
      inMemory: memory.length,
      bytes: bytesInMemory(),
      pending,
      dropped,
      lastMeta: metas.length ? metas[metas.length - 1] : null,
      rateHz,
      maxSamples,
      sink: sink?.name ?? null,
      error,
    }
  }

  function finishSession(): void {
    if (!session) return
    session = { ...session, stoppedAt: new Date(now()).toISOString() }
    const done = session
    sessions[sessions.length - 1] = done
    if (sink) void sink.writeSession(done).catch((e) => fail(e))
  }

  function fail(e: unknown): void {
    error = e instanceof Error ? e.message : String(e)
    emit()
  }

  function capture(img: ImageData, meta: CropMeta): void {
    if (!recording || !session) return
    const s = session
    if (s.samples + pending >= maxSamples) {
      recording = false
      finishSession()
      emit()
      return
    }
    lastTs = meta.ts
    pending++
    const ctx = opts.context()
    const crop = { w: img.width, h: img.height }
    const edges = edgesOf(meta.roiCam, ctx.camera)
    const id = `${s.sessionId}-${String(++seq).padStart(4, '0')}`
    const sampleMeta: SampleMeta = {
      id,
      sessionId: s.sessionId,
      subjectId: s.subjectId,
      label: s.label,
      lighting: s.lighting,
      mannequinType: s.mannequinType,
      ts: meta.ts,
      capturedAt: new Date(now()).toISOString(),
      epoch: meta.epoch,
      frameId: meta.frameId,
      taskId: meta.taskId,
      cameraRect: { ...meta.roiCam },
      crop,
      cellsBox: { ...meta.box },
      cellCount: meta.cells,
      holes: meta.holes,
      n: Math.min(meta.box.w, meta.box.h),
      sizeClass: sizeClassOf(crop),
      position: edges.length ? 'edge' : 'center',
      edges,
      grid: { ...ctx.grid },
      mirror: ctx.mirror,
    }
    emit()
    opts
      .encode(img)
      .then(async (png) => {
        const sample: Sample = { meta: sampleMeta, png }
        if (sink) await sink.writeSample(sample)
        else memory.push(sample)
        metas.push(sampleMeta)
        // Phiên có thể đã dừng trong lúc mã hóa: vẫn đếm mẫu vào phiên của nó.
        const target = sessions.find((x) => x.sessionId === s.sessionId)
        if (target) {
          target.samples++
          if (session && session.sessionId === s.sessionId) session = target
        }
      })
      .catch((e) => {
        dropped++
        fail(e)
      })
      .finally(() => {
        pending--
        emit()
      })
  }

  const tap: CropTap = {
    wants(ts) {
      return recording && pending === 0 && ts - lastTs >= 1000 / rateHz
    },
    emit: capture,
  }

  return {
    tap,
    snapshot() {
      return (snap ??= build())
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    setEnabled(on) {
      if (on === enabled) return
      enabled = on
      if (!on && recording) {
        recording = false
        finishSession()
      }
      error = null
      emit()
    },
    setFields(patch) {
      fields = { ...fields, ...patch }
      if (session && recording) {
        // Đổi nhãn tạm hay điều kiện giữa phiên: mẫu sau mang giá trị mới, phiên ghi giá trị cuối.
        session = { ...session, ...patch }
        sessions[sessions.length - 1] = session
      }
      emit()
    },
    setRate(hz) {
      if (Number.isFinite(hz) && hz > 0) {
        rateHz = Math.min(30, hz)
        emit()
      }
    },
    setMaxSamples(n) {
      if (Number.isFinite(n) && n >= 1) {
        maxSamples = Math.floor(n)
        emit()
      }
    },
    setSink(s) {
      sink = s
      error = null
      emit()
    },
    start() {
      if (!enabled || !fields.participantConsent || recording) return false
      const ctx = opts.context()
      const startedAt = new Date(now())
      session = {
        ...fields,
        sessionId: `ses-${startedAt.getTime().toString(36)}-${randomId(3, random)}`,
        startedAt: startedAt.toISOString(),
        stoppedAt: null,
        samples: 0,
        app: {
          consentVersion: opts.consentVersion,
          rateHz,
          grid: { ...ctx.grid },
          camera: ctx.camera ? { ...ctx.camera } : null,
        },
      }
      sessions.push(session)
      seq = 0
      lastTs = -Infinity
      recording = true
      error = null
      if (sink) void sink.writeSession(session).catch((e) => fail(e))
      emit()
      return true
    },
    stop() {
      if (!recording) return
      recording = false
      finishSession()
      emit()
    },
    samples: () => memory,
    metas: () => metas,
    sessions: () => sessions,
    clear() {
      memory.length = 0
      emit()
    },
    async zip() {
      const entries: ZipEntry[] = []
      const bySession = new Set<string>()
      for (const s of memory) {
        bySession.add(s.meta.sessionId)
        const dir = s.meta.sessionId
        entries.push({
          name: `${dir}/${s.meta.id}.png`,
          data: new Uint8Array(await s.png.arrayBuffer()),
        })
        entries.push({
          name: `${dir}/${s.meta.id}.json`,
          data: new TextEncoder().encode(JSON.stringify(s.meta, null, 2)),
        })
      }
      for (const ses of sessions) {
        if (!bySession.has(ses.sessionId)) continue
        entries.push({
          name: `${ses.sessionId}/session.json`,
          data: new TextEncoder().encode(JSON.stringify(ses, null, 2)),
        })
      }
      return buildZip(entries)
    },
    dispose() {
      if (recording) {
        recording = false
        finishSession()
      }
      listeners.clear()
    },
  }
}
