// Khai báo kiểu cho tools/classifier-source.mjs (REL-02; unit test tests/unit/classifierSource.test.ts import trực tiếp).
export type ClassifierEntry = {
  file?: string
  sha256?: string
  source?: string
  [k: string]: unknown
}
export type FetchLike = (url: string) => Promise<Response>
export function sha256Hex(buf: Uint8Array | string): string
export function assetName(sha256: string): string
export function parseGithubRemote(url: string): { owner: string; repo: string } | null
export function rawUrl(p: { owner: string; repo: string; commit: string; file: string }): string
export function sourceProblem(cls: ClassifierEntry | undefined): string | null
export function syncClassifier(opts: {
  cls: ClassifierEntry | undefined
  modelsDir: string
  fetchImpl?: FetchLike
  log?: (line: string) => void
}): Promise<'ok' | 'downloaded' | 'kept' | 'none'>
