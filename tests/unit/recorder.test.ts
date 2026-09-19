import { describe, expect, it } from 'vitest'
import type { CropMeta } from '../../src/core/types'
import {
  createRecorder,
  defaultFields,
  edgesOf,
  sizeClassOf,
  type DatasetSink,
  type Sample,
  type SessionMeta,
} from '../../src/dataset/recorder'
import { listZip, readZipEntry } from '../../src/dataset/zip'
import { describeRecorder } from '../../src/app/datasetText'

// CLS-01 (mục 7.22, I8): recorder thuần với bộ mã hóa, đồng hồ, ngẫu nhiên và sink giả. Không bật hay chưa có đồng ý
// thì không thu; nhịp theo ts của frame; mỗi mẫu có metadata đủ trường; sink ghi xuyên qua; không sink thì giữ bộ nhớ
// và zip đúng cấu trúc thư mục; tối đa mẫu thì tự dừng; tắt công tắc thì dừng phiên.
const img = (w: number, h: number) =>
  ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }) as ImageData

const meta = (ts: number, patch: Partial<CropMeta> = {}): CropMeta => ({
  epoch: 5,
  frameId: 100,
  ts,
  taskId: 9,
  roiCam: { x: 200, y: 100, w: 320, h: 320 },
  box: { w: 16, h: 16 },
  cells: 256,
  holes: 0,
  ...patch,
})

