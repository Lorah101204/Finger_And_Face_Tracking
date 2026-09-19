export function registerHealthRoutes(app, ctx) {
    app.get('/api/health', async () => ({
        ok: true,
        version: process.env.npm_package_version ?? 'dev',
        db: ctx.config.databasePath === ':memory:' ? 'sqlite-memory' : 'sqlite',
        time: new Date().toISOString(),
    }));
}
//# sourceMappingURL=health.js.map