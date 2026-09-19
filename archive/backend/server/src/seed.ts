// API-00: tạo admin đầu tiên khi bảng users chưa có admin.
import { hashPassword, randomPassword } from './auth.js'
import type { Config } from './config.js'
import type { Repo } from './repo.js'

export function seedAdmin(repo: Repo, config: Config, log: (msg: string) => void = console.log): void {
  if (repo.countAdmins() > 0) return
  const password = config.adminPassword ?? randomPassword()
  repo.createAdmin(config.adminUsername, hashPassword(password))
  if (config.adminPassword) {
    log(`Đã tạo admin "${config.adminUsername}" từ ADMIN_PASSWORD.`)
  } else {
    log(`Đã tạo admin "${config.adminUsername}" với mật khẩu ngẫu nhiên (chỉ in một lần): ${password}`)
  }
}
