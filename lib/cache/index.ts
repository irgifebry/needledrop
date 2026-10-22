import { cacheEnabled } from '@/features/flags'
import { hasRedis } from '@/lib/env'
import { logger } from '@/lib/observability/logger'
import { increment } from '@/lib/observability/metrics'
import { recordSpend } from '@/lib/quota-ledger'
import {
  youtubeFetch,
  type FetchInit,
  type Operation,
  type QuotaMeter,
} from '@/lib/youtube/client'

import {
  CACHE_TTL,
  canonicalParams,
  channelKey,
  hashKey,
  namespacedKey,
  playlistItemsKey,
  searchKey,
  videosKey,
  type KeyParams,
} from './keys'
import { redisDel, redisGet, redisMGet, redisSet } from './redis'

/**
 * The cache facade (PLAN §13.7).
 *
 * Two tiers, one API:
 *
 * 1. an in-process LRU with TTLs — always available, no configuration, no
 *    network, and the reason the app can run with **zero** external services;
 * 2. Upstash Redis — optional, shared between serverless instances.
 *
 * On top of that it provides the two behaviours that keep the shared quota
 * alive: request coalescing (a stampede of 20 identical requests causes one
 * upstream call) and stale-while-revalidate (a stale answer is returned
 * immediately while the refresh happens in the background).
 */

/** Upper bound on the in-process store, so a long-lived server cannot grow. */
const MAX_ENTRIES = 500

/**
 * How long an expired entry may still be served as a stale answer.
 *
 * The entry itself is kept a little longer than its TTL so a request that
 * arrives right after expiry still gets an instant (slightly old) answer
 * instead of blocking on the upstream API.
 */
const STALE_GRACE_MS = 5 * 60_000

/** Default TTL for `setCached` when the caller does not pick one. */
const DEFAULT_TTL_SECONDS = CACHE_TTL.default

type CacheRecord = {
  value: unknown
  /** Epoch ms until which the entry is fresh. */
  freshUntil: number
  /** Epoch ms until which the entry may still be served as stale. */
  staleUntil: number
}

/** What is stored in Redis: the value plus the moment it goes stale. */
type CacheEnvelope<T> = { v: T; e: number }

const store = new Map<string, CacheRecord>()

/** In-flight loads, keyed by cache key — this is the stampede guard. */
const inflight = new Map<string, Promise<unknown>>()

const counters = {
  hits: 0,
  stale: 0,
  misses: 0,
  loads: 0,
  evictions: 0,
  expired: 0,
}

/** Counts a cache hit in both the local counters and the app-wide metrics. */
function countHit(): void {
  counters.hits += 1
  increment('cacheHit')
}

/**
 * Counts a stale hit: the answer came from the cache, but it was past its TTL
 * and a refresh is running in the background.
 */
function countStale(): void {
  counters.stale += 1
  increment('cacheHit')
}

/** Counts a cache miss in both the local counters and the app-wide metrics. */
function countMiss(): void {
  counters.misses += 1
  increment('cacheMiss')
}

/* ------------------------------------------------------------------ *
 * In-process store
 * ------------------------------------------------------------------ */

/** Removes entries whose grace window has passed. */
function sweep(now: number): void {
  for (const [key, record] of store) {
    if (record.staleUntil <= now) {
      store.delete(key)
      counters.expired += 1
    }
  }
}

/** Reads from the local store. `stale` marks an entry that is past its TTL. */
function localGet<T>(key: string): { value: T; stale: boolean } | null {
  const record = store.get(key)
  if (!record) return null

  const now = Date.now()
  if (record.staleUntil <= now) {
    store.delete(key)
    counters.expired += 1
    return null
  }

  // Touch: re-inserting moves the key to the end of the Map, which is what
  // makes the eviction below least-recently-used.
  store.delete(key)
  store.set(key, record)

  return { value: record.value as T, stale: now >= record.freshUntil }
}

/** Writes to the local store, evicting the oldest entries when full. */
function localSet(key: string, value: unknown, ttlSeconds: number): void {
  const now = Date.now()
  const ttlMs = Math.max(0, ttlSeconds) * 1000

  store.delete(key)
  store.set(key, {
    value,
    freshUntil: now + ttlMs,
    staleUntil: now + ttlMs + STALE_GRACE_MS,
  })

  sweep(now)

  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next()
    if (oldest.done) break
    store.delete(oldest.value)
    counters.evictions += 1
  }
}

/** Stores a value whose freshness moment is known (used when reading Redis). */
function localSetWithFreshness(key: string, value: unknown, freshUntil: number): void {
  const now = Date.now()
  store.delete(key)
  store.set(key, {
    value,
    freshUntil,
    staleUntil: freshUntil + STALE_GRACE_MS,
  })
  sweep(now)
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next()
    if (oldest.done) break
    store.delete(oldest.value)
    counters.evictions += 1
  }
}

