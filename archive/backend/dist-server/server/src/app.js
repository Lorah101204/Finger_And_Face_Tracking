// API-00: dựng Fastify instance (dùng chung cho index.ts và test bằng inject).
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, {} from 'fastify';
import { registerAdminRoutes } from './routes/admin.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerSessionRoutes } from './routes/session.js';
const SAME_SITE_VALUES = new Set(['same-origin', 'same-site', 'none']);
export async function buildApp(ctx) {
    const { config } = ctx;
    const app = Fastify({
        logger: !config.isTest,
        trustProxy: config.trustProxy,
        bodyLimit: 64 * 1024,
    });
    await app.register(cookie, { secret: config.sessionSecret });
    if (config.rateLimit)
        await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
    // sendBeacon gửi text/plain; nội dung vẫn là JSON.
    app.addContentTypeParser('text/plain', { parseAs: 'string' }, (_req, body, done) => {
        try {
            done(null, body ? JSON.parse(body) : {});
        }
        catch (err) {
            done(err);
        }
    });
    // Chống CSRF: mọi yêu cầu đổi trạng thái phải cùng nguồn (D-018).
    app.addHook('onRequest', async (req, reply) => {
        if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS')
            return;
        const site = req.headers['sec-fetch-site'];
        if (typeof site === 'string' && !SAME_SITE_VALUES.has(site)) {
            return reply.code(403).send({ error: 'cross_site' });
        }
        const origin = req.headers.origin;
        if (typeof origin === 'string' && origin !== 'null') {
            let host;
            try {
                host = new URL(origin).host;
            }
            catch {
                host = null;
            }
            if (!host || host !== req.headers.host)
                return reply.code(403).send({ error: 'bad_origin' });
        }
    });
    app.addHook('onSend', async (_req, reply) => {
        reply.header('X-Content-Type-Options', 'nosniff');
        reply.header('Referrer-Policy', 'same-origin');
    });
    registerHealthRoutes(app, ctx);
    registerSessionRoutes(app, ctx);
    registerAdminRoutes(app, ctx);
    const staticDir = config.staticDir ? resolve(config.staticDir) : null;
    if (staticDir && existsSync(staticDir)) {
        await app.register(fastifyStatic, { root: staticDir, wildcard: false });
        app.setNotFoundHandler((req, reply) => {
            if (req.method === 'GET' && !req.url.startsWith('/api/'))
                return reply.sendFile('index.html');
            return reply.code(404).send({ error: 'not_found' });
        });
    }
    return app;
}
//# sourceMappingURL=app.js.map