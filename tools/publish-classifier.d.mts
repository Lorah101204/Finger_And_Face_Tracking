// Khai báo kiểu cho tools/publish-classifier.mjs (REL-02; unit test tests/unit/classifierSource.test.ts import trực tiếp).
import type { FetchLike } from './classifier-source.mjs'
export function publishClassifier(opts: {
  root: string
  remote?: string
  branch?: string
  dryRun?: boolean
  trailer?: string
  slug?: { owner: string; repo: string }
  fetchImpl?: FetchLike
  log?: (line: string) => void
  retries?: number
  retryMs?: number
}): Promise<{
  status: 'published' | 'already' | 'dry-run'
  url?: string
  commit?: string
  name: string
}>
