import { describe, expect, it } from 'vitest'
import { CONSENT_VERSION, consentScopeNote } from '../../src/app/session'
import { DEFAULTS } from '../../src/core/config'

// UX-02 bước 4 (mục 7.21, D-021): dòng phạm vi đồng ý trên màn hình bắt đầu chỉ hiện ở chế độ kiosk (tab).
describe('consentScopeNote', () => {
  it('tab (kiosk) nói rõ đồng ý chỉ có hiệu lực trong tab; device không có dòng thêm', () => {
    expect(consentScopeNote('tab')).toMatch(/chỉ có hiệu lực trong tab này/)
    expect(consentScopeNote('device')).toBeNull()
    expect(consentScopeNote(DEFAULTS.consent.scope)).toBeNull()
  })

  it('CONSENT_VERSION là chuỗi ngày ISO (đổi văn bản thì tăng)', () => {
    expect(CONSENT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
