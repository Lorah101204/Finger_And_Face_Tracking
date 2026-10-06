// REL-02 (D-068): publish model phân loại huấn luyện cho CI và trang public mà không commit nó vào main (D-061).
//
//   npm run models:publish [-- --dry-run] [--remote origin] [--branch models] [--trailer "<dòng cuối commit>"]
//
// Đưa public/models/<classifier.file> (phải khớp sha256 của models.json) lên nhánh `models` của remote dưới tên
// classifier-<12 hex sha256>.onnx, kèm classifier-<…>.json (mục classifier lúc publish) và README.md, bằng lệnh git cấp
// thấp (hash-object, mktree, commit-tree, push không force): không đụng index, working tree hay nhánh đang checkout, và
// không cần API hay token nào ngoài quyền push sẵn có. Mỗi commit giữ các file của commit cha, nên nhánh chứa mọi model
// đã publish; URL ghim theo commit, vì vậy không bao giờ force-push nhánh này. Sau khi push: tải lại URL, đối chiếu
// sha256, rồi ghi URL vào classifier.source. Bước tiếp theo là commit models.json và push main để CI (models:fetch) build
// trang public với model này. Chạy lại khi source đã đúng thì chỉ kiểm URL.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  assetName,
  parseGithubRemote,
  rawUrl,
  sha256Hex,
  sourceProblem,
} from './classifier-source.mjs'

/** Các khóa của mục classifier chép vào file .json đi kèm model (bỏ note, stub, source). */
const CARD_KEYS = [
  'sha256',
  'bytes',
  'inputSize',
  'labels',
  'norm',
  'opset',
  'train',
  'compression',
]

const readme = ({ owner, repo }) => `# models

Published model files of [Web Camera Tracking](https://github.com/${owner}/${repo}) (REL-02, D-068). The \`main\` branch does not commit trained models (D-061): \`public/models/models.json\` → \`classifier.source\` names one file of this branch by a \`raw.githubusercontent.com\` URL pinned to the commit that added it, and \`npm run models:fetch\` downloads it and checks its sha256, so CI builds the public site with that model.

- \`classifier-<first 12 hex of the sha256>.onnx\`: a trained person/mannequin classifier; \`classifier-<…>.json\`: the \`models.json\` entry it was published with (training summary, compression gates) and the commit of \`main\` checked out at the time.
- Publish with \`npm run models:publish\` on \`main\` (\`tools/publish-classifier.mjs\`), not by hand. Every commit keeps the files of its parent. Never force-push this branch: older revisions of \`models.json\` point at its commits, and rolling back means restoring an older \`classifier\` entry on \`main\`.
`

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Publish và trả { status: 'published' | 'already' | 'dry-run', url?, commit?, name }. `slug` thay owner/repo đọc từ
 * remote (unit test dùng remote là repo bare cục bộ); `fetchImpl` để kiểm URL sau khi push.
 */
