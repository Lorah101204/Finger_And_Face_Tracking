import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assetName,
  parseGithubRemote,
  rawUrl,
  sourceProblem,
  syncClassifier,
} from '../../tools/classifier-source.mjs'
import { publishClassifier } from '../../tools/publish-classifier.mjs'

// REL-02 (mục 7.41, D-068): nguồn của model phân loại huấn luyện cho CI và trang public. classifier-source.mjs kiểm
// classifier.source và tải model (models:fetch); publish-classifier.mjs đưa model lên nhánh `models` bằng git cấp thấp,
// thử ở đây trên một repo bare cục bộ thay cho GitHub.
const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex')
const SHA_A = sha('model A')
const COMMIT = 'c'.repeat(40)
const okUrl = (s: string) => rawUrl({ owner: 'o', repo: 'r', commit: COMMIT, file: assetName(s) })

const temps: string[] = []
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'wct-rel02-'))
  temps.push(d)
  return d
}
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** fetch giả: trả `body` (chuỗi, byte UTF-8) hay 404 khi null; ghi lại các URL được gọi. */
const fakeFetch = (body: string | null) => {
  const calls: string[] = []
  const fn = async (url: string) => {
    calls.push(url)
    return body !== null ? new Response(body) : new Response('missing', { status: 404 })
  }
  return { fn, calls }
}

describe('nguồn model đã publish (classifier-source.mjs)', () => {
  it('tên file mang 12 hex đầu của sha256; sha256 hỏng thì lỗi', () => {
    expect(assetName(SHA_A)).toBe(`classifier-${SHA_A.slice(0, 12)}.onnx`)
    expect(() => assetName('abc')).toThrow(/sha256/)
  })

  it('owner/repo của remote github.com ở mọi dạng URL; host khác trả null', () => {
    const want = { owner: 'Lorah101204', repo: 'Finger_And_Face_Tracking' }
    for (const u of [
      'https://github.com/Lorah101204/Finger_And_Face_Tracking.git',
      'https://github.com/Lorah101204/Finger_And_Face_Tracking',
      'https://github.com/Lorah101204/Finger_And_Face_Tracking/',
      'https://user@github.com/Lorah101204/Finger_And_Face_Tracking.git',
      'git@github.com:Lorah101204/Finger_And_Face_Tracking.git',
      'ssh://git@github.com/Lorah101204/Finger_And_Face_Tracking.git',
    ])
      expect(parseGithubRemote(u), u).toEqual(want)
    expect(parseGithubRemote('https://gitlab.com/a/b.git')).toBeNull()
    expect(parseGithubRemote('E:/repos/remote.git')).toBeNull()
  })

  it('source trống hợp lệ; có giá trị thì phải https, mang sha của models.json và ghim commit trên raw', () => {
    expect(sourceProblem({ sha256: SHA_A, source: '' })).toBeNull()
    expect(sourceProblem(undefined)).toBeNull()
    expect(sourceProblem({ sha256: SHA_A, source: okUrl(SHA_A) })).toBeNull()
    // Asset của một GitHub Release cũng được khi tên mang sha.
    expect(
      sourceProblem({
        sha256: SHA_A,
        source: `https://github.com/o/r/releases/download/v1/${assetName(SHA_A)}`,
      }),
    ).toBeNull()
    expect(sourceProblem({ sha256: SHA_A, source: okUrl(SHA_A).replace('https', 'http') })).toMatch(
      /https/,
    )
    // Train lại, export --manifest đổi sha256 mà chưa publish: source vẫn trỏ model cũ.
    expect(sourceProblem({ sha256: sha('model B'), source: okUrl(SHA_A) })).toMatch(
      /models:publish/,
    )
    expect(
      sourceProblem({ sha256: SHA_A, source: okUrl(SHA_A).replace(COMMIT, 'models') }),
    ).toMatch(/commit/)
    expect(sourceProblem({ sha256: '', source: okUrl(SHA_A) })).toMatch(/64 hex/)
    expect(sourceProblem({ sha256: SHA_A, source: 'not a url' })).toMatch(/URL/)
  })

  it('models.json trong repo publish model huấn luyện: source hợp lệ, ghim commit và mang đúng sha256 (REL-02)', () => {
    const manifest = JSON.parse(readFileSync('public/models/models.json', 'utf8')) as {
      classifier: { sha256: string; source: string; file: string }
    }
    const cls = manifest.classifier
    expect(cls.source).not.toBe('')
    expect(sourceProblem(cls)).toBeNull()
    expect(cls.source).toMatch(
      new RegExp(
        `^https://raw\\.githubusercontent\\.com/[\\w.-]+/[\\w.-]+/[0-9a-f]{40}/${assetName(cls.sha256)}$`,
      ),
    )
  })
})

