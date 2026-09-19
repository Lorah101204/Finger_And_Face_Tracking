// API-00: ngữ cảnh dùng chung cho routes.
import type { DatabaseSync } from 'node:sqlite'
import type { Config } from './config.js'
import type { Repo } from './repo.js'

export type AppContext = { config: Config; repo: Repo; db: DatabaseSync }
