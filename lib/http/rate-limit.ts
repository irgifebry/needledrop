import { env, hasRedis } from '@/lib/env'
import { logger } from '@/lib/observability/logger'

/**
 * Rate limiting (PLAN §13.10, §13.11).
 *
 * `search.list` costs 100 quota units a call, so the public search route is
 * the one that must be protected hardest. The limiter is a fixed-window
 * counter: in-process by default, Upstash REST when configured so the limits
 * hold across serverless instances.
 */

export type RateLimitResult = {
  ok: boolean
  limit: number
  remaining: number
  resetAt: number
  scope: string
}

type Window = { count: number; resetAt: number }

const windows = new Map<string, Window>()

function sweep(now: number): void {
  if (windows.size < 500) return
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key)
  }
}

/** Fixed-window counter, in process. */
export function checkLocalRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now()
  sweep(now)

  const existing = windows.get(key)
  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true, limit, remaining: Math.max(0, limit - 1), resetAt: now + windowMs, scope: 'local' }
  }

  existing.count += 1
  return {
    ok: existing.count <= limit,
    limit,
    remaining: Math.max(0, limit - existing.count),
    resetAt: existing.resetAt,
    scope: 'local',
  }
}

type UpstashResult = { result?: number | string; error?: string }

async function checkRedisRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult | null> {
  const url = env().UPSTASH_REDIS_REST_URL
  const token = env().UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null

  const window = Math.max(1, Math.floor(windowMs / 1000))
  const bucket = Math.floor(Date.now() / windowMs)
  const redisKey = `ratelimit:${key}:${bucket}`

  try {
    const response = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        ['INCR', redisKey],
        ['EXPIRE', redisKey, window + 1],
      ]),
      cache: 'no-store',
    })
    if (!response.ok) return null

    const payload = (await response.json()) as UpstashResult[]
    const count = Number(payload?.[0]?.result ?? 0)
    if (!Number.isFinite(count)) return null

    return {
      ok: count <= limit,
      limit,
      remaining: Math.max(0, limit - count),
      resetAt: (bucket + 1) * windowMs,
      scope: 'redis',
    }
  } catch (error) {
    logger.warn('rate limit: redis check failed, falling back to local', { error })
    return null
  }
}

/**
 * Consume one unit from the budget for `key`.
 * `limit` of 0 disables the check entirely.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  if (limit <= 0) {
    return { ok: true, limit, remaining: Number.MAX_SAFE_INTEGER, resetAt: 0, scope: 'disabled' }
  }
  if (hasRedis()) {
    const distributed = await checkRedisRateLimit(key, limit, windowMs)
    if (distributed) return distributed
  }
  return checkLocalRateLimit(key, limit, windowMs)
}

/** Best-effort client identity. Honours a proxy header, never trusts it blindly. */
export function clientKey(request: Request, scope: string): string {
  const forwarded = request.headers.get('x-forwarded-for')
  const ip = forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown'
  return `${scope}:${ip}`
}