/* ------------------------------------------------------------------ *
 * Reads and writes
 * ------------------------------------------------------------------ */

/** True when a Redis payload is one of our freshness envelopes. */
function isEnvelope(value: unknown): value is CacheEnvelope<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'v' in value &&
    typeof (value as { e?: unknown }).e === 'number'
  )
}

/**
 * Reads an entry from both tiers.
 *
 * A fresh local entry wins (no network round trip). Otherwise Redis is
 * consulted, and a local entry that is past its TTL is served as stale so the
 * caller can answer instantly while a refresh runs in the background.
 */
async function readEntry<T>(key: string): Promise<{ value: T; stale: boolean } | null> {
  const now = Date.now()
  const local = localGet<T>(key)
  if (local && !local.stale) return local

  if (hasRedis()) {
    const payload = await redisGet<unknown>(key)
    if (payload !== null && payload !== undefined) {
      if (isEnvelope(payload)) {
        localSetWithFreshness(key, payload.v, payload.e)
        return { value: payload.v as T, stale: now >= payload.e }
      }
      // A plain value (written by something else) is treated as fresh.
      return { value: payload as T, stale: false }
    }
  }

  if (local) return local
  return null
}

/**
 * Reads one cached value.
 *
 * Only fresh values are returned — a stale value is a fallback for
 * `withCache`, not something a caller should silently treat as current.
 */
export async function getCached<T>(key: string): Promise<T | null> {
  if (!cacheEnabled()) return null

  const entry = await readEntry<T>(key)
  if (!entry || entry.stale) {
    countMiss()
    return null
  }
  countHit()
  return entry.value
}

/**
 * Stores a value.
 *
 * `null`/`undefined` are never stored: a miss has to stay a miss, otherwise
 * a failed lookup would be cached as a valid "no results" answer.
 */
export async function setCached(key: string, value: unknown, ttlSeconds = DEFAULT_TTL_SECONDS): Promise<void> {
  if (!cacheEnabled()) return
  if (value === null || value === undefined) {
    await deleteCached(key)
    return
  }

  const ttl = Math.max(0, ttlSeconds)
  localSet(key, value, ttl)

  if (hasRedis()) {
    const envelope: CacheEnvelope<unknown> = { v: value, e: Date.now() + ttl * 1000 }
    // Redis `EX` only takes whole seconds; the grace window keeps the entry
    // around long enough to still be served as a stale answer.
    const redisTtl = Math.max(1, Math.floor(ttl)) + Math.ceil(STALE_GRACE_MS / 1000)
    await redisSet(key, envelope, redisTtl)
  }
}

/** Removes one entry from both tiers. */
export async function deleteCached(key: string): Promise<void> {
  store.delete(key)
  if (hasRedis()) await redisDel(key)
}

/**
 * Reads many keys at once.
 *
 * The result keeps the order and length of `keys`; a miss is `null`.
 */
export async function getManyCached<T>(keys: string[]): Promise<Array<T | null>> {
  const out: Array<T | null> = new Array(keys.length).fill(null)
  if (keys.length === 0) return out
  if (!cacheEnabled()) return out

  const missing: number[] = []
  for (let index = 0; index < keys.length; index += 1) {
    const local = localGet<T>(keys[index])
    if (local && !local.stale) {
      out[index] = local.value
      countHit()
    } else {
      missing.push(index)
    }
  }

  if (missing.length > 0 && hasRedis()) {
    const remote = await redisMGet<unknown>(missing.map((index) => keys[index]))
    for (let position = 0; position < missing.length; position += 1) {
      const payload = remote[position]
      if (payload === null || payload === undefined) continue
      const index = missing[position]
      if (isEnvelope(payload)) {
        if (payload.e > Date.now()) {
          out[index] = payload.v as T
          countHit()
        }
        localSetWithFreshness(keys[index], payload.v, payload.e)
      } else {
        out[index] = payload as T
        countHit()
      }
    }
  }

  for (const index of missing) {
    if (out[index] === null) countMiss()
  }

  return out
}

/* ------------------------------------------------------------------ *
 * Stampede control and stale-while-revalidate
 * ------------------------------------------------------------------ */

/**
 * Runs a load, but only once per key at a time.
 *
 * Every concurrent caller of the same key awaits the same promise, so a
 * burst of identical requests produces a single upstream call.
 */
function sharedLoad<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key)
  if (existing) return existing as Promise<T>

  let settle!: { resolve: (value: T) => void; reject: (reason: unknown) => void }
  const promise = new Promise<T>((resolve, reject) => {
    settle = { resolve, reject }
  })
  inflight.set(key, promise)

  void (async () => {
    try {
      counters.loads += 1
      const value = await loader()
      await setCached(key, value, ttlSeconds)
      settle.resolve(value)
    } catch (error) {
      settle.reject(error)
    } finally {
      if (inflight.get(key) === promise) inflight.delete(key)
    }
  })()

  return promise
}

