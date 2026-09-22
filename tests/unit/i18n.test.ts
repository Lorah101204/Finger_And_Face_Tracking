import { describe, expect, it } from 'vitest'
import { buildGuidance, guideSteps, mouseKeys, type GuidanceInput } from '../../src/app/guidance'
import { describeRecorder } from '../../src/app/datasetText'
import { subjectText } from '../../src/classify/subjectRule'
import {
  createLangStore,
  DEFAULT_LANG,
  LANG_KEY,
  LANGS,
  readLang,
  t,
  writeLang,
  type Lang,
  type LangStorageLike,
} from '../../src/core/i18n'
import { en } from '../../src/core/i18n/en'
import { vi } from '../../src/core/i18n/vi'
import type { CloseReason, FrameOutput } from '../../src/core/types'
import { fingerName, fingertipsGuidance, handName } from '../../src/hands/fingertips'

// I18N-01 (mục 7.31): hai từ điển cùng hình dạng; bản tiếng Anh không còn dấu tiếng Việt; đọc ngôn ngữ theo thứ tự
// query > storage > mặc định; mọi hàm sinh chữ nhận `lang`.
const VI_DIACRITICS =
  /[ăâđêôơưàảãáạằẳẵắặầẩẫấậèẻẽéẹềểễếệìỉĩíịòỏõóọồổỗốộờởỡớợùủũúụừửữứựỳỷỹýỵĂÂĐÊÔƠƯÀẢÃÁẠẰẲẴẮẶẦẨẪẤẬÈẺẼÉẸỀỂỄẾỆÌỈĨÍỊÒỎÕÓỌỒỔỖỐỘỜỞỠỚỢÙỦŨÚỤỪỬỮỨỰỲỶỸÝỴ]/

/** Mọi lá chuỗi của từ điển; hàm được gọi với tham số mẫu để lấy chuỗi ra. */
function leaves(node: unknown, path: string, out: { path: string; text: string }[]): void {
  if (typeof node === 'string') out.push({ path, text: node })
  else if (typeof node === 'function') {
    const args = Array.from({ length: node.length }, (_, i) => (i === 0 ? 'x' : 2))
    const sample = (node as (...a: unknown[]) => unknown)(...args)
    if (typeof sample === 'string') out.push({ path: `${path}()`, text: sample })
  } else if (Array.isArray(node)) node.forEach((v, i) => leaves(v, `${path}[${i}]`, out))
  else if (node && typeof node === 'object')
    for (const [k, v] of Object.entries(node)) leaves(v, `${path}.${k}`, out)
}

function keyShape(node: unknown): unknown {
  if (Array.isArray(node)) return `array:${node.length}`
  if (typeof node === 'function') return `fn:${node.length}`
  if (node && typeof node === 'object')
    return Object.fromEntries(
      Object.entries(node)
        .sort()
        .map(([k, v]) => [k, keyShape(v)]),
    )
  return typeof node
}

function memory(initial: Record<string, string> = {}): LangStorageLike & {
  data: Record<string, string>
} {
  const data = { ...initial }
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v
    },
  }
}

