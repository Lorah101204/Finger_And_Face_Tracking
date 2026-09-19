// API-00: tạo admin đầu tiên khi bảng users chưa có admin.
import { hashPassword, randomPassword } from './auth.js';
export function seedAdmin(repo, config, log = console.log) {
    if (repo.countAdmins() > 0)
        return;
    const password = config.adminPassword ?? randomPassword();
    repo.createAdmin(config.adminUsername, hashPassword(password));
    if (config.adminPassword) {
        log(`Đã tạo admin "${config.adminUsername}" từ ADMIN_PASSWORD.`);
    }
    else {
        log(`Đã tạo admin "${config.adminUsername}" với mật khẩu ngẫu nhiên (chỉ in một lần): ${password}`);
    }
}
//# sourceMappingURL=seed.js.map