/** Refreshes an expired entry in the background; failures are swallowed. */
function refreshInBackground<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): void {
  if (inflight.has(key)) return
  void sharedLoad(key, ttlSeconds, loader).catch((error: unknown) => {
    logger.warn('cache: background refresh failed', { key: key.split(':')[0], error })
  })
}

/**
 * The workhorse: read-through cache with coalescing and stale-while-revalidate.
 *
 * - fresh entry → returned as-is (`hit: true`);
 * - no entry → `loader()` runs, the result is stored (`hit: false`);
 * - expired entry → the stale value is returned immediately (`stale: true`)
 *   while the entry is refreshed in the background.
 *
 * Concurrent misses for the same key share one `loader()` call.
 */
export async function withCache<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>,
): Promise<{ value: T; hit: boolean; stale: boolean }> {
  if (!cacheEnabled()) {
    const value = await loader()
    return { value, hit: false, stale: false }
  }

  const entry = await readEntry<T>(key)
  if (entry && !entry.stale) {
    countHit()
    return { value: entry.value, hit: true, stale: false }
  }

  if (entry) {
    countStale()
    refreshInBackground(key, ttlSeconds, loader)
    return { value: entry.value, hit: true, stale: true }
  }

  countMiss()
  const value = await sharedLoad(key, ttlSeconds, loader)
  return { value, hit: false, stale: false }
}

/* ------------------------------------------------------------------ *
 * YouTube helper
 * ------------------------------------------------------------------ */

/** Operations whose responses are stable enough to cache. */
const CACHEABLE_OPERATIONS: ReadonlySet<Operation> = new Set<Operation>([
  'search.list',
  'videos.list',
  'playlistItems.list',
  'channels.list',
  'playlists.list',
])

export type CachedFetchInit = FetchInit & {
  /** Session id, so the ledger can attribute spend per browser session. */
  sessionId?: string
  /** Run id, so the ledger can attribute spend per generation run. */
  runId?: string
}

export type CachedFetchResult<T> = {
  value: T
  /** `true` when the answer came from the cache (fresh or stale). */
  hit: boolean
  /** `true` when the cached answer was past its TTL. */
  stale: boolean
  /** Units charged to the meter by this call. `0` on a cache hit. */
  units: number
}

/** TTL for a cached operation. */
function ttlForOperation(operation: Operation): number {
  switch (operation) {
    case 'search.list':
      return CACHE_TTL.search
    case 'videos.list':
      return CACHE_TTL.videos
    case 'playlistItems.list':
      return CACHE_TTL.playlistItems
    case 'channels.list':
      return CACHE_TTL.channel
    case 'playlists.list':
      return CACHE_TTL.playlists
    default:
      return CACHE_TTL.default
  }
}

/** Appends a hash of the remaining parameters to a key. */
function withParams(base: string, extra: KeyParams): string {
  const suffix = canonicalParams(extra)
  return suffix ? `${base}#${hashKey(suffix)}` : base
}

/**
 * A per-token scope for operations that can expose user-private data.
 *
 * `playlistItems.list` on a private playlist must never be served to a
 * different user from a shared cache, so the key is bound to a hash of the
 * access token. The token itself is never stored or logged — only its
 * digest, which is stable across processes.
 */
function scopeFor(operation: Operation, init: CachedFetchInit): string | undefined {
  if (!init.accessToken) return undefined
  if (operation !== 'playlistItems.list') return undefined
  return `${hashKey(init.accessToken)}${hashKey(`${init.accessToken}:scope`)}`
}

/** Adds the token scope to a key, when the operation needs one. */
function withScope(key: string, operation: Operation, init: CachedFetchInit): string {
  const scope = scopeFor(operation, init)
  return scope ? `${key}:u${scope}` : key
}

/**
 * Decides whether a call may be cached.
 *
 * Mutations are never cached, and neither is anything that returns the
 * caller's private data (`playlists.list?mine=true`).
 */
function isCacheable(operation: Operation, params: KeyParams, init: CachedFetchInit): boolean {
  if (!CACHEABLE_OPERATIONS.has(operation)) return false
  const mine = params.mine
  if (mine === true || mine === 'true') return false
  if (operation === 'playlists.list' && init.accessToken) return false
  return true
}