describe('từ điển', () => {
  it('vi và en cùng khóa, cùng loại (chuỗi, hàm cùng số tham số, mảng cùng độ dài)', () => {
    expect(keyShape(en)).toEqual(keyShape(vi))
    expect(t('vi')).toBe(vi)
    expect(t('en')).toBe(en)
    expect(LANGS).toEqual(['vi', 'en'])
    expect(DEFAULT_LANG).toBe('vi')
  })

  it('không lá nào của en còn dấu tiếng Việt (trừ tên ngôn ngữ "Tiếng Việt"); vi có ít nhất 150 lá', () => {
    const out: { path: string; text: string }[] = []
    leaves(en, 'en', out)
    const bad = out.filter(
      (l) => VI_DIACRITICS.test(l.text) && !/\.names\.vi$|\.switchTo\.vi$/.test(l.path),
    )
    expect(bad, bad.map((b) => b.path).join(', ')).toEqual([])
    const viLeaves: { path: string; text: string }[] = []
    leaves(vi, 'vi', viLeaves)
    expect(viLeaves.length).toBeGreaterThan(150)
    expect(out.length).toBe(viLeaves.length)
  })

  it('mọi lá của en và vi là chuỗi không rỗng sau khi bỏ khoảng trắng đầu', () => {
    for (const dict of [vi, en]) {
      const out: { path: string; text: string }[] = []
      leaves(dict, 'd', out)
      for (const l of out) expect(l.text.trim().length, l.path).toBeGreaterThan(0)
    }
  })

  // UX-05 (D-060): chú thích cho mọi tham số độ nhạy; mỗi chú thích là một câu giải thích (≥ 40 ký tự) chứ không phải
  // nhãn lặp lại; tên trợ năng chung của nút "?" không chứa nhãn hay aria-label của mục nào (getByLabel của e2e không
  // được trúng hai phần tử).
  it('settings.help: đủ khóa cho mọi tham số độ nhạy, câu đủ dài, tên nút không trùng nhãn mục', () => {
    for (const dict of [vi, en]) {
      const help = dict.settings.help
      const fields = Object.keys(dict.settings.sensitivity.fields).sort()
      expect(Object.keys(help.sensitivity).sort()).toEqual(fields)
      const out: { path: string; text: string }[] = []
      leaves(help, 'help', out)
      for (const l of out) {
        if (l.path === 'help.aria') continue
        expect(l.text.length, l.path).toBeGreaterThanOrEqual(40)
      }
      const all: { path: string; text: string }[] = []
      leaves(dict.settings, 's', all)
      for (const l of all) {
        if (l.path.startsWith('s.help') || l.path === 's.title') continue
        if (l.text.length < 3 || l.path.endsWith('()')) continue
        expect(help.aria.toLowerCase().includes(l.text.toLowerCase()), `${l.path}: ${l.text}`).toBe(
          false,
        )
      }
    }
  })
})

describe('readLang, writeLang, kho', () => {
  it('thứ tự: ?lang= trên query, rồi storage, rồi mặc định; giá trị lạ bỏ qua', () => {
    expect(readLang(null, null)).toBe('vi')
    expect(readLang(memory({ [LANG_KEY]: 'en' }), null)).toBe('en')
    expect(readLang(memory({ [LANG_KEY]: 'en' }), '?lang=vi')).toBe('vi')
    expect(readLang(memory({ [LANG_KEY]: 'fr' }), null)).toBe('vi')
    expect(readLang(memory(), '?debug=1&lang=en')).toBe('en')
    expect(readLang(memory(), 'lang=en')).toBe('en')
    expect(readLang(memory(), '?lang=de')).toBe('vi')
    expect(readLang(memory({ [LANG_KEY]: 'en' }), '?lang=de')).toBe('en')
    expect(readLang(null, null, 'en')).toBe('en')
  })

  it('storage bị chặn: đọc về mặc định, ghi không ném; ghi rồi đọc lại', () => {
    const broken: LangStorageLike = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(readLang(broken, null)).toBe('vi')
    expect(() => writeLang(broken, 'en')).not.toThrow()
    const s = memory()
    writeLang(s, 'en')
    expect(s.data[LANG_KEY]).toBe('en')
    expect(readLang(s, null)).toBe('en')
    writeLang(null, 'en')
  })

  it('kho: set khác giá trị mới báo; hủy đăng ký thì thôi', () => {
    const store = createLangStore()
    const seen: Lang[] = []
    const off = store.subscribe(() => seen.push(store.get()))
    store.set('vi')
    store.set('en')
    store.set('en')
    expect(seen).toEqual(['en'])
    off()
    store.set('vi')
    expect(seen).toEqual(['en'])
    expect(store.get()).toBe('vi')
  })
})

