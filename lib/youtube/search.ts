import { cachedFetch } from '@/lib/cache'

import { DEMO_TRACKS } from './demo'
import { parseChannelName } from './artist'
import { canReachLiveApi, parseIsoDuration, type QuotaMeter } from './client'
import type { Track } from './types'

/**
 * Search helpers over the YouTube Data API.
 *
 * Every upstream call funnels through `youtubeFetch` so quota accounting
 * stays in one place, and every helper degrades to the built-in demo
 * catalogue when no API key is configured — the product must stay usable
 * before anyone wires up a Google Cloud project.
 *
 * The reads go through `cachedFetch` rather than `youtubeFetch` directly.
 * `search.list` costs 100 units — a hundredth of the day's budget — so a
 * seed that two visitors type in the same afternoon must be paid for once,
 * not twice. The cache key is built from the query alone, so the entry is
 * shared by every visitor, and the ledger records the spend of the call
 * that actually went out.
 */

/**
 * Per-request context for a search.
 *
 * `sessionId` and `runId` attribute the spend in the quota ledger; the
 * credential fields let a caller answer with its own API key.
 */
export type SearchInit = {
  sessionId?: string
  runId?: string
  accessToken?: string
  apiKeyOverride?: string
}

/** One `search.list` hit. */
export type SearchItem = {
  id?: { videoId?: string; channelId?: string }
  snippet?: {
    title?: string
    channelTitle?: string
    channelId?: string
    publishedAt?: string
    categoryId?: string
  }
}

export type SearchResponse = {
  items?: SearchItem[]
}

/**
 * The three values `snippet.liveBroadcastContent` can meaningfully take.
 *
 * It is a broadcast flag, not a version tag: it says the video *is* a live
 * broadcast, not that the song has a live recording (PLAN-ADDENDUM §34
 * correction 2).
 */
export type LiveBroadcastContent = 'none' | 'upcoming' | 'live'

const LIVE_BROADCAST_CONTENT = new Set<string>(['none', 'upcoming', 'live'])

/** One `videos.list` entry. */
export type VideoItem = {
  id?: string
  snippet?: {
    title?: string
    channelTitle?: string
    channelId?: string
    publishedAt?: string
    categoryId?: string
    defaultLanguage?: string
    tags?: string[]
    /** The wire format is a plain string; only three values are meaningful. */
    liveBroadcastContent?: string
  }
  topicDetails?: {
    topicId?: string
    topicCategories?: string[]
    topicCategoryLinks?: Array<{ title?: string; url?: string }>
  }
  contentDetails?: {
    duration?: string
    /**
     * `contentDetails.regionRestriction` — the *only* place the Data API
     * reports region restrictions. There is no `snippet.availableCountries`
     * (PLAN-ADDENDUM §34 correction 1).
     */
    regionRestriction?: { blocked?: string[]; allowed?: string[] }
  }
  statistics?: { viewCount?: string; likeCount?: string }
  status?: { madeForKids?: boolean; embeddable?: boolean; license?: string }
}

export type VideoListResponse = {
  items?: VideoItem[]
}

type ChannelListResponse = {
  items?: Array<{ id?: string; snippet?: { title?: string } }>
}

/** A channel we resolved from an artist name or a pasted channel URL. */
export type ResolvedChannel = {
  id: string
  title: string
  /** `topic` = auto-generated artist channel, `channel` = a hand-made channel. */
  kind: 'topic' | 'channel'
}

/**
 * The topic slug → display name conversion.
 *
 * It lives in `lib/youtube/topic.ts` now, so the hydrator and the engine
 * cannot disagree about what a topic is called. Re-exported here because
 * this module has always been the place callers reached for it.
 */
import { topicNameFromUrl, topicCategoriesOf } from './topic'
import { filterTracks } from './music'
import { rankByRelevance } from './query'
export { topicNameFromUrl }

/**
 * Hydrate one `videos.list` entry into a `Track`.
 *
 * This is the single place where the Data API shape becomes a domain object —
 * every caller goes through it so a field added here reaches every surface.
 */
