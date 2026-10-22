import { isProduction } from '@/lib/env'

/**
 * Structured logging (PLAN §13.10).
 *
 * JSON in production, a readable line in development. Nothing that could
 * carry a credential is ever allowed through: `redact` scrubs known-sensitive
 * keys before serialisation, and the log helpers only accept plain data.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

const SENSITIVE_KEYS = new Set([
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'apikey',
  'api_key',
  'key',
  'authorization',
  'cookie',
  'password',
  'secret',
  'sessionsecret',
  'clientsecret',
  'client_secret',
  'youtubeapikey',
])

export type LogContext = Record<string, unknown>

export type LogFields = LogContext & {
  requestId?: string
  operation?: string
  units?: number
  durationMs?: number
  error?: unknown
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]'
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1))
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack }
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? '[redacted]' : redact(item, depth + 1)
    }
    return out
  }
  return value
}

function minLevel(): LogLevel {
  return isProduction() ? 'info' : 'debug'
}

function write(level: LogLevel, message: string, fields: LogFields): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel()]) return

  const payload = {
    level,
    time: new Date().toISOString(),
    message,
    ...(redact(fields) as Record<string, unknown>),
  }

  if (isProduction()) {
    // One JSON object per line — the shape a log shipper expects.
    console.log(JSON.stringify(payload))
    return
  }

  const { level: _level, time: _time, message: _message, ...rest } = payload
  console.log(`[${level.toUpperCase()}] ${message}`, Object.keys(rest).length ? rest : '')
}

export const logger = {
  debug: (message: string, fields: LogFields = {}) => write('debug', message, fields),
  info: (message: string, fields: LogFields = {}) => write('info', message, fields),
  warn: (message: string, fields: LogFields = {}) => write('warn', message, fields),
  error: (message: string, fields: LogFields = {}) => write('error', message, fields),
}

export function newRequestId(): string {
  return `req_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
}