describe('hàm sinh chữ theo ngôn ngữ', () => {
  const REASONS: CloseReason[] = [
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
  const STATUSES: FrameOutput['status'][] = [
    'searching',
    'too-small',
    'face-candidate',
    'partial-face',
    'covered',
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

  it('buildGuidance tiếng Anh: mọi pha camera, lý do đóng (hai nguồn) và trạng thái mở đều không có dấu tiếng Việt', () => {
    const inputs: GuidanceInput[] = []
    for (const camera of [
      'off',
      'requesting',
      'switching',
      'stalled',
      'hidden',
      'ended',
      'error',
    ] as const)
      inputs.push(base({ camera }))
    for (const source of ['hands', 'mouse'] as const)
      for (const reason of REASONS)
        for (const handsSeen of [0, 2])
          inputs.push(base({ source, handsSeen, reveal: { kind: 'closed', reason } }))
    for (const hands of ['loading', 'error'] as const) inputs.push(base({ hands }))
    for (const source of ['hands', 'mouse'] as const)
      for (const status of STATUSES)
        for (const limited of [false, true])
          inputs.push(
            base({
              source,
              status,
              limited,
              reveal: { kind: 'open', mask: {} as never },
              subject:
                status === 'face-candidate' ? { subjectType: 'person', confidence: 0.9 } : null,
            }),
          )
    for (const face of ['loading', 'error'] as const)
      inputs.push(base({ face, reveal: { kind: 'open', mask: {} as never }, status: 'searching' }))
    for (const input of inputs) {
      const g = buildGuidance(input, 'en')
      expect(VI_DIACRITICS.test(g.title + g.detail), JSON.stringify(input)).toBe(false)
      expect(g.title.length).toBeGreaterThan(0)
      // Cùng bước, tone và reason như bản tiếng Việt.
      const v = buildGuidance(input, 'vi')
      expect([g.step, g.tone, g.reason]).toEqual([v.step, v.tone, v.reason])
    }
    expect(buildGuidance(base(), 'en').title).toBe('Bring both hands in front of the camera')
    expect(buildGuidance(base()).title).toBe('Đưa hai bàn tay vào trước camera')
    expect(guideSteps('en').map((s) => s.label)).toEqual(['Camera', 'Window', 'Face'])
    expect(guideSteps().map((s) => s.label)).toEqual(['Camera', 'Cửa sổ', 'Khuôn mặt'])
    expect(mouseKeys('en')).toMatch(/Space reopens/)
  })

  it('subjectText, fingerName, handName, fingertipsGuidance, describeRecorder theo lang', () => {
    expect(subjectText({ subjectType: 'person', confidence: 0.93 }, true, 'en')).toBe(
      'Person 93 % · demo',
    )
    expect(subjectText({ subjectType: 'mannequin', confidence: 0.8 }, false, 'en')).toBe(
      'Mannequin 80 %',
    )
    expect(subjectText({ subjectType: 'unknown' }, false, 'en')).toBe('Unclassified face')
    expect(subjectText({ subjectType: 'person', confidence: 0.93 }, true)).toBe('Người 93 % · demo')
    expect(fingerName(4, 'en')).toBe('thumb')
    expect(fingerName(4)).toBe('cái')
    expect(handName('left', 'en')).toBe('Left')
    expect(fingertipsGuidance([], {}, 'en')).toMatch(/^Bring both hands into the frame/)
    expect(fingertipsGuidance([], {})).toMatch(/^Đưa hai bàn tay vào khung hình/)
    const snap = {
      enabled: true,
      recording: true,
      count: 3,
      rateHz: 2,
      sink: null,
      inMemory: 3,
      bytes: 2048,
      session: 's',
      error: null,
    }
    expect(describeRecorder(snap as never, 'en')).toBe(
      'capturing, 3 samples · 2 Hz · memory (3 samples, 2 KB)',
    )
    expect(describeRecorder(snap as never)).toBe('đang thu 3 mẫu · 2 Hz · bộ nhớ (3 mẫu, 2 KB)')
  })
})