export function trackFromVideo(item: VideoItem): Track | null {
  if (!item.id) return null
  const title = item.snippet?.title ?? 'Unknown track'

  // The category *names* matter: a seed centroid turns them into the genre
  // list the scoring engine explains itself with. The API's own titles win;
  // the URL slug is only a fallback for when the links carry no title.
  const topicCategories = topicCategoriesOf(item)
  const topicCategoryNames = (item.topicDetails?.topicCategoryLinks ?? [])
    .map((link) => link.title?.trim())
    .filter((name): name is string => Boolean(name))

  // The region restriction is the only region signal the API gives. It is
  // present only on restricted content, so its absence means "no
  // restriction reported" — never "available everywhere".
  const restriction = item.contentDetails?.regionRestriction
  const allowedCountries = restriction?.allowed?.map((code) => code.toUpperCase()) ?? []

  return {
    videoId: item.id,
    title,
    artist: item.snippet?.channelTitle ?? 'Unknown artist',
    channelTitle: item.snippet?.channelTitle ?? 'Unknown channel',
    durationSec: parseIsoDuration(item.contentDetails?.duration),
    thumbnail: `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`,
    topicId: item.topicDetails?.topicId ?? '',
    topicName: topicNameFromUrl(item.topicDetails?.topicCategories?.[0]),
    viewCount: Number(item.statistics?.viewCount ?? 0),
    publishedAt: item.snippet?.publishedAt ?? new Date().toISOString(),
    categoryId: item.snippet?.categoryId ?? '10',
    ...(item.snippet?.channelId ? { channelId: item.snippet.channelId } : {}),
    ...(topicCategories.length > 0 ? { topicCategories } : {}),
    ...(topicCategoryNames.length > 0 ? { topicCategoryNames } : {}),
    ...(restriction ? { regionRestriction: restriction } : {}),
    ...(allowedCountries.length > 0 ? { availableCountries: allowedCountries } : {}),
    ...(item.snippet?.liveBroadcastContent &&
    LIVE_BROADCAST_CONTENT.has(item.snippet.liveBroadcastContent)
      ? { liveBroadcastContent: item.snippet.liveBroadcastContent as LiveBroadcastContent }
      : {}),
    ...(item.snippet?.defaultLanguage ? { language: item.snippet.defaultLanguage } : {}),
    ...(item.snippet?.tags?.length ? { tags: item.snippet.tags } : {}),
    ...(item.statistics?.likeCount !== undefined
      ? { likeCount: Number(item.statistics.likeCount) }
      : {}),
    ...(item.status?.madeForKids !== undefined ? { madeForKids: item.status.madeForKids } : {}),
    ...(item.status?.embeddable !== undefined ? { embeddable: item.status.embeddable } : {}),
    ...(item.status?.license ? { license: item.status.license } : {}),
  }
}

/** Drop the entries the API could not hydrate (deleted, private, region-locked). */
export function tracksFromVideos(items: VideoItem[]): Track[] {
  return items.map(trackFromVideo).filter((track): track is Track => track !== null)
}

/**
 * Hydrate a list of video ids.
 *
 * `videos.list` accepts 50 ids per call and costs one unit, so the ids are
 * batched; the returned tracks keep the caller's order so a seed's candidate
 * list reads the same way the search did.
 */
export async function videosByIds(
  ids: string[],
  meter: QuotaMeter,
  init: SearchInit = {},
): Promise<Track[]> {
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length === 0) return []
  if (!canReachLiveApi(init.apiKeyOverride)) return demoTracksByIds(unique)

  const byId = new Map<string, Track>()
  for (let index = 0; index < unique.length; index += 50) {
    const batch = unique.slice(index, index + 50)
    const response = await cachedFetch<VideoListResponse>(
      'videos.list',
      {
        // `status` carries the licence and the madeForKids flag. The
        // discovery hydrator already asks for it; the seed hydrator did not,
        // so every seed carried `license: undefined`.
        part: 'snippet,topicDetails,contentDetails,statistics,status',
        id: batch.join(','),
      },
      meter,
      init,
    )
    for (const track of tracksFromVideos(response.items ?? [])) {
      byId.set(track.videoId, track)
    }
  }

  return unique
    .map((id) => byId.get(id))
    .filter((track): track is Track => track !== undefined)
}