export async function publishClassifier({
  root,
  remote = 'origin',
  branch = 'models',
  dryRun = false,
  trailer = '',
  slug,
  fetchImpl = fetch,
  log = console.log,
  retries = 6,
  retryMs = 5000,
}) {
  const git = (args, input) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      input,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  const manifestPath = join(root, 'public', 'models', 'models.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const cls = manifest.classifier
  if (!cls?.file || !/^[0-9a-f]{64}$/.test(cls.sha256 ?? ''))
    throw new Error('models.json chưa có classifier.file và sha256 (export_onnx.py --manifest)')
  const modelPath = join(root, 'public', 'models', cls.file)
  if (!existsSync(modelPath)) throw new Error(`chưa có ${modelPath} (export_onnx.py)`)
  const bytes = readFileSync(modelPath)
  if (sha256Hex(bytes) !== cls.sha256)
    throw new Error(
      `${cls.file} lệch sha256 của models.json: chạy export_onnx.py --manifest trước khi publish`,
    )
  const name = assetName(cls.sha256)

  // Tải URL và đối chiếu sha256; thử lại vài lần vì CDN raw có thể trễ một nhịp sau push.
  const verify = async (url) => {
    let last = ''
    for (let i = 0; i < retries; i++) {
      if (i > 0) await wait(retryMs)
      const res = await fetchImpl(url)
      if (!res.ok) {
        last = `HTTP ${res.status}`
        continue
      }
      const got = sha256Hex(Buffer.from(await res.arrayBuffer()))
      if (got !== cls.sha256) throw new Error(`${url} trả về sha256 ${got}, khác ${cls.sha256}`)
      return
    }
    throw new Error(`không tải được ${url} sau ${retries} lần (${last})`)
  }

  if (cls.source && !sourceProblem(cls)) {
    await verify(cls.source)
    log(`đã publish: ${cls.source} (sha256 khớp)`)
    return { status: 'already', url: cls.source, name }
  }

  const remoteUrl = git(['remote', 'get-url', remote])
  const repo = slug ?? parseGithubRemote(remoteUrl)
  if (!repo) throw new Error(`remote ${remote} (${remoteUrl}) không phải một repo github.com`)
  const head = git(['ls-remote', '--heads', remote, `refs/heads/${branch}`])
  const parent = head ? head.split(/\s+/)[0] : null
  if (dryRun) {
    log(
      `dry-run: sẽ đưa ${cls.file} (${bytes.length} byte) lên ${remote}/${branch} thành ${name}` +
        `${parent ? ` trên commit ${parent.slice(0, 12)}` : ' (nhánh mới)'}, kiểm URL raw rồi ghi classifier.source`,
    )
    return { status: 'dry-run', name }
  }
  if (parent) git(['fetch', '--no-tags', remote, `refs/heads/${branch}`])

  const cardName = name.replace(/\.onnx$/, '.json')
  const card = { file: name }
  for (const k of CARD_KEYS) if (cls[k] !== undefined) card[k] = cls[k]
  card.repoHead = git(['rev-parse', 'HEAD'])
  card.publishedAt = new Date().toISOString()
  const ours = new Set([name, cardName, 'README.md'])
  const kept = parent
    ? git(['ls-tree', parent])
        .split('\n')
        .filter((l) => l && !ours.has(l.slice(l.indexOf('\t') + 1)))
    : []
  const blob = (text) => git(['hash-object', '-w', '--no-filters', '--stdin'], text)
  const entries = [
    ...kept,
    `100644 blob ${git(['hash-object', '-w', '--no-filters', modelPath])}\t${name}`,
    `100644 blob ${blob(JSON.stringify(card, null, 2) + '\n')}\t${cardName}`,
    `100644 blob ${blob(readme(repo))}\tREADME.md`,
  ]
  const tree = git(['mktree'], entries.join('\n') + '\n')
  const message =
    `models: classifier ${cls.sha256.slice(0, 12)} (${cls.compression?.mode ?? 'fp32'}, ${bytes.length} bytes)\n\n` +
    `Published from main ${card.repoHead.slice(0, 12)} by tools/publish-classifier.mjs (REL-02, D-068).\n` +
    (trailer ? `\n${trailer}\n` : '')
  const commit = git(['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-F', '-'], message)
  git(['push', remote, `${commit}:refs/heads/${branch}`])
  log(`push  ${remote}/${branch} ← ${commit.slice(0, 12)} (${name}, ${bytes.length} byte)`)

  const url = rawUrl({ ...repo, commit, file: name })
  await verify(url)
  cls.source = url
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  log(`source ${url}`)
  return { status: 'published', url, commit, name }
}

const self = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (self) {
  const argv = process.argv.slice(2)
  const opt = (k) => {
    const i = argv.indexOf(k)
    return i >= 0 ? argv[i + 1] : undefined
  }
  try {
    const r = await publishClassifier({
      root: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
      remote: opt('--remote'),
      branch: opt('--branch'),
      trailer: opt('--trailer'),
      dryRun: argv.includes('--dry-run'),
    })
    if (r.status === 'published')
      console.log(
        'Tiếp theo: commit public/models/models.json rồi push main; CI (models:fetch) tải model này và build trang public.',
      )
  } catch (e) {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  }
}
