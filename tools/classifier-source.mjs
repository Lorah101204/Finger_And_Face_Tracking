// REL-02 (D-068): nguồn của model phân loại huấn luyện cho CI và trang public. classifier.onnx không commit vào main
// (D-061); tools/publish-classifier.mjs đưa nó lên nhánh `models` của repo dưới tên mang 12 hex đầu của sha256 và ghi vào
// models.json `classifier.source` một URL raw.githubusercontent.com ghim theo commit. models:fetch (syncClassifier) tải
// file đó khi máy chưa có model và đối chiếu sha256; một file cục bộ lệch sha256 là sản phẩm huấn luyện nên được giữ
// nguyên, không bao giờ bị ghi đè hay xóa.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SHA256 = /^[0-9a-f]{64}$/
const COMMIT = /^[0-9a-f]{40}$/

export const sha256Hex = (buf) => createHash('sha256').update(buf).digest('hex')

/** Tên file khi publish: 12 hex đầu của sha256 nằm trong tên, nên `source` tự cho biết nó có phải model của models.json. */
export function assetName(sha256) {
  if (!SHA256.test(sha256 ?? '')) throw new Error(`sha256 không hợp lệ: '${sha256}'`)
  return `classifier-${sha256.slice(0, 12)}.onnx`
}

/** owner và repo của một remote github.com (https, ssh dạng scp hay ssh://); null với host khác. */
export function parseGithubRemote(url) {
  const m =
    /^https:\/\/(?:[^@/]+@)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url) ??
    /^(?:ssh:\/\/)?git@github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url)
  return m ? { owner: m[1], repo: m[2] } : null
}

export const rawUrl = ({ owner, repo, commit, file }) =>
  `https://raw.githubusercontent.com/${owner}/${repo}/${commit}/${file}`

/**
 * Lý do `classifier.source` không dùng được với mục classifier này; null khi dùng được. Trống là hợp lệ (chưa publish:
 * máy không có model thì app dùng stub). Có giá trị thì: sha256 đủ 64 hex, URL https, tên file chứa 12 hex đầu của
 * sha256 (bắt trường hợp train lại, export --manifest mà chưa publish), và trên raw.githubusercontent.com thì ref là một
 * commit 40 hex, không phải tên nhánh có thể đổi.
 */
export function sourceProblem(cls) {
  const source = cls?.source ?? ''
  if (!source) return null
  if (!SHA256.test(cls.sha256 ?? ''))
    return 'classifier.source có giá trị nhưng classifier.sha256 không phải 64 hex'
  let u
  try {
    u = new URL(source)
  } catch {
    return `classifier.source không phải URL: '${source}'`
  }
  if (u.protocol !== 'https:') return `classifier.source phải là https: '${source}'`
  const file = u.pathname.slice(u.pathname.lastIndexOf('/') + 1)
  const tag = cls.sha256.slice(0, 12)
  if (!file.includes(tag))
    return (
      `classifier.source trỏ tới ${file}, không phải model của models.json (sha256 ${tag}…): ` +
      'sau mỗi lần export_onnx.py --manifest chạy npm run models:publish'
    )
  if (u.hostname === 'raw.githubusercontent.com') {
    const ref = u.pathname.split('/')[3] ?? ''
    if (!COMMIT.test(ref)) return `classifier.source phải ghim một commit (40 hex), nhận '${ref}'`
  }
  return null
}

/**
 * Bước model phân loại huấn luyện của models:fetch. Trả về:
 * - 'ok': file có và khớp sha256 của models.json;
 * - 'downloaded': chưa có file, tải từ `source`, khớp sha256, ghi qua file tạm rồi đổi tên;
 * - 'kept': file có nhưng lệch sha256: giữ nguyên (có thể là model vừa train), app dùng stub;
 * - 'none': không file, không source: app dùng stub.
 * Lỗi HTTP, sha256 tải về lệch hay `source` không hợp lệ thì ném lỗi: CI dừng thay vì lặng lẽ build trang public với stub.
 */
export async function syncClassifier({ cls, modelsDir, fetchImpl = fetch, log = console.log }) {
  if (!cls?.file) return 'none'
  const dest = join(modelsDir, cls.file)
  const have = existsSync(dest) ? sha256Hex(readFileSync(dest)) : null
  if (have && have === cls.sha256) {
    log(`ok    ${cls.file} (model phân loại huấn luyện)`)
    return 'ok'
  }
  if (have) {
    log(
      `lệch  ${cls.file}: sha256 ${have.slice(0, 12)} khác models.json (${(cls.sha256 || 'trống').slice(0, 12)}); giữ nguyên` +
        ` file, app dùng stub tới khi export_onnx.py --manifest ghi lại` +
        (cls.source ? ' (hay xóa file để models:fetch tải bản đã publish)' : ''),
    )
    return 'kept'
  }
  if (!cls.source) {
    log(
      `none  ${cls.file}: chưa có model huấn luyện và chưa có source; app dùng stub (tools/train, docs/classifier-report.md)`,
    )
    return 'none'
  }
  const problem = sourceProblem(cls)
  if (problem) throw new Error(problem)
  log(`get   ${cls.file} <- ${cls.source}`)
  const res = await fetchImpl(cls.source)
  if (!res.ok) throw new Error(`HTTP ${res.status} khi tải ${cls.source}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const got = sha256Hex(buf)
  if (got !== cls.sha256)
    throw new Error(`sha256 không khớp cho ${cls.file}: manifest ${cls.sha256}, tải về ${got}`)
  const tmp = `${dest}.download`
  writeFileSync(tmp, buf)
  renameSync(tmp, dest)
  log(`done  ${cls.file} (${(buf.length / 1e6).toFixed(2)} MB, sha256 ${got.slice(0, 12)}...)`)
  return 'downloaded'
}