/**
 * Resolve a free-text seed into candidate tracks (PLAN §4 stage 1 + 2).
 *
 * Works without credentials: with no API key the demo catalogue is searched
 * instead, so the product is explorable before anyone wires up a Google Cloud
 * project.
 */
export async function searchSeeds(
  query: string,
  meter: QuotaMeter,
  init: SearchInit = {},
): Promise<Track[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  if (!canReachLiveApi(init.apiKeyOverride)) return demoSearch(trimmed)

  const search = await cachedFetch<SearchResponse>(
    'search.list',
    {
      part: 'snippet',
      type: 'video',
      videoCategoryId: '10',
      // The Music category holds hour-long radio streams and DJ mixes
      // alongside the recordings. `medium` (4–20 minutes) drops most of
      // them on the server, and it costs nothing: a search is charged per
      // request, not per result, so the wider page is free.
      videoDuration: 'medium',
      // The same reason. Eight hits was barely enough to survive the
      // filter below; twenty-five is still one unit of quota.
      maxResults: 25,
      q: trimmed,
    },
    meter,
    init,
  )

  const ids = (search.items ?? [])
    .map((item) => item.id?.videoId)
    .filter((id): id is string => Boolean(id))
  if (ids.length === 0) return []

  // The server-side filter cannot tell a recording from a radio segment,
  // and the sources that feed discovery have no server-side filter at all,
  // so the shape is decided here. The order matters: a track that answers
  // the query has to survive the filter before it can be ranked, and the
  // ranking is what puts the artist's own recordings on top of a page of
  // unrelated uploads.
  return rankByRelevance(filterTracks(await videosByIds(ids, meter, init)), trimmed)
}

/**
 * List a channel's music videos.
 *
 * This is the artist expansion step of the resolver: the artist channel is
 * the closest thing YouTube offers to "everything by this artist".
 */
export async function searchByChannelId(
  channelId: string,
  meter: QuotaMeter,
  init: SearchInit = {},
): Promise<Track[]> {
  const trimmed = channelId.trim()
  if (!trimmed) return []
  if (!canReachLiveApi(init.apiKeyOverride)) return demoTracksByChannelId(trimmed)

  const search = await cachedFetch<SearchResponse>(
    'search.list',
    {
      part: 'snippet',
      channelId: trimmed,
      type: 'video',
      videoCategoryId: '10',
      maxResults: 25,
    },
    meter,
    init,
  )

  const ids = (search.items ?? [])
    .map((item) => item.id?.videoId)
    .filter((id): id is string => Boolean(id))
  if (ids.length === 0) return []

  return filterTracks(await videosByIds(ids, meter, init))
}

/**
 * Turn an artist name into the channel that represents them.
 *
 * An auto-generated `- Topic` channel is preferred: it is YouTube's own
 * artist entity, so its catalogue is the artist's catalogue.
 */
export async function resolveChannel(
  query: string,
  meter: QuotaMeter,
  init: SearchInit = {},
): Promise<ResolvedChannel | null> {
  const trimmed = query.trim()
  if (!trimmed) return null
  if (!canReachLiveApi(init.apiKeyOverride)) return demoResolveChannel(trimmed)

  const search = await cachedFetch<SearchResponse>(
    'search.list',
    {
      part: 'snippet',
      type: 'channel',
      q: trimmed,
      maxResults: 5,
    },
    meter,
    init,
  )

  const channels = (search.items ?? [])
    .map((item) => ({ id: item.id?.channelId ?? '', title: item.snippet?.title ?? '' }))
    .filter((channel) => channel.id && channel.title)
  if (channels.length === 0) return null

  const topic = channels.find((channel) => parseChannelName(channel.title).kind === 'topic')
  const chosen = topic ?? channels[0]
  return {
    id: chosen.id,
    title: chosen.title,
    kind: parseChannelName(chosen.title).kind === 'topic' ? 'topic' : 'channel',
  }
}

