// API-00: băm mật khẩu scrypt, token phiên admin, che IP. Chỉ dùng node:crypto.
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const KEY_LEN = 64

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const key = scryptSync(password, salt, KEY_LEN)
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  const parts = (stored ?? '').split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    // Vẫn tính scrypt để thời gian phản hồi không lộ việc tài khoản có tồn tại hay không.
    scryptSync(password, randomBytes(16), KEY_LEN)
    return false
  }
  const salt = Buffer.from(parts[1], 'hex')
  const expected = Buffer.from(parts[2], 'hex')
  const actual = scryptSync(password, salt, expected.length)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function newToken(): string {
  return randomBytes(32).toString('hex')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function randomPassword(): string {
  return randomBytes(12).toString('base64url')
}

/** Che phần cuối địa chỉ IP trước khi lưu (LOG_IP_MASK=1). */
export function maskIp(ip: string): string {
  if (ip.includes(':')) {
    const groups = ip.split(':')
    return groups.slice(0, 3).join(':') + '::'
  }
  const octets = ip.split('.')
  if (octets.length === 4) return `${octets[0]}.${octets[1]}.${octets[2]}.0`
  return ip
}
