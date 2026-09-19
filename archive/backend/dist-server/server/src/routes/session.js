import { z } from 'zod';
import { CAMERA_EVENT_TYPES, DISPLAY_NAME_MAX, EVENTS_BATCH_MAX, EVENT_PAYLOAD_MAX_BYTES, EVENT_TYPES, } from '../../../shared/events.js';
import { maskIp } from '../auth.js';
export const SID_COOKIE = 'sid';
const consentSchema = z.object({
    displayName: z.string().trim().max(DISPLAY_NAME_MAX).optional(),
    consentVersion: z.string().min(1),
});
const payloadValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const eventSchema = z.object({
    ts: z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'ts phải là ISO 8601'),
    type: z.enum(EVENT_TYPES),
    payload: z.record(z.string(), payloadValue).optional(),
});
const eventsSchema = z.object({ events: z.array(eventSchema).min(1).max(EVENTS_BATCH_MAX) });
function toPublic(s) {
    return {
        sessionId: s.id,
        createdAt: s.created_at,
        consentAt: s.consent_at,
        consentVersion: s.consent_version,
        displayName: s.display_name,
    };
}
export function registerSessionRoutes(app, ctx) {
    const { config, repo } = ctx;
    const ttlMs = config.visitorSessionTtlHours * 3_600_000;
    function setSidCookie(reply, id) {
        reply.setCookie(SID_COOKIE, id, {
            httpOnly: true,
            sameSite: 'lax',
            secure: config.isProd,
            signed: true,
            path: '/',
            maxAge: config.visitorSessionTtlHours * 3600,
        });
    }
    /** Phiên hợp lệ từ cookie: chưa kết thúc và còn hoạt động trong TTL. */
    function currentSession(req) {
        const raw = req.cookies[SID_COOKIE];
        if (!raw)
            return null;
        const unsigned = req.unsignCookie(raw);
        if (!unsigned.valid || !unsigned.value)
            return null;
        const s = repo.getSession(unsigned.value);
        if (!s || s.ended_at)
            return null;
        if (Date.now() - Date.parse(s.last_seen_at) > ttlMs)
            return null;
        return s;
    }
    app.post('/api/session/start', async (req, reply) => {
        let s = currentSession(req);
        if (s) {
            repo.touchSession(s.id);
        }
        else {
            const ip = config.logIpMask ? maskIp(req.ip) : req.ip;
            s = repo.createVisitorSession(ip, (req.headers['user-agent'] ?? '').slice(0, 300) || null);
            repo.addEvents(s.id, [{ ts: new Date().toISOString(), type: 'visit', payload: { path: '/' } }]);
        }
        setSidCookie(reply, s.id);
        return toPublic(repo.getSession(s.id));
    });
    app.get('/api/session/me', async (req, reply) => {
        const s = currentSession(req);
        if (!s)
            return reply.code(401).send({ error: 'no_session' });
        return toPublic(s);
    });
    app.post('/api/session/consent', async (req, reply) => {
        const s = currentSession(req);
        if (!s)
            return reply.code(401).send({ error: 'no_session' });
        const parsed = consentSchema.safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'invalid', issues: parsed.error.issues });
        if (parsed.data.consentVersion !== config.consentVersion) {
            return reply.code(409).send({ error: 'consent_version', expected: config.consentVersion });
        }
        const displayName = parsed.data.displayName ? parsed.data.displayName : null;
        const updated = repo.setConsent(s.id, displayName, parsed.data.consentVersion);
        repo.addEvents(s.id, [
            { ts: new Date().toISOString(), type: 'consent', payload: { version: parsed.data.consentVersion } },
        ]);
        return toPublic(updated);
    });
    app.post('/api/session/events', async (req, reply) => {
        const s = currentSession(req);
        if (!s)
            return reply.code(401).send({ error: 'no_session' });
        const parsed = eventsSchema.safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'invalid', issues: parsed.error.issues });
        for (const e of parsed.data.events) {
            if (e.payload && Buffer.byteLength(JSON.stringify(e.payload)) > EVENT_PAYLOAD_MAX_BYTES) {
                return reply.code(413).send({ error: 'payload_too_large', max: EVENT_PAYLOAD_MAX_BYTES });
            }
            if (!s.consent_at && CAMERA_EVENT_TYPES.includes(e.type)) {
                return reply.code(403).send({ error: 'consent_required', type: e.type });
            }
        }
        repo.touchSession(s.id);
        const accepted = repo.addEvents(s.id, parsed.data.events);
        return { accepted };
    });
    app.post('/api/session/end', async (req, reply) => {
        const s = currentSession(req);
        if (s)
            repo.endSession(s.id);
        return reply.code(204).send();
    });
}
//# sourceMappingURL=session.js.map