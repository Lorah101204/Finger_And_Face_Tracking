import { describe, expect, it } from 'vitest'
import { readUiState, UI_KEY, writeUiState, type StorageLike } from '../../src/app/uiState'

// UX-01 (mục 7.20): trạng thái panel lưu trong storage của tab; giá trị hỏng, thiếu hay storage ném lỗi thì về mặc định.
// UX-03 (mục 7.28): thêm `present` (chế độ trình diễn), bản ghi cũ thiếu trường thì lấy mặc định.
const DEFAULTS = { settingsOpen: true, debugOpen: false, present: false }

function memory(
  initial: Record<string, string> = {},
): StorageLike & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v
    },
  }
}

describe('uiState', () => {
  it('ghi rồi đọc lại đúng; thiếu khóa hay storage null thì mặc định (bản sao)', () => {
    const s = memory()
    writeUiState(s, { settingsOpen: false, debugOpen: true, present: true })
    expect(JSON.parse(s.data[UI_KEY])).toEqual({
      settingsOpen: false,
      debugOpen: true,
      present: true,
    })
    expect(readUiState(s, DEFAULTS)).toEqual({
      settingsOpen: false,
      debugOpen: true,
      present: true,
    })
    expect(readUiState(memory(), DEFAULTS)).toEqual(DEFAULTS)
    expect(readUiState(memory(), DEFAULTS)).not.toBe(DEFAULTS)
    expect(readUiState(null, DEFAULTS)).toEqual(DEFAULTS)
    writeUiState(null, DEFAULTS)
  })

  it('giá trị hỏng hay sai kiểu thì từng trường về mặc định', () => {
    expect(readUiState(memory({ [UI_KEY]: '{oops' }), DEFAULTS)).toEqual(DEFAULTS)
    expect(readUiState(memory({ [UI_KEY]: '42' }), DEFAULTS)).toEqual(DEFAULTS)
    expect(readUiState(memory({ [UI_KEY]: 'null' }), DEFAULTS)).toEqual(DEFAULTS)
    expect(
      readUiState(
        memory({ [UI_KEY]: JSON.stringify({ settingsOpen: 'yes', debugOpen: true }) }),
        DEFAULTS,
      ),
    ).toEqual({ settingsOpen: true, debugOpen: true, present: false })
    // Bản ghi của UX-01 (chưa có present): đọc được, present theo mặc định của trang (?mode=present → true).
    expect(
      readUiState(memory({ [UI_KEY]: JSON.stringify({ settingsOpen: false, debugOpen: false }) }), {
        ...DEFAULTS,
        present: true,
      }),
    ).toEqual({ settingsOpen: false, debugOpen: false, present: true })
  })

  it('storage ném lỗi (bị chặn) thì đọc về mặc định và ghi không ném', () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(readUiState(broken, DEFAULTS)).toEqual(DEFAULTS)
    expect(() => writeUiState(broken, DEFAULTS)).not.toThrow()
  })
})