function fixture(opts: { sink?: DatasetSink; maxSamples?: number; camera?: boolean } = {}) {
  let t = 1_000_000
  const encoded: number[] = []
  const rec = createRecorder({
    encode: async (i) => {
      encoded.push(i.width)
      return new Blob([new Uint8Array(i.width)], { type: 'image/png' })
    },
    context: () => ({
      grid: { w: 64, h: 36 },
      mirror: true,
      camera: opts.camera === false ? null : { w: 1280, h: 720 },
    }),
    consentVersion: '2026-09-17',
    now: () => t,
    random: () => 0.42,
    rateHz: 2,
    maxSamples: opts.maxSamples,
  })
  if (opts.sink) rec.setSink(opts.sink)
  return { rec, encoded, tick: (ms: number) => (t += ms) }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('recorder', () => {
  it('sizeClassOf theo cạnh ngắn; edgesOf theo mép camera; defaultFields ẩn danh', () => {
    expect(sizeClassOf({ w: 159, h: 400 })).toBe('small')
    expect(sizeClassOf({ w: 160, h: 319 })).toBe('medium')
    expect(sizeClassOf({ w: 320, h: 320 })).toBe('large')
    expect(edgesOf({ x: 0, y: 0, w: 100, h: 100 }, { w: 1280, h: 720 })).toEqual(['top', 'left'])
    expect(edgesOf({ x: 1180, y: 620, w: 100, h: 100 }, { w: 1280, h: 720 })).toEqual([
      'bottom',
      'right',
    ])
    expect(edgesOf({ x: 10, y: 10, w: 100, h: 100 }, { w: 1280, h: 720 })).toEqual([])
    expect(edgesOf({ x: 0, y: 0, w: 100, h: 100 }, null)).toEqual([])
    const f = defaultFields(() => 0)
    expect(f.subjectId).toMatch(/^S-[a-z0-9]{4}$/)
    expect(f.participantConsent).toBe(false)
  })

  it('chưa bật hay chưa có đồng ý thì start() sai và tap không muốn gì', () => {
    const { rec } = fixture()
    expect(rec.start()).toBe(false)
    rec.setEnabled(true)
    expect(rec.start()).toBe(false)
    expect(rec.tap.wants(0)).toBe(false)
    rec.setFields({ participantConsent: true })
    expect(rec.start()).toBe(true)
    expect(rec.start()).toBe(false)
    const s = rec.snapshot()
    expect(s.recording).toBe(true)
    expect(s.session?.sessionId).toMatch(/^ses-[a-z0-9]+-[a-z0-9]{3}$/)
    expect(s.session?.app).toEqual({
      consentVersion: '2026-09-17',
      rateHz: 2,
      grid: { w: 64, h: 36 },
      camera: { w: 1280, h: 720 },
    })
    expect(describeRecorder(s)).toMatch(/^đang thu 0 mẫu · 2 Hz · bộ nhớ/)
  })

  it('nhịp theo ts của frame: 2 Hz nhận mỗi 500 ms, không nhận khi đang mã hóa; metadata đủ trường; giữ trong bộ nhớ', async () => {
    const { rec, encoded } = fixture()
    rec.setEnabled(true)
    rec.setFields({ participantConsent: true, label: 'mannequin', mannequinType: 'plastic' })
    rec.start()
    expect(rec.tap.wants(1000)).toBe(true)
    rec.tap.emit(img(320, 320), meta(1000))
    expect(rec.snapshot().pending).toBe(1)
    expect(rec.tap.wants(1600)).toBe(false) // đang mã hóa
    await flush()
    expect(rec.tap.wants(1400)).toBe(false) // chưa tới 500 ms
    expect(rec.tap.wants(1500)).toBe(true)
    rec.tap.emit(img(100, 120), meta(1500, { roiCam: { x: 0, y: 600, w: 100, h: 120 }, holes: 3 }))
    await flush()
    expect(encoded).toEqual([320, 100])
    const s = rec.snapshot()
    expect(s.count).toBe(2)
    expect(s.inMemory).toBe(2)
    expect(s.bytes).toBe(420)
    expect(s.pending).toBe(0)
    const m = rec.metas()
    expect(m[0]).toMatchObject({
      id: `${s.session!.sessionId}-0001`,
      subjectId: s.fields.subjectId,
      label: 'mannequin',
      mannequinType: 'plastic',
      lighting: 'normal',
      ts: 1000,
      epoch: 5,
      frameId: 100,
      taskId: 9,
      cameraRect: { x: 200, y: 100, w: 320, h: 320 },
      crop: { w: 320, h: 320 },
      cellsBox: { w: 16, h: 16 },
      cellCount: 256,
      holes: 0,
      n: 16,
      sizeClass: 'large',
      position: 'center',
      edges: [],
      grid: { w: 64, h: 36 },
      mirror: true,
    })
    expect(m[0].capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(m[1]).toMatchObject({
      id: `${s.session!.sessionId}-0002`,
      crop: { w: 100, h: 120 },
      sizeClass: 'small',
      position: 'edge',
      edges: ['bottom', 'left'],
      holes: 3,
    })
    // Dừng: phiên có stoppedAt và số mẫu; tap không muốn nữa.
    rec.stop()
    expect(rec.snapshot().recording).toBe(false)
    expect(rec.sessions()[0]).toMatchObject({ samples: 2 })
    expect(rec.sessions()[0].stoppedAt).not.toBeNull()
    expect(rec.tap.wants(5000)).toBe(false)
    expect(describeRecorder(rec.snapshot())).toMatch(/^đã dừng, 2 mẫu/)
  })

  it('zip: <sessionId>/<id>.png, <id>.json và session.json; JSON đọc lại đúng metadata; clear() xóa bộ nhớ', async () => {
    const { rec } = fixture()
    rec.setEnabled(true)
    rec.setFields({ participantConsent: true })
    rec.start()
    rec.tap.emit(img(64, 64), meta(1000))
    await flush()
    rec.tap.emit(img(64, 64), meta(1500))
    await flush()
    rec.stop()
    const bytes = await rec.zip()
    const list = listZip(bytes)
    const ses = rec.sessions()[0].sessionId
    expect(list.map((e) => e.name).sort()).toEqual(
      [
        `${ses}/${ses}-0001.png`,
        `${ses}/${ses}-0001.json`,
        `${ses}/${ses}-0002.png`,
        `${ses}/${ses}-0002.json`,
        `${ses}/session.json`,
      ].sort(),
    )
    const sessionJson = JSON.parse(
      new TextDecoder().decode(
        readZipEntry(
          bytes,
          list.find((e) => e.name.endsWith('session.json'))!,
        ),
      ),
    ) as SessionMeta
    expect(sessionJson).toMatchObject({ sessionId: ses, samples: 2, participantConsent: true })
    const sampleJson = JSON.parse(
      new TextDecoder().decode(
        readZipEntry(
          bytes,
          list.find((e) => e.name.endsWith('0001.json'))!,
        ),
      ),
    )
    expect(sampleJson).toEqual(rec.metas()[0])
    expect(
      readZipEntry(
        bytes,
        list.find((e) => e.name.endsWith('0001.png'))!,
      ).length,
    ).toBe(64)
    rec.clear()
    expect(rec.snapshot().inMemory).toBe(0)
    expect(listZip(await rec.zip())).toEqual([])
  })

  it('sink: ghi xuyên qua từng mẫu và session.json lúc bắt đầu và dừng; không giữ blob trong bộ nhớ; lỗi ghi được báo', async () => {
    const writes: string[] = []
    let failNext = false
    const sink: DatasetSink = {
      name: 'thu-muc',
      async writeSample(s: Sample) {
        if (failNext) throw new Error('đĩa đầy')
        writes.push(`sample ${s.meta.id}`)
      },
      async writeSession(m) {
        writes.push(`session ${m.sessionId} ${m.samples} ${m.stoppedAt ? 'stop' : 'start'}`)
      },
    }
    const { rec } = fixture({ sink })
    rec.setEnabled(true)
    rec.setFields({ participantConsent: true })
    rec.start()
    rec.tap.emit(img(64, 64), meta(1000))
    await flush()
    failNext = true
    rec.tap.emit(img(64, 64), meta(1500))
    await flush()
    rec.stop()
    await flush()
    const ses = rec.sessions()[0].sessionId
    expect(writes).toEqual([
      `session ${ses} 0 start`,
      `sample ${ses}-0001`,
      `session ${ses} 1 stop`,
    ])
    const s = rec.snapshot()
    expect(s.inMemory).toBe(0)
    expect(s.count).toBe(1)
    expect(s.dropped).toBe(1)
    expect(s.error).toBe('đĩa đầy')
    expect(describeRecorder(s)).toMatch(/thư mục thu-muc · lỗi: đĩa đầy/)
  })

  it('tối đa mẫu thì tự dừng; tắt công tắc khi đang thu thì dừng phiên; đổi nhãn giữa phiên ghi vào mẫu sau', async () => {
    const { rec } = fixture({ maxSamples: 2 })
    rec.setEnabled(true)
    rec.setFields({ participantConsent: true })
    rec.start()
    rec.tap.emit(img(64, 64), meta(1000))
    await flush()
    rec.setFields({ label: 'unknown' })
    rec.tap.emit(img(64, 64), meta(1500))
    await flush()
    expect(rec.metas().map((m) => m.label)).toEqual(['person', 'unknown'])
    expect(rec.tap.wants(2000)).toBe(true)
    rec.tap.emit(img(64, 64), meta(2000))
    expect(rec.snapshot().recording).toBe(false)
    expect(rec.snapshot().count).toBe(2)
    rec.start()
    expect(rec.snapshot().recording).toBe(true)
    rec.setEnabled(false)
    const s = rec.snapshot()
    expect(s.recording).toBe(false)
    expect(s.enabled).toBe(false)
    expect(rec.sessions()).toHaveLength(2)
    expect(rec.sessions()[1].stoppedAt).not.toBeNull()
    expect(describeRecorder(s)).toBe('dataset mode tắt')
  })
})
