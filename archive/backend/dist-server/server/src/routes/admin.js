import { z } from 'zod';
import { hashToken, newToken, verifyPassword } from '../auth.js';
export const ADM_COOKIE = 'adm';
const loginSchema = z.object({ username: z.string().min(1).max(60), password: z.string().min(1).max(200) });
const dateString = z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), 'ngày phải là ISO 8601')
    .optional();
const listSchema = z.object({
    from: dateString,
    to: dateString,
    q: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
const statsSchema = z.object({ days: z.coerce.number().int().min(1).max(90).default(7) });
export function registerAdminRoutes(app, ctx) {
    const { config, repo } = ctx;
    function adminFromRequest(req) {
        const raw = req.cookies[ADM_COOKIE];
        if (!raw)
            return null;
        const unsigned = req.unsignCookie(raw);
        if (!unsigned.valid || !unsigned.value)
            return null;
        const row = repo.getAdminSession(hashToken(unsigned.value));
        if (!row || Date.parse(row.expires_at) < Date.now())
            return null;
        return row;
    }
    async function requireAdmin(req, reply) {
        const admin = adminFromRequest(req);
        if (!admin)
            return reply.code(401).send({ error: 'unauthorized' });
    }
    app.post('/api/admin/login', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
        const parsed = loginSchema.safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'invalid', issues: parsed.error.issues });
        const user = repo.findAdmin(parsed.data.username);
        const ok = verifyPassword(parsed.data.password, user?.password_hash);
        if (!ok || !user)
            return reply.code(401).send({ error: 'bad_credentials' });
        const token = newToken();
        const expiresAt = new Date(Date.now() + config.adminSessionTtlHours * 3_600_000).toISOString();
        repo.createAdminSession(user.id, hashToken(token), expiresAt);
        repo.deleteExpiredAdminSessions();
        reply.setCookie(ADM_COOKIE, token, {
            httpOnly: true,
            sameSite: 'lax',
            secure: config.isProd,
            signed: true,
            path: '/',
            maxAge: config.adminSessionTtlHours * 3600,
        });
        return { username: user.username, expiresAt };
    });
    app.post('/api/admin/logout', async (req, reply) => {
        const raw = req.cookies[ADM_COOKIE];
        if (raw) {
            const unsigned = req.unsignCookie(raw);
            if (unsigned.valid && unsigned.value)
                repo.deleteAdminSession(hashToken(unsigned.value));
        }
        reply.clearCookie(ADM_COOKIE, { path: '/' });
        return reply.code(204).send();
    });
    app.get('/api/admin/me', { preHandler: requireAdmin }, async (req) => {
        const admin = adminFromRequest(req);
        return { username: admin?.username ?? null, expiresAt: admin?.expires_at ?? null };
    });
    app.get('/api/admin/sessions', { preHandler: requireAdmin }, async (req, reply) => {
        const parsed = listSchema.safeParse(req.query);
        if (!parsed.success)
            return reply.code(400).send({ error: 'invalid', issues: parsed.error.issues });
        return repo.listSessions(parsed.data);
    });
    app.get('/api/admin/sessions/:id/events', { preHandler: requireAdmin }, async (req, reply) => {
        const session = repo.getSession(req.params.id);
        if (!session)
            return reply.code(404).send({ error: 'not_found' });
        return { session, events: repo.listEvents(session.id) };
    });
    app.get('/api/admin/stats', { preHandler: requireAdmin }, async (req, reply) => {
        const parsed = statsSchema.safeParse(req.query);
        if (!parsed.success)
            return reply.code(400).send({ error: 'invalid', issues: parsed.error.issues });
        return { days: parsed.data.days, rows: repo.stats(parsed.data.days) };
    });
    app.get('/api/admin/export.csv', { preHandler: requireAdmin }, async (req, reply) => {
        const parsed = listSchema.safeParse(req.query);
        if (!parsed.success)
            return reply.code(400).send({ error: 'invalid', issues: parsed.error.issues });
        const csv = repo.exportCsv(parsed.data.from, parsed.data.to);
        return reply
            .type('text/csv; charset=utf-8')
            .header('Content-Disposition', 'attachment; filename="sessions.csv"')
            .send('﻿' + csv);
    });
}
//# sourceMappingURL=admin.js.map