// API-00: mở SQLite bằng node:sqlite và chạy migration SQL theo tên file. ':memory:' cho test.
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export function openDb(path: string, migrationsDir: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)')
  const applied = new Set(
    (db.prepare('SELECT name FROM schema_migrations').all() as { name: string }[]).map((r) => r.name),
  )
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  const insert = db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)')
  for (const file of files) {
    if (applied.has(file)) continue
    const sql = readFileSync(join(migrationsDir, file), 'utf8')
    db.exec('BEGIN')
    try {
      db.exec(sql)
      insert.run(file, new Date().toISOString())
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw new Error(`migration ${file} lỗi: ${String(err)}`, { cause: err })
    }
  }
  return db
}
