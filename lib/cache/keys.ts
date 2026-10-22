/**
 * Cache keys and TTLs (PLAN §13.7).
 *
 * Keys are namespaced (`search:`, `videos:`, `topic:` …) so a shared Redis
 * stays legible when someone opens it with `redis-cli`, and every TTL lives in
 * one frozen record so the whole cache can be retuned from a single place.
 *
 * `hashKey` is a dependency-free FNV-1a hash: it produces the same digest in
 * every process (edge runtime, node, worker) without pulling in `node:crypto`,
 * which would make this module unusable outside a Node server.
 */

/** Every TTL the cache uses, in seconds. One place to tune the whole cache. */
export const CACHE_TTL = Object.freeze({
  /** `search.list` — expensive (100 units), so keep it warm but not stale. */
  search: 30 * 60,
  /** `videos.list` — metadata barely changes. */
  videos: 6 * 60 * 60,
  /** Topic metadata — effectively immutable. */
  topic: 24 * 60 * 60,
  /** `playlistItems.list` — the user's own library changes often. */
  playlistItems: 15 * 60,
  /** `channels.list` — channel metadata is stable. */
  channel: 24 * 60 * 60,
  /** `playlists.list` (public listings only). */
  playlists: 15 * 60,
  /** Fallback when a caller does not pick a TTL. */
  default: 15 * 60,
})

export type CacheTtlName = keyof typeof CACHE_TTL

/** Parameter values a cache key can be derived from. */
export type KeyParams = Record<string, string | number | boolean | undefined>

/**
 * Short, stable, dependency-free hash (FNV-1a, 32 bit).
 *
 * Used for long inputs (query + parameter sets, access tokens) that would
 * otherwise make an unbounded Redis key. Deterministic across processes, so a
 * key built in one instance is found by the next one.
 */
export function hashKey(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  // Mix the length in so that permutations of the same characters differ.
  hash ^= value.length
  hash = Math.imul(hash, 0x01000193) >>> 0
  return hash.toString(16).padStart(8, '0')
}

/**
 * Canonical string for a parameter set: sorted, empty values dropped.
 *
 * Sorting is what makes the key independent of the caller's object key order,
 * so `cachedFetch('search.list', {q, type})` and the reverse produce the same
 * cache entry instead of two.
 */
export function canonicalParams(params: KeyParams): string {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== '' && value !== false)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join('&')
}

/**
 * Makes a value safe to use inside a cache key.
 *
 * Whitespace and control characters become `_`; hyphens, slashes and dots are
 * preserved because YouTube ids and topic slugs legitimately contain them.
 */
function sanitizeSegment(value: string): string {
  const printable = Array.from(value.trim(), (character) => {
    const code = character.codePointAt(0) ?? 0
    return code < 32 || code === 127 ? '_' : character
  }).join('')
  return printable.replace(/\s+/g, '_')
}

/**
 * Key for a search query.
 *
 * The query is lower-cased and whitespace-collapsed because YouTube search is
 * case-insensitive — two spellings of the same seed should hit one entry.
 * Extra parameters (`type`, `maxResults`, `pageToken` …) are folded into a
 * short hash so the key stays short but still distinguishes them.
 */
export function searchKey(query: string, extra?: KeyParams): string {
  const normalized = sanitizeSegment(query.toLowerCase().replace(/\s+/g, ' '))
  const suffix = extra ? canonicalParams(extra) : ''
  return suffix ? `search:${normalized}#${hashKey(suffix)}` : `search:${normalized}`
}

/**
 * Key for a batch of video ids.
 *
 * Ids are de-duplicated and sorted so the order the caller happened to build
 * the list in can never split one logical request into two cache entries.
 */
export function videosKey(ids: string[] | string): string {
  const list = Array.isArray(ids) ? ids : ids.split(',')
  const normalized = Array.from(
    new Set(list.map((id) => sanitizeSegment(id)).filter((id) => id.length > 0)),
  ).sort()
  return `videos:${normalized.join(',')}`
}

/** Key for a YouTube topic (music genre) page. */
export function topicKey(topicId: string): string {
  return `topic:${sanitizeSegment(topicId)}`
}

/** Key for the item list of a single playlist. */
export function playlistItemsKey(playlistId: string): string {
  return `playlistItems:${sanitizeSegment(playlistId)}`
}

/** Key for channel metadata. */
export function channelKey(channelId: string): string {
  return `channel:${sanitizeSegment(channelId)}`
}

/** Generic namespaced key for operations without a dedicated builder. */
export function namespacedKey(prefix: string, params: KeyParams): string {
  return `${prefix}:${hashKey(canonicalParams(params))}`
}
