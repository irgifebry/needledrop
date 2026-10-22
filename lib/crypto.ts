import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12

function keyFromSecret(): Buffer {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters')
  }
  return Buffer.from(secret.slice(0, 64).padEnd(32, '0').slice(0, 32), 'utf8')
}

/** AES-256-GCM. The cookie holds only ciphertext. */
export function seal(payload: unknown): string {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, keyFromSecret(), iv)
  const body = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, body]).toString('base64url')
}

export function open<T>(sealed: string): T | null {
  try {
    const raw = Buffer.from(sealed, 'base64url')
    const iv = raw.subarray(0, IV_LENGTH)
    const tag = raw.subarray(IV_LENGTH, IV_LENGTH + 16)
    const body = raw.subarray(IV_LENGTH + 16)
    const decipher = createDecipheriv(ALGORITHM, keyFromSecret(), iv)
    decipher.setAuthTag(tag)
    const plain = Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
    return JSON.parse(plain) as T
  } catch {
    return null
  }
}

export function randomState(): string {
  return randomBytes(16).toString('hex')
}
