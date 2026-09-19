import { describe, expect, it } from 'vitest'
import { buildGuidance, cameraPhase, type GuidanceInput } from '../../src/app/guidance'
import { DEFAULTS } from '../../src/core/config'
import type { CloseReason, FingerStatus, FingerTip, FrameOutput } from '../../src/core/types'

// UX-01 (mục 7.20, UC-08): mỗi pha camera, mỗi CloseReason (cả hai nguồn cửa sổ) và mỗi FrameOutput.status có một
// thông điệp riêng; ưu tiên camera > tab ẩn > worker đang nạp > lý do đóng > trạng thái vùng mở.
const CLOSE_REASONS: CloseReason[] = [
  'no-camera',
  'few-points',
  'stale-point',
  'out-of-board',
  'too-small',
  'ambiguous-hands',
  'tab-hidden',
  'config-changed',
  'user',
]
const OPEN_STATUSES: FrameOutput['status'][] = [
  'searching',
  'too-small',
  'face-candidate',
  'partial-face',
]

function base(patch: Partial<GuidanceInput> = {}): GuidanceInput {
  return {
    camera: 'active',
    source: 'hands',
    hands: 'ready',
    handsSeen: 0,
    face: 'ready',
    reveal: { kind: 'closed', reason: 'few-points' },
    status: 'covered',
    limited: false,
    fingers: [],
    ...patch,
  }
}

const OPEN = base({
  reveal: {
    kind: 'open',
    mask: {} as never,
  },
  status: 'searching',
})

function finger(
  hand: 'left' | 'right',
  tip: FingerTip,
  reason?: FingerStatus['reason'],
): FingerStatus {
  return {
    hand,
    trackId: hand === 'left' ? 1 : 2,
    tip,
    valid: !reason,
    ...(reason ? { reason } : {}),
    pStage: { x: 100, y: 100 },
    pCam: { x: 100, y: 100 },
    ts: 1000,
    ageMs: 0,
    score: 0.9,
  }
}

describe('buildGuidance: camera (bước 1)', () => {
  it('mỗi pha camera có tiêu đề riêng và đứng trước mọi lý do khác', () => {
    const titles = new Set<string>()
    for (const camera of [
      'off',
      'requesting',
      'switching',
      'stalled',
      'hidden',
      'ended',
      'error',
    ] as const) {
      const g = buildGuidance(
        base({ camera, cameraText: 'chi tiết', reveal: OPEN.reveal, status: 'face-candidate' }),
      )
      expect(g.step, camera).toBe(1)
      expect(g.title.length, camera).toBeGreaterThan(0)
      titles.add(g.title)
    }
    expect(titles.size).toBe(7)
    expect(buildGuidance(base({ camera: 'ended', cameraText: 'Camera đã bị rút.' })).detail).toBe(
      'Camera đã bị rút.',
    )
    expect(buildGuidance(base({ camera: 'error' })).tone).toBe('error')
    expect(buildGuidance(base({ camera: 'hidden' })).reason).toBe('tab-hidden')
  })

  it('active và synthetic không tạo thông điệp camera; đóng no-camera là chờ frame đầu', () => {
    for (const camera of ['active', 'synthetic'] as const) {
      const g = buildGuidance(base({ camera, reveal: { kind: 'closed', reason: 'no-camera' } }))
      expect(g.step).toBe(1)
      expect(g.reason).toBe('no-camera')
      expect(g.tone).toBe('wait')
    }
  })

  it('cameraPhase: wasActive phân biệt đổi camera với xin quyền; hidden ưu tiên trước stalled', () => {
    const active = {
      status: 'active',
      deviceId: 'a',
      label: 'a',
      width: 1,
      height: 1,
      frameRate: null,
    } as const
    const snap = (state: Parameters<typeof cameraPhase>[0]['state'], extra = {}) => ({
      state,
      stalled: false,
      hidden: false,
      devices: [],
      epoch: 0,
      ...extra,
    })
    expect(cameraPhase(snap({ status: 'idle' }), false)).toBe('off')
    expect(cameraPhase(snap({ status: 'requesting', deviceId: null }), false)).toBe('requesting')
    expect(cameraPhase(snap({ status: 'requesting', deviceId: 'b' }), true)).toBe('switching')
    expect(cameraPhase(snap(active), true)).toBe('active')
    expect(cameraPhase(snap(active, { stalled: true }), true)).toBe('stalled')
    expect(cameraPhase(snap(active, { stalled: true, hidden: true }), true)).toBe('hidden')
    expect(cameraPhase(snap({ status: 'ended', reason: 'track-ended' }), true)).toBe('ended')
    expect(cameraPhase(snap({ status: 'error', kind: 'not-allowed', message: '' }), false)).toBe(
      'error',
    )
  })
})