describe('bước model phân loại của models:fetch (syncClassifier)', () => {
  const setup = (local: string | null, source: string, manifestSha = SHA_A) => {
    const dir = tempDir()
    if (local !== null) writeFileSync(join(dir, 'classifier.onnx'), local)
    return { dir, cls: { file: 'classifier.onnx', sha256: manifestSha, source } }
  }
  const quiet = () => {}

  it('file khớp: ok, không tải', async () => {
    const { dir, cls } = setup('model A', okUrl(SHA_A))
    const f = fakeFetch(null)
    expect(await syncClassifier({ cls, modelsDir: dir, fetchImpl: f.fn, log: quiet })).toBe('ok')
    expect(f.calls).toEqual([])
  })

  it('chưa có file, có source: tải, đối chiếu sha256, ghi file (không để lại file tạm)', async () => {
    const { dir, cls } = setup(null, okUrl(SHA_A))
    const f = fakeFetch('model A')
    expect(await syncClassifier({ cls, modelsDir: dir, fetchImpl: f.fn, log: quiet })).toBe(
      'downloaded',
    )
    expect(f.calls).toEqual([okUrl(SHA_A)])
    expect(readFileSync(join(dir, 'classifier.onnx'), 'utf8')).toBe('model A')
    expect(existsSync(join(dir, 'classifier.onnx.download'))).toBe(false)
  })

  it('tải về lệch sha256 hay HTTP lỗi: ném lỗi và không ghi gì', async () => {
    const a = setup(null, okUrl(SHA_A))
    await expect(
      syncClassifier({
        cls: a.cls,
        modelsDir: a.dir,
        fetchImpl: fakeFetch('model X').fn,
        log: quiet,
      }),
    ).rejects.toThrow(/sha256 không khớp/)
    expect(existsSync(join(a.dir, 'classifier.onnx'))).toBe(false)
    const b = setup(null, okUrl(SHA_A))
    await expect(
      syncClassifier({ cls: b.cls, modelsDir: b.dir, fetchImpl: fakeFetch(null).fn, log: quiet }),
    ).rejects.toThrow(/HTTP 404/)
    expect(existsSync(join(b.dir, 'classifier.onnx'))).toBe(false)
  })

  it('file cục bộ lệch sha256 (vừa train) được giữ nguyên dù có source; không tải', async () => {
    const { dir, cls } = setup('model vừa train', okUrl(SHA_A))
    const f = fakeFetch('model A')
    const lines: string[] = []
    expect(
      await syncClassifier({ cls, modelsDir: dir, fetchImpl: f.fn, log: (l) => lines.push(l) }),
    ).toBe('kept')
    expect(f.calls).toEqual([])
    expect(readFileSync(join(dir, 'classifier.onnx'), 'utf8')).toBe('model vừa train')
    expect(lines.join('\n')).toMatch(/giữ nguyên/)
  })

  it('không file, không source: none; source sai quy tắc: ném lỗi trước khi tải', async () => {
    const a = setup(null, '')
    expect(await syncClassifier({ cls: a.cls, modelsDir: a.dir, log: quiet })).toBe('none')
    const b = setup(null, okUrl(SHA_A).replace(COMMIT, 'main'))
    const f = fakeFetch('model A')
    await expect(
      syncClassifier({ cls: b.cls, modelsDir: b.dir, fetchImpl: f.fn, log: quiet }),
    ).rejects.toThrow(/commit/)
    expect(f.calls).toEqual([])
  })
})