/**
 * Look a channel up by id.
 *
 * A pasted channel URL already tells us *which* channel; only the display
 * name is missing, and one cheap `channels.list` call is enough for it.
 */
export async function channelById(
  channelId: string,
  meter: QuotaMeter,
  init: SearchInit = {},
): Promise<ResolvedChannel | null> {
  const trimmed = channelId.trim()
  if (!trimmed) return null
  if (!canReachLiveApi(init.apiKeyOverride)) return demoChannelById(trimmed)

  const response = await cachedFetch<ChannelListResponse>(
    'channels.list',
    { part: 'snippet', id: trimmed, maxResults: 1 },
    meter,
    init,
  )
  const title = response.items?.[0]?.snippet?.title
  if (!title) return null
  return {
    id: trimmed,
    title,
    kind: parseChannelName(title).kind === 'topic' ? 'topic' : 'channel',
  }
}

/** Search the built-in catalogue — the demo stand-in for `search.list`. */
export function demoSearch(query: string): Track[] {
  const needle = query.toLowerCase().trim()
  const scored = DEMO_TRACKS.map((track) => {
    const haystack = `${track.title} ${track.artist} ${track.channelTitle}`.toLowerCase()
    if (!haystack.includes(needle)) return null
    const titleHit = track.title.toLowerCase().includes(needle) ? 2 : 0
    const artistHit = track.artist.toLowerCase().includes(needle) ? 1 : 0
    return { track, weight: titleHit + artistHit }
  }).filter((entry): entry is { track: Track; weight: number } => entry !== null)

  return scored
    .sort((a, b) => b.weight - a.weight || b.track.viewCount - a.track.viewCount)
    .map((entry) => entry.track)
}

/* ── demo plumbing ───────────────────────────────────────────────────────── */

/**
 * Demo channels are synthetic ids.
 *
 * The catalogue has no real channel ids, so a stable slug of the channel name
 * stands in — it only has to survive a round trip inside this process.
 */
function demoChannelId(title: string): string {
  return `demo:${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`
}

function demoChannels(): Array<{ id: string; title: string }> {
  const titles = new Set(DEMO_TRACKS.map((track) => track.channelTitle))
  return [...titles].map((title) => ({ id: demoChannelId(title), title }))
}

function demoTracksByIds(ids: string[]): Track[] {
  const wanted = new Set(ids)
  return DEMO_TRACKS.filter((track) => wanted.has(track.videoId))
}

function demoTracksByChannelId(channelId: string): Track[] {
  return DEMO_TRACKS.filter((track) => demoChannelId(track.channelTitle) === channelId)
}

function demoChannelById(channelId: string): ResolvedChannel | null {
  const found = demoChannels().find((channel) => channel.id === channelId)
  if (!found) return null
  return {
    id: found.id,
    title: found.title,
    kind: parseChannelName(found.title).kind === 'topic' ? 'topic' : 'channel',
  }
}

function demoResolveChannel(query: string): ResolvedChannel | null {
  const needle = query.toLowerCase().trim()
  if (!needle) return null

  const matched = demoChannels().filter(
    (channel) =>
      channel.title.toLowerCase().includes(needle) ||
      DEMO_TRACKS.some(
        (track) => track.channelTitle === channel.title && track.artist.toLowerCase().includes(needle),
      ),
  )
  if (matched.length === 0) return null

  const topic = matched.find((channel) => parseChannelName(channel.title).kind === 'topic')
  const chosen = topic ?? matched[0]
  return {
    id: chosen.id,
    title: chosen.title,
    kind: parseChannelName(chosen.title).kind === 'topic' ? 'topic' : 'channel',
  }
}
