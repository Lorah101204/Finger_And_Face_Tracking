// API-00: điểm vào backend. Chạy dev: npm run dev:server. Chạy prod: npm run build && npm start.
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { Repo } from './repo.js';
import { seedAdmin } from './seed.js';
const config = loadConfig();
const db = openDb(config.databasePath, config.migrationsDir);
const repo = new Repo(db);
seedAdmin(repo, config);
if (config.sessionSecretGenerated) {
    console.warn('SESSION_SECRET chưa đặt: dùng giá trị ngẫu nhiên, cookie mất hiệu lực khi khởi động lại.');
}
const app = await buildApp({ config, repo, db });
function runRetention() {
    const r = repo.deleteOlderThan(config.logRetentionDays);
    repo.deleteExpiredAdminSessions();
    if (r.sessions > 0)
        app.log.info(`retention: xóa ${r.sessions} phiên, ${r.events} sự kiện`);
}
runRetention();
setInterval(runRetention, 6 * 3_600_000).unref();
await app.listen({ port: config.port, host: config.host });
//# sourceMappingURL=index.js.map