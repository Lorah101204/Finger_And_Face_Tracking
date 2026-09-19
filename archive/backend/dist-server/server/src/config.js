// API-00: cấu hình backend từ biến môi trường (docs/WORK-BREAKDOWN.md phụ lục 9.3).
import { randomBytes } from 'node:crypto';
import { CONSENT_VERSION } from '../../shared/events.js';
/** Tham số dòng lệnh --port= và --host= ưu tiên hơn biến môi trường (launcher dev có thể đặt PORT cho cả Vite lẫn API). */
function argValue(argv, name) {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : undefined;
}
export function loadConfig(env = process.env, argv = process.argv) {
    const isProd = env.NODE_ENV === 'production';
    const isTest = env.NODE_ENV === 'test';
    const secret = env.SESSION_SECRET ?? '';
    return {
        isProd,
        isTest,
        port: Number(argValue(argv, 'port') ?? env.PORT ?? 3000),
        host: argValue(argv, 'host') ?? env.HOST ?? '127.0.0.1',
        databasePath: env.DATABASE_PATH ?? 'data/app.db',
        migrationsDir: env.MIGRATIONS_DIR ?? 'server/migrations',
        sessionSecret: secret || randomBytes(32).toString('hex'),
        sessionSecretGenerated: !secret,
        adminUsername: env.ADMIN_USERNAME ?? 'admin',
        adminPassword: env.ADMIN_PASSWORD || null,
        logRetentionDays: Number(env.LOG_RETENTION_DAYS ?? 90),
        logIpMask: env.LOG_IP_MASK === '1',
        trustProxy: env.TRUST_PROXY === '1',
        staticDir: env.STATIC_DIR ?? (isProd ? 'dist' : null),
        consentVersion: env.CONSENT_VERSION ?? CONSENT_VERSION,
        visitorSessionTtlHours: 24,
        adminSessionTtlHours: 12,
        rateLimit: env.RATE_LIMIT !== undefined ? env.RATE_LIMIT === '1' : !isTest,
    };
}
//# sourceMappingURL=config.js.map