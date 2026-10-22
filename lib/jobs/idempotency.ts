import { createHash } from 'node:crypto'

import type { CreateJobInput } from './types'

/**
 * Idempotency keys (PLAN §13.6).
 *
 * A double-click on "Create playlist" must not create two playlists, and a
 * mobile client that retries a request must land on the same job instead of
 * starting a second run. The key is therefore derived from the request
 * itself, so the server recognises a repeat even when the client forgets to
 * send one.
 */

const TTL_MS = 24 * 60 * 60 * 1000
const MAX_ENTRIES = 2_000
const GLOBAL_KEY = '__needledrop_idempotency__'

type Entry = {
  jobId: string
  expiresAt: number
}

type GlobalWithKeys = typeof globalThis & {
  [GLOBAL_KEY]?: Map<string, Entry>
}

/**
 * The map lives on `globalThis` so it survives a hot reload in development —
 * otherwise every save would silently drop the "already seen" history and a
 * double-click would create a second playlist.
 */
function keys(): Map<string, Entry> {
  const scope = globalThis as GlobalWithKeys
  if (!scope[GLOBAL_KEY]) scope[GLOBAL_KEY] = new Map()
  return scope[GLOBAL_KEY]
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32)
}

/**
 * The key for a request, derived from its content plus the owning session.
 *
 * The same track list submitted twice from the same browser produces the same
 * key; a different session never collides with it.
 */
export function idempotencyKeyOf(input: CreateJobInput, sessionId: string): string {
  const canonical = JSON.stringify({
    v: 1,
    sessionId,
    title: input.title,
    description: input.description ?? '',
    privacy: input.privacy,
    videoIds: input.videoIds,
  })
  return `ik_${digest(canonical)}`
}

/**
 * Scopes a client-supplied key to the session that sent it.
 *
 * A raw client key cannot be used on its own: without the session prefix one
 * browser could name another browser's key and read that user's job.
 */
export function scopedIdempotencyKey(sessionId: string, clientKey: string): string {
  return `ik_${digest(`${sessionId}:${clientKey}`)}`
}

/**
 * Remembers that `key` produced `jobId`, so a repeated POST can be answered
 * with the existing job instead of a second playlist.
 */
export function remember(key: string, jobId: string): void {
  const map = keys()
  map.set(key, { jobId, expiresAt: Date.now() + TTL_MS })
  prune(map)
}

/** The job id a key already produced, or `null` when the key is new/expired. */
export function lookup(key: string): string | null {
  const map = keys()
  const entry = map.get(key)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    map.delete(key)
    return null
  }
  return entry.jobId
}

/** Drops the oldest entries once the map grows past its cap. */
function prune(map: Map<string, Entry>): void {
  while (map.size > MAX_ENTRIES) {
    const oldest = map.keys().next()
    if (oldest.done) return
    map.delete(oldest.value)
  }
}
