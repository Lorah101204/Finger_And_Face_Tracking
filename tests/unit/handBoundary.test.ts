import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// HAND-01: hand.worker.ts là worker DUY NHẤT nhận frame gốc (mục 5.4); createImageBitmap chỉ ở hands/handClient.ts;
// hands/ không import face/ hay classify/ (và ngược lại đã có faceBoundary.test.ts + lint:boundaries).
function codeOnly(text: string): string {
  return text
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
    .join('\n')
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

describe('ranh giới hand pipeline', () => {
  it('hand.worker.ts: một handler nhận ảnh (detectForVideo cho warm-up và detect), đóng bitmap, không đụng video', () => {
    const text = codeOnly(readFileSync('src/hands/hand.worker.ts', 'utf8'))
    expect(text.match(/landmarker\.detectForVideo\(/g)?.length).toBe(2)
    expect(text).not.toMatch(/HTMLVideoElement|MediaStream|getUserMedia|drawImage|\.detect\(/)
    expect(text).toMatch(/frame\.input\.close\(\)/)
    expect(text).toMatch(/runningMode: 'VIDEO'/)
  })

  it('src/hands/** không import face/ hay classify/', () => {
    for (const f of walk('src/hands')) {
      const text = readFileSync(f, 'utf8')
      for (const m of text.matchAll(/from '([^']+)'/g)) {
        expect({ file: f, spec: m[1], ok: !/\/(face|classify)\//.test(m[1]) }).toEqual({
          file: f,
          spec: m[1],
          ok: true,
        })
      }
    }
  })

  it('createImageBitmap( chỉ xuất hiện ở src/hands/handClient.ts trong toàn bộ src/', () => {
    const hits = walk('src')
      .filter((f) => /\bcreateImageBitmap\s*\(/.test(codeOnly(readFileSync(f, 'utf8'))))
      .map((f) => f.replace(/\\/g, '/'))
    expect(hits).toEqual(['src/hands/handClient.ts'])
  })
})