/** Builds the cache key for a Data API call. */
function cacheKeyFor(operation: Operation, params: KeyParams, init: CachedFetchInit): string {
  const rest: KeyParams = { ...params }

  switch (operation) {
    case 'search.list': {
      const query = String(rest.q ?? '')
      delete rest.q
      return withScope(searchKey(query, rest), operation, init)
    }
    case 'videos.list': {
      const ids = String(rest.id ?? '')
      delete rest.id
      return withScope(withParams(videosKey(ids), rest), operation, init)
    }
    case 'playlistItems.list': {
      const playlistId = String(rest.playlistId ?? '')
      delete rest.playlistId
      return withScope(withParams(playlistItemsKey(playlistId), rest), operation, init)
    }
    case 'channels.list': {
      const ids = String(rest.id ?? '').split(',')[0] ?? ''
      delete rest.id
      return withScope(withParams(channelKey(ids), rest), operation, init)
    }
    case 'playlists.list': {
      return withScope(namespacedKey('playlists', params), operation, init)
    }
    default:
      return withScope(namespacedKey(operation.replace('.', ':'), params), operation, init)
  }
}

/**
 * `youtubeFetch` with a cache in front of it.
 *
 * A cached answer costs **zero quota units** — no upstream call happens, so
 * the meter is not charged and the ledger records the call as cached. That
 * honesty is what makes the quota ledger worth trusting.
 *
 * The spend of every call is written to the ledger automatically, so callers
 * must not record the same operation a second time.
 */
export async function cachedFetchDetailed<T>(
  operation: Operation,
  params: KeyParams,
  meter: QuotaMeter,
  init: CachedFetchInit = {},
): Promise<CachedFetchResult<T>> {
  const { sessionId, runId, ...fetchInit } = init

  if (!cacheEnabled() || !isCacheable(operation, params, init)) {
    const before = meter.units
    const value = await youtubeFetch<T>(operation, params, meter, fetchInit)
    const units = meter.units - before
    recordSpend({ operation, units, sessionId, runId, cached: false })
    return { value, hit: false, stale: false, units }
  }

  const key = cacheKeyFor(operation, params, init)
  const ttl = ttlForOperation(operation)
  let units = 0

  const result = await withCache<T>(key, ttl, async () => {
    const before = meter.units
    const value = await youtubeFetch<T>(operation, params, meter, fetchInit)
    units = meter.units - before
    recordSpend({ operation, units, sessionId, runId, cached: false })
    return value
  })

  if (result.hit) {
    // The answer came from the cache: no upstream call, no quota charged.
    recordSpend({ operation, units: 0, sessionId, runId, cached: true })
    return { value: result.value, hit: true, stale: result.stale, units: 0 }
  }

  return { value: result.value, hit: false, stale: false, units }
}

/**
 * Drop-in replacement for `youtubeFetch` that serves cached answers.
 *
 * Returns exactly what the Data API returned, so it can replace the direct
 * call without changing the call site. Use `cachedFetchDetailed` when the
 * caller needs to know whether the answer came from the cache.
 */
export async function cachedFetch<T>(
  operation: Operation,
  params: KeyParams,
  meter: QuotaMeter,
  init: CachedFetchInit = {},
): Promise<T> {
  const result = await cachedFetchDetailed<T>(operation, params, meter, init)
  return result.value
}

/* ------------------------------------------------------------------ *
 * Stats
 * ------------------------------------------------------------------ */

export type CacheStats = {
  /** Requests answered with a fresh cached value. */
  hits: number
  /** Requests answered with a stale value while a refresh ran. */
  stale: number
  /** Requests that had no cached value. */
  misses: number
  /** Times the loader actually ran — upstream calls the cache could not avoid. */
  loads: number
  /** Requests answered without causing an upstream call (hit, stale or coalesced). */
  servedWithoutUpstream: number
  /** Entries dropped because the in-process store was full. */
  evictions: number
  /** Entries dropped because their TTL and grace window passed. */
  expired: number
  /** `hits + stale` over all requests. */
  hitRate: number
  /** Entries currently held in memory. */
  entries: number
  /** Which tier is serving requests. */
  backend: 'memory' | 'redis'
}

/** Snapshot of the cache counters, for `/api/quota` and the operator view. */
export function cacheStats(): CacheStats {
  const total = counters.hits + counters.stale + counters.misses
  return {
    hits: counters.hits,
    stale: counters.stale,
    misses: counters.misses,
    loads: counters.loads,
    servedWithoutUpstream: Math.max(0, total - counters.loads),
    evictions: counters.evictions,
    expired: counters.expired,
    hitRate: total === 0 ? 0 : (counters.hits + counters.stale) / total,
    entries: store.size,
    backend: hasRedis() ? 'redis' : 'memory',
  }
}

/** Test seam — empties the in-process store and the counters. */
export function resetCache(): void {
  store.clear()
  inflight.clear()
  counters.hits = 0
  counters.stale = 0
  counters.misses = 0
  counters.loads = 0
  counters.evictions = 0
  counters.expired = 0
}
