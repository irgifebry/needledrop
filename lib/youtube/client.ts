import { UNIT_COST } from '@/lib/quota'

const API_BASE = 'https://www.googleapis.com/youtube/v3'

export type QuotaMeter = {
  units: number
  calls: number
  operations: Array<{ operation: string; units: number }>
}

export function createMeter(): QuotaMeter {
  return { units: 0, calls: 0, operations: [] }
}

export function apiKey(): string | undefined {
  return process.env.YOUTUBE_API_KEY || process.env.NEXT_PUBLIC_YOUTUBE_API_KEY
}

export function hasLiveApi(): boolean {
  return Boolean(apiKey())
}

/**
 * Every Data API method the app is allowed to call.
 *
 * The union is exhaustive on purpose: adding an operation here means adding
 * its quota cost, so the cost model can never drift from the call sites.
 */
export type Operation =
  | 'search.list'
  | 'videos.list'
  | 'playlistItems.list'
  | 'playlistItems.insert'
  | 'playlistItems.update'
  | 'playlistItems.delete'
  | 'playlists.list'
  | 'playlists.insert'
  | 'playlists.update'
  | 'playlists.delete'
  | 'channels.list'
  | 'liveBroadcasts.list'
  | 'activities.list'
  | 'subscriptions.list'
  | 'videoCategories.list'

const COST: Record<Operation, number> = {
  'search.list': UNIT_COST.search,
  'videos.list': UNIT_COST.videosList,
  'playlistItems.list': UNIT_COST.playlistItemsList,
  'playlistItems.insert': UNIT_COST.playlistItemsInsert,
  'playlistItems.update': UNIT_COST.playlistItemsUpdate,
  'playlistItems.delete': UNIT_COST.playlistItemsDelete,
  'playlists.list': UNIT_COST.playlistsList,
  'playlists.insert': UNIT_COST.playlistsInsert,
  'playlists.update': UNIT_COST.playlistsUpdate,
  'playlists.delete': UNIT_COST.playlistsDelete,
  'channels.list': UNIT_COST.channelsList,
  'liveBroadcasts.list': UNIT_COST.liveBroadcastsList,
  'activities.list': UNIT_COST.activitiesList,
  'subscriptions.list': UNIT_COST.subscriptionsList,
  'videoCategories.list': UNIT_COST.videoCategoriesList,
}

export class YouTubeError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    /** `Retry-After` in milliseconds, when the upstream sent one. */
    readonly retryAfterMs?: number,
  ) {
    super(message)
    this.name = 'YouTubeError'
  }
}

export type FetchInit = RequestInit & {
  /** OAuth access token. Wins over the API key. */
  accessToken?: string
  /** A user-supplied key that overrides the shared project key. */
  apiKeyOverride?: string
  /** Abort after this many milliseconds. */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 15_000

/**
 * The REST path of an operation.
 *
 * The Data API exposes plain resource paths — `youtube/v3/search`,
 * `youtube/v3/playlistItems` — while the operation names above are the
 * dotted *method* names from the discovery document (`search.list`,
 * `playlists.insert`). The method names are the ones quota accounting, the
 * cache keys and the cost model speak, so the path is derived from them here,
 * in one place, rather than at every call site.
 *
 * No resource name contains a dot, so the first segment is always the path.
 */
function resourcePath(operation: Operation): string {
  return operation.split('.')[0]
}

/**
 * Thin wrapper around the Data API. Every upstream call funnels through here
 * so quota accounting and error mapping live in exactly one place (PLAN §9).
 */
export async function youtubeFetch<T>(
  operation: Operation,
  params: Record<string, string | number | boolean | undefined>,
  meter: QuotaMeter,
  init: FetchInit = {},
): Promise<T> {
  const { accessToken, apiKeyOverride, timeoutMs, ...rest } = init
  const key = apiKeyOverride ?? apiKey()
  const search = new URLSearchParams()

  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== '' && value !== false) {
      search.set(name, String(value))
    }
  }
  if (accessToken) {
    search.set('access_token', accessToken)
  } else if (key) {
    search.set('key', key)
  }

  const url = `${API_BASE}/${resourcePath(operation)}?${search.toString()}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? DEFAULT_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(url, {
      ...rest,
      headers: {
        'Content-Type': 'application/json',
        ...(rest.headers ?? {}),
      },
      cache: 'no-store',
      signal: controller.signal,
    })
  } catch (error) {
    clearTimeout(timer)
    const aborted = error instanceof Error && error.name === 'AbortError'
    throw new YouTubeError(
      aborted
        ? 'The YouTube API did not respond in time. Try again.'
        : 'The network request to the YouTube API failed.',
      aborted ? 'timeout' : 'networkError',
      504,
    )
  } finally {
    clearTimeout(timer)
  }

  const units = COST[operation]
  meter.units += units
  meter.calls += 1
  meter.operations.push({ operation, units })

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: { message?: string; errors?: Array<{ reason?: string }> }
    }
    const reason = body.error?.errors?.[0]?.reason ?? 'unknown'
    const message =
      reason === 'quotaExceeded' || reason === 'dailyLimitExceeded'
        ? 'The daily API quota is exhausted. Try again tomorrow, or bring your own key.'
        : (body.error?.message ?? 'The YouTube API rejected the request.')
    const retryAfter = Number(response.headers.get('retry-after') ?? '')
    throw new YouTubeError(
      message,
      reason,
      response.status,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
    )
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

/** `contentDetails.duration` is ISO-8601 (`PT3M33S`), not seconds. */
export function parseIsoDuration(iso: string | undefined): number {
  if (!iso) return 0
  // Each alternative is a single bounded digit run, so the match is linear —
  // the unsafe-regex heuristic flags the optional groups, not a real backtrack.
  // eslint-disable-next-line security/detect-unsafe-regex
  const match = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso)
  if (!match) return 0
  const [, days, hours, minutes, seconds] = match
  return (
    Number(days ?? 0) * 86_400 +
    Number(hours ?? 0) * 3_600 +
    Number(minutes ?? 0) * 60 +
    Number(seconds ?? 0)
  )
}
