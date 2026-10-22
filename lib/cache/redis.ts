import { env, hasRedis } from '@/lib/env'
import { logger } from '@/lib/observability/logger'

/**
 * Upstash Redis adapter over the plain REST API (PLAN §13.7).
 *
 * `@upstash/redis` is not a dependency of this repo, so the handful of
 * commands we need are issued directly against the REST endpoint with
 * `fetch`. Every function here **fails soft**: a cache outage must never turn
 * into a failed request, so errors are logged and the neutral value
 * (`null` / `0`) is returned instead of throwing.
 *
 * The token is only ever sent in the `Authorization` header and is never
 * logged.
 */

const REQUEST_TIMEOUT_MS = 2_000

type RedisEnvelope<T> = { result?: T; error?: string }

type RedisPipelineEntry = { result?: unknown; error?: string }

/** Connection details, or `null` when Redis is not configured. */
function config(): { url: string; token: string } | null {
  if (!hasRedis()) return null
  const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } = env()
  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) return null
  return {
    url: UPSTASH_REDIS_REST_URL.replace(/\/+$/, ''),
    token: UPSTASH_REDIS_REST_TOKEN,
  }
}

/**
 * Runs one Redis command. Returns `null` on any failure — the caller decides
 * what a neutral value means for its operation.
 */
async function command<T>(name: string, args: unknown[]): Promise<T | null> {
  const cfg = config()
  if (!cfg) return null

  try {
    const response = await fetch(`${cfg.url}/${name}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    if (!response.ok) {
      logger.warn('cache: redis returned an error status', {
        command: name,
        status: response.status,
      })
      return null
    }

    const payload = (await response.json()) as RedisEnvelope<T>
    if (payload.error) {
      logger.warn('cache: redis command failed', { command: name, error: payload.error })
      return null
    }
    return payload.result === undefined ? null : payload.result
  } catch (error) {
    logger.warn('cache: redis request failed', { command: name, error })
    return null
  }
}

/** Runs several Redis commands in one round trip (used for atomic INCR + TTL). */
async function pipeline(commands: unknown[][]): Promise<RedisPipelineEntry[] | null> {
  const cfg = config()
  if (!cfg) return null

  try {
    const response = await fetch(`${cfg.url}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commands),
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    if (!response.ok) {
      logger.warn('cache: redis pipeline returned an error status', {
        status: response.status,
      })
      return null
    }

    const payload = (await response.json()) as RedisPipelineEntry[]
    if (!Array.isArray(payload)) return null
    return payload
  } catch (error) {
    logger.warn('cache: redis pipeline failed', { error })
    return null
  }
}

/** Parses a stored JSON payload, falling back to the raw string. */
function parse<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return raw as T
  }
}

/** Reads one key. Returns `null` on a miss or on any Redis failure. */
export async function redisGet<T>(key: string): Promise<T | null> {
  const raw = await command<string>('get', [key])
  if (raw === null || raw === undefined) return null
  return parse<T>(raw)
}

/** Writes one key with a TTL in seconds. Failures are logged, not thrown. */
export async function redisSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  let payload: string
  try {
    payload = JSON.stringify(value)
  } catch (error) {
    logger.warn('cache: value is not serialisable, skipping cache write', { error })
    return
  }
  const ttl = Math.max(1, Math.floor(ttlSeconds))
  await command<string>('set', [key, payload, 'EX', ttl])
}

/** Deletes one key. Failures are logged, not thrown. */
export async function redisDel(key: string): Promise<void> {
  await command<number>('del', [key])
}

/**
 * Reads many keys in one round trip.
 *
 * The returned array always has the same length and order as `keys`, with
 * `null` for misses — a failed request must not shift the results.
 */
export async function redisMGet<T>(keys: string[]): Promise<Array<T | null>> {
  if (keys.length === 0) return []
  const raw = await command<Array<string | null>>('mget', keys)
  if (!Array.isArray(raw)) return keys.map(() => null)
  return keys.map((_, index) => {
    const item = raw[index]
    if (item === null || item === undefined) return null
    return parse<T>(item)
  })
}

/**
 * Increments a counter and gives it a TTL.
 *
 * `SET key 0 EX ttl NX` only creates the counter when it does not exist yet,
 * so the window is set once and later increments do not extend it.
 */
export async function redisIncr(key: string, ttlSeconds: number): Promise<number> {
  const ttl = Math.max(1, Math.floor(ttlSeconds))
  const results = await pipeline([
    ['SET', key, '0', 'EX', ttl, 'NX'],
    ['INCR', key],
  ])
  const value = Number(results?.[1]?.result ?? 0)
  return Number.isFinite(value) ? value : 0
}