describe('buildGuidance: cửa sổ đóng (bước 2)', () => {
  it('nguồn tay: mỗi CloseReason có thông điệp, reason ghi lại; tab-hidden về bước 1', () => {
    const titles = new Map<CloseReason, string>()
    for (const reason of CLOSE_REASONS) {
      const g = buildGuidance(base({ reveal: { kind: 'closed', reason } }))
      expect(g.reason, reason).toBe(reason)
      expect(g.title.length, reason).toBeGreaterThan(0)
      expect(g.detail.length, reason).toBeGreaterThan(0)
      expect(g.step, reason).toBe(reason === 'tab-hidden' || reason === 'no-camera' ? 1 : 2)
      titles.set(reason, g.title)
    }
    // Các lý do do tay gây ra phải phân biệt được với nhau.
    const handReasons: CloseReason[] = [
      'few-points',
      'stale-point',
      'out-of-board',
      'too-small',
      'ambiguous-hands',
      'config-changed',
    ]
    expect(new Set(handReasons.map((r) => titles.get(r))).size).toBe(handReasons.length)
    expect(titles.get('ambiguous-hands')).toMatch(/chéo nhau/)
    expect(titles.get('too-small')).toMatch(/quá gần nhau/)
    expect(
      buildGuidance(base({ reveal: { kind: 'closed', reason: 'too-small' } })).detail,
    ).toContain(`${DEFAULTS.reveal.nMin} ô`)
  })

  it('nguồn tay, thiếu điểm: chưa thấy tay thì nêu tên các đầu ngón đã chọn; thấy tay thì nêu tay còn thiếu hay điểm cũ', () => {
    const none = buildGuidance(base({ handsSeen: 0 }))
    expect(none.title).toBe('Đưa hai bàn tay vào trước camera')
    expect(none.detail).toContain('cái, trỏ, giữa, áp út, út')
    expect(none.detail).toContain(
      `ít nhất ${DEFAULTS.reveal.minPoints} đầu ngón của ${DEFAULTS.hands.minHands} tay`,
    )
    const custom = buildGuidance(base({ handsSeen: 0, fingerConfig: [8, 12] }))
    expect(custom.detail).toContain('(trỏ, giữa)')
    const oneHand = buildGuidance(
      base({
        handsSeen: 1,
        fingers: ([4, 8, 12, 16, 20] as FingerTip[]).map((t) => finger('left', t)),
      }),
    )
    expect(oneHand.title).toBe('Còn thiếu đầu ngón')
    expect(oneHand.detail).toMatch(/5 đầu ngón hợp lệ.*chưa thấy tay phải/)
    const stale = buildGuidance(
      base({
        handsSeen: 2,
        reveal: { kind: 'closed', reason: 'stale-point' },
        fingers: [finger('left', 4), finger('left', 8), finger('right', 4, 'stale-point')],
      }),
    )
    expect(stale.title).toBe('Mất dấu đầu ngón')
    expect(stale.detail).toMatch(/điểm cũ bị bỏ/)
  })

  it('worker tay đang nạp hay lỗi đứng trước lý do đóng; nguồn chuột không xét worker tay', () => {
    const loading = buildGuidance(base({ hands: 'loading', handsSeen: 0 }))
    expect(loading.tone).toBe('wait')
    expect(loading.title).toMatch(/Đang nạp bộ nhận diện tay/)
    expect(loading.reason).toBe('few-points')
    const failed = buildGuidance(base({ hands: 'error' }))
    expect(failed.tone).toBe('error')
    const mouse = buildGuidance(
      base({ source: 'mouse', hands: 'off', reveal: { kind: 'closed', reason: 'user' } }),
    )
    expect(mouse.title).toBe('Mở cửa sổ bằng chuột')
  })

  it('nguồn chuột: mọi CloseReason có thông điệp; config-changed và too-small riêng', () => {
    for (const reason of CLOSE_REASONS) {
      const g = buildGuidance(
        base({ source: 'mouse', hands: 'off', reveal: { kind: 'closed', reason } }),
      )
      expect(g.reason, reason).toBe(reason)
      expect(g.detail.length, reason).toBeGreaterThan(0)
    }
    expect(
      buildGuidance(
        base({
          source: 'mouse',
          hands: 'off',
          reveal: { kind: 'closed', reason: 'config-changed' },
        }),
      ).detail,
    ).toMatch(/Space/)
    expect(
      buildGuidance(
        base({ source: 'mouse', hands: 'off', reveal: { kind: 'closed', reason: 'too-small' } }),
      ).title,
    ).toBe('Cửa sổ quá nhỏ')
  })
})

describe('buildGuidance: vùng mở (bước 3)', () => {
  it('mỗi trạng thái có thông điệp riêng, reason null, tone theo trạng thái; limited thêm câu chạm mép', () => {
    const titles = new Set<string>()
    for (const status of OPEN_STATUSES) {
      const g = buildGuidance({ ...OPEN, status })
      expect(g.step, status).toBe(3)
      expect(g.reason, status).toBeNull()
      titles.add(g.title)
      expect(g.detail).not.toContain('chạm mép')
      expect(buildGuidance({ ...OPEN, status, limited: true }).detail).toContain('chạm mép')
    }
    expect(titles.size).toBe(OPEN_STATUSES.length)
    expect(buildGuidance({ ...OPEN, status: 'face-candidate' }).tone).toBe('ok')
    expect(buildGuidance({ ...OPEN, status: 'partial-face' }).tone).toBe('warn')
    expect(buildGuidance({ ...OPEN, status: 'searching' }).tone).toBe('wait')
  })

  it('too-small và partial-face nói cách sửa theo nguồn (tay: tách tay; chuột: lăn chuột)', () => {
    expect(buildGuidance({ ...OPEN, status: 'too-small' }).detail).toMatch(/tách hai tay/)
    expect(
      buildGuidance({ ...OPEN, source: 'mouse', hands: 'off', status: 'too-small' }).detail,
    ).toMatch(/Lăn chuột/)
    expect(
      buildGuidance({ ...OPEN, source: 'mouse', hands: 'off', status: 'partial-face' }).detail,
    ).toMatch(/lăn chuột/)
  })

  it('worker mặt đang nạp hay lỗi đứng trước trạng thái; covered khi mở là frame chuyển tiếp', () => {
    const loading = buildGuidance({ ...OPEN, face: 'loading', status: 'face-candidate' })
    expect(loading.title).toMatch(/Đang nạp bộ nhận diện mặt/)
    expect(loading.step).toBe(3)
    expect(buildGuidance({ ...OPEN, face: 'error' }).tone).toBe('error')
    expect(buildGuidance({ ...OPEN, status: 'covered' }).step).toBe(2)
  })
})