describe('publish lên nhánh models (publish-classifier.mjs, repo bare cục bộ)', () => {
  const git = (cwd: string, args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()

  /** Repo làm việc có models.json + classifier.onnx và remote origin là một repo bare cục bộ. */
  const repoWith = () => {
    const dir = tempDir()
    const work = join(dir, 'work')
    const bare = join(dir, 'remote.git')
    git(dir, ['init', '--bare', '-q', bare])
    mkdirSync(join(work, 'public', 'models'), { recursive: true })
    git(work, ['init', '-q'])
    git(work, ['config', 'user.name', 'test'])
    git(work, ['config', 'user.email', 'test@example.com'])
    git(work, ['config', 'commit.gpgsign', 'false'])
    writeFileSync(join(work, 'README.md'), 'x\n')
    git(work, ['add', 'README.md'])
    git(work, ['commit', '-q', '-m', 'init'])
    git(work, ['remote', 'add', 'origin', bare])
    return { work, bare }
  }
  const setModel = (work: string, content: string, source = '') => {
    writeFileSync(join(work, 'public', 'models', 'classifier.onnx'), content)
    const manifest = {
      note: 'n',
      classifier: { note: 'c', stub: 'classifier-stub.onnx', file: 'classifier.onnx' },
    }
    Object.assign(manifest.classifier, {
      sha256: sha(content),
      bytes: content.length,
      labels: ['person', 'mannequin'],
      source,
      compression: { mode: 'int8+fp16w' },
    })
    writeFileSync(
      join(work, 'public', 'models', 'models.json'),
      JSON.stringify(manifest, null, 2) + '\n',
    )
  }
  const readCls = (work: string) =>
    JSON.parse(readFileSync(join(work, 'public', 'models', 'models.json'), 'utf8')).classifier as {
      sha256: string
      source: string
    }
  /** fetch giả của raw.githubusercontent.com: đọc blob từ repo bare theo commit và tên file trong URL. */
  const rawFrom = (bare: string) => {
    const calls: string[] = []
    const fn = async (url: string) => {
      calls.push(url)
      const [, , , commit, file] = new URL(url).pathname.split('/')
      try {
        const buf = execFileSync(
          'git',
          ['--git-dir', bare, 'cat-file', 'blob', `${commit}:${file}`],
          {
            stdio: ['pipe', 'pipe', 'pipe'],
          },
        )
        return new Response(new Uint8Array(buf))
      } catch {
        return new Response('404', { status: 404 })
      }
    }
    return { fn, calls }
  }
  const opts = (work: string, bare: string) => ({
    root: work,
    slug: { owner: 'o', repo: 'r' },
    fetchImpl: rawFrom(bare).fn,
    log: () => {},
    retries: 1,
    retryMs: 0,
  })

  it('lần đầu tạo nhánh mồ côi; lần sau đặt lên commit cha và giữ model cũ; models.json nhận URL ghim; chạy lại không làm gì', async () => {
    const { work, bare } = repoWith()
    setModel(work, 'model A')
    const dry = await publishClassifier({ ...opts(work, bare), dryRun: true })
    expect(dry.status).toBe('dry-run')
    expect(git(bare, ['branch', '--list', 'models'])).toBe('')

    const r1 = await publishClassifier({ ...opts(work, bare), trailer: 'Co-Authored-By: X <x@y>' })
    expect(r1.status).toBe('published')
    expect(r1.url).toBe(okUrl(SHA_A).replace(COMMIT, r1.commit!))
    expect(readCls(work).source).toBe(r1.url)
    expect(sourceProblem(readCls(work))).toBeNull()
    expect(git(bare, ['rev-parse', 'models'])).toBe(r1.commit)
    expect(git(bare, ['rev-list', '--count', 'models'])).toBe('1')
    const nameA = assetName(SHA_A)
    expect(git(bare, ['ls-tree', '--name-only', 'models']).split('\n').sort()).toEqual(
      ['README.md', nameA.replace('.onnx', '.json'), nameA].sort(),
    )
    // Byte của model trên nhánh đúng như file (không chuyển CRLF), thẻ .json mang mục classifier.
    expect(
      sha(execFileSync('git', ['--git-dir', bare, 'cat-file', 'blob', `models:${nameA}`])),
    ).toBe(SHA_A)
    const card = JSON.parse(
      git(bare, ['cat-file', 'blob', `models:${nameA.replace('.onnx', '.json')}`]),
    )
    expect(card).toMatchObject({ file: nameA, sha256: SHA_A, compression: { mode: 'int8+fp16w' } })
    expect(card.repoHead).toBe(git(work, ['rev-parse', 'HEAD']))
    expect(git(bare, ['log', '-1', '--format=%B', 'models'])).toMatch(
      /^models: classifier [0-9a-f]{12} \(int8\+fp16w, 7 bytes\)[\s\S]*Co-Authored-By: X <x@y>$/,
    )
    // Working tree và index của repo làm việc không đổi ngoài models.json.
    expect(git(work, ['status', '--porcelain', '--untracked-files=no'])).toBe('')

    const again = await publishClassifier(opts(work, bare))
    expect(again.status).toBe('already')
    expect(git(bare, ['rev-parse', 'models'])).toBe(r1.commit)

    setModel(work, 'model B', r1.url)
    const r2 = await publishClassifier(opts(work, bare))
    expect(r2.status).toBe('published')
    expect(git(bare, ['rev-parse', 'models^'])).toBe(r1.commit)
    const names = git(bare, ['ls-tree', '--name-only', 'models']).split('\n')
    expect(names).toContain(nameA)
    expect(names).toContain(assetName(sha('model B')))
    expect(readCls(work).source).toBe(r2.url)
  }, 60_000)

  it('file lệch models.json: từ chối trước khi push; URL trả sai byte: không ghi source', async () => {
    const { work, bare } = repoWith()
    setModel(work, 'model A')
    writeFileSync(join(work, 'public', 'models', 'classifier.onnx'), 'model khác')
    await expect(publishClassifier(opts(work, bare))).rejects.toThrow(/lệch sha256/)
    expect(git(bare, ['branch', '--list', 'models'])).toBe('')

    setModel(work, 'model A')
    const wrong = async () => new Response('byte khác')
    await expect(publishClassifier({ ...opts(work, bare), fetchImpl: wrong })).rejects.toThrow(
      /sha256/,
    )
    expect(readCls(work).source).toBe('')
  }, 60_000)
})
