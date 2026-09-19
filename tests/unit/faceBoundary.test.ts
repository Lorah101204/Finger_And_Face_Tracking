import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// FACE-01: kiểm ranh giới import ở mức test (bên cạnh lint:boundaries). src/face/** và src/classify/** chỉ được import
// core/, file cùng thư mục và thư viện model; không có đường nào tới camera/, mask/, loop/, debug/, app/ (bất biến I1).
const DIRS = ['src/face', 'src/classify']
const LIBS = ['@mediapipe/', 'onnxruntime-web']

function specifiers(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/from '([^']+)'/g)) out.push(m[1])
  for (const m of text.matchAll(/import\('([^']+)'\)/g)) out.push(m[1])
  return out
}

function allowed(spec: string): boolean {
  if (spec.startsWith('./')) return !spec.includes('/../')
  if (spec.startsWith('../core/')) return true
  return LIBS.some((l) => spec.startsWith(l))
}

describe('ranh giới import của face/ và classify/', () => {
  for (const dir of DIRS) {
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'))
    it(`${dir}: có file và mọi import đều hợp lệ`, () => {
      expect(files.length).toBeGreaterThan(0)
      for (const f of files) {
        const text = readFileSync(join(dir, f), 'utf8')
        for (const spec of specifiers(text)) {
          expect({ file: f, spec, ok: allowed(spec) }).toEqual({ file: f, spec, ok: true })
        }
      }
    })
  }

  it('face.worker.ts chỉ có một handler nhận ảnh (detect) và không đụng video hay MediaStream', () => {
    // Bỏ dòng chú thích để không bắt nhầm ghi chú nhắc tới tên hàm.
    const text = readFileSync('src/face/face.worker.ts', 'utf8')
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
      .join('\n')
    expect(text.match(/landmarker\.detect\(/g)?.length).toBe(2) // warm-up và detect
    expect(text).not.toMatch(/HTMLVideoElement|MediaStream|getUserMedia|drawImage/)
    expect(text).toMatch(/frame\.input\.close\(\)/)
  })
})
