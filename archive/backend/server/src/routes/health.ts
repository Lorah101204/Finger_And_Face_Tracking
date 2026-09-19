// API-00: kiểm tra sống.
import type { FastifyInstance } from 'fastify'
import type { AppContext } from '../context.js'

export function registerHealthRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/health', async () => ({
    ok: true,
    version: process.env.npm_package_version ?? 'dev',
    db: ctx.config.databasePath === ':memory:' ? 'sqlite-memory' : 'sqlite',
    time: new Date().toISOString(),
  }))
}
