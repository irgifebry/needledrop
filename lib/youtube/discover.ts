/**
 * The discovery pipeline (PLAN §4, §13.1; PLAN-ADDENDUM §34).
 *
 * This module's job is to *gather and hydrate*: decide where to look and turn
 * an API response into a `Track`. Every judgement call — version filter,
 * duration window, family mode, region safety, blocked lists, canonical
 * dedupe, per-artist cap, ordering — belongs to the scoring engine in
 * `lib/youtube/similar.ts`. Duplicating any of it here would let the two
 * drift apart, so the pipeline hands the engine the raw candidates and the
 * real source list and lets the engine decide.
 *
 * Quota is the scarce resource (the project shares one 10,000-unit daily
 * quota between every user), so the sources are visited cheapest first:
 *
 * | Source | Call | Units |
 * |---|---|---|
 * | Regional trending chart | `videos.list?chart=mostPopular` | 1 |
 * | Artist radio | `channels.list` + `playlistItems.list` | 2 |
 * | Curated playlist | `playlistItems.list` | 1 each |
 * | Topic expansion | `search.list` | 100 |
 * | Related videos | `search.list` | 100 |
 * | Second hop | `search.list` × 3 | 300 |
 * | Hydration | `videos.list` (50 ids per call) | 1 per call |
 *
 * Every call goes through `cachedFetch`, so a cache hit costs nothing — the
 * ledger records the call as cached and the meter is not charged.
 */

import { z } from 'zod'

import corpusJson from '@/corpus/playlists.json'
import { cachedFetch, setCached } from '@/lib/cache'
import { CACHE_TTL, namespacedKey } from '@/lib/cache/keys'
import { UNIT_COST } from '@/lib/quota'
import { assertWithinBudget, budgetStatus } from '@/lib/quota-ledger'
import {
  canReachLiveApi,
  isQuotaError,
  parseIsoDuration,
  type QuotaMeter,
} from '@/lib/youtube/client'
import { orderCandidates, seedArtists, selectPlaylist, toCandidate } from '@/lib/youtube/similar'
import { topicCategoriesOf, topicNameFromUrl } from '@/lib/youtube/topic'

import { DEMO_TRACKS, demoSources } from './demo'
import type { Candidate, DiscoveryOptions, SourceKind, Track } from './types'

/* ── request shapes ─────────────────────────────────────────────────────── */

/**
 * The seed a client may send.
 *
 * The required fields are exactly the ones the legacy `/api/similar` route
 * accepts, so one payload works on both routes. The v2 enrichment fields are
 * optional because only a hydrated track carries them — and a seed without
 * `channelId` simply loses the 2-unit artist-radio source (paying 100 units
 * for a `search.list` fallback is never worth it).
 */
export const seedSchema = z.object({
  videoId: z.string().min(1).max(64),
  title: z.string().max(400),
  artist: z.string().max(400),
  channelTitle: z.string().max(400),
  durationSec: z.number().min(0).max(86_400),
  thumbnail: z.string().max(500),
  topicId: z.string().max(200),
  topicName: z.string().max(200),
  viewCount: z.number().min(0),
  publishedAt: z.string().max(64),
  categoryId: z.string().max(8),
  channelId: z.string().max(64).optional(),
  trackKey: z.string().max(400).optional(),
  featureArtist: z.string().max(400).nullish(),
  topicCategories: z.array(z.string().max(200)).optional(),
  topicCategoryNames: z.array(z.string().max(200)).optional(),
  likeCount: z.number().min(0).optional(),
  language: z.string().max(16).optional(),
  availableCountries: z.array(z.string().max(8)).optional(),
  regionRestriction: z
    .object({
      blocked: z.array(z.string().max(8)).optional(),
      allowed: z.array(z.string().max(8)).optional(),
    })
    .optional(),
  liveBroadcastContent: z.enum(['none', 'upcoming', 'live']).optional(),
  tags: z.array(z.string().max(200)).optional(),
  madeForKids: z.boolean().optional(),
  embeddable: z.boolean().optional(),
  license: z.string().max(64).optional(),
})

/**
 * The body of `POST /api/discover`.
 *
 * `options` stays `unknown` on purpose: `normalizeDiscoveryOptions` accepts
 * the v1 shape *and* the v2 shape and fills in the defaults, so the route
 * never has to know which shape the client speaks.
 */
export const discoveryRequestSchema = z.object({
  seed: seedSchema,
  options: z.unknown().optional(),
})

/* ── upstream shapes ────────────────────────────────────────────────────── */

type SearchResponse = {
  items?: Array<{
    id?: { videoId?: string }
    snippet?: { categoryId?: string }
  }>
}

type PlaylistItemsResponse = {
  items?: Array<{ contentDetails?: { videoId?: string } }>
}

type ChannelResponse = {
  items?: Array<{
    id?: string
    contentDetails?: { relatedPlaylists?: { uploads?: string } }
  }>
}

type VideoItem = {
  id?: string
  snippet?: {
    title?: string
    channelTitle?: string
    channelId?: string
    publishedAt?: string
    categoryId?: string
    defaultLanguage?: string
    liveBroadcastContent?: 'none' | 'upcoming' | 'live'
    tags?: string[]
  }
  topicDetails?: {
    topicId?: string
    topicCategories?: string[]
    topicCategoryLinks?: Array<{ title?: string; url?: string }>
  }
  contentDetails?: {
    duration?: string
    regionRestriction?: { blocked?: string[]; allowed?: string[] }
  }
  statistics?: { viewCount?: string; likeCount?: string }
  status?: { madeForKids?: boolean; embeddable?: boolean; license?: string }
}

type VideoResponse = { items?: VideoItem[] }

/** An entry of the operator-verified playlist corpus (PLAN-ADDENDUM §34 #14). */
type CorpusPlaylist = {
  id: string
  label?: string
  genre?: string
  verifiedAt?: string
}

/**
 * The curated playlist corpus.
 *
 * It is empty on purpose: `guideCategories.list` returns names, not playlist
 * ids, so an operator has to verify every id by hand. The code therefore
 * treats the corpus as optional and skips the source entirely when it is
 * empty — a fabricated id would only 404 and waste a unit.
 */
const curatedPlaylists: CorpusPlaylist[] = (corpusJson.playlists ?? []) as CorpusPlaylist[]

/** How many hop-1 winners are expanded into a second hop (PLAN §13.1.2). */
const HOP2_SEEDS = 3

/** How many ids one `videos.list` call can hydrate (1 unit per call). */
const HYDRATION_BATCH = 50

/* ── context ────────────────────────────────────────────────────────────── */

export type DiscoverContext = {
  /** The visitor's two-letter country code, when the platform knows it. */
  region?: string | null
  /** Canonical track keys the user already has, for library-aware dedupe. */
  libraryKeys?: Set<string>
  /** 1 or 2 hops. Overrides `options.depth` when present. */
  depth?: 1 | 2
  /** Session id, so the ledger can attribute the spend. */
  sessionId?: string
  /** Run id, so the ledger can attribute the spend to one generation run. */
  runId?: string
  /**
   * The visitor's own YouTube API key.
   *
   * When set, every call in the run is billed to the visitor's own Google
   * Cloud project instead of the shared one, so their searches do not eat
   * the budget everybody else shares.
   */
  apiKeyOverride?: string
}

/* ── the pipeline ───────────────────────────────────────────────────────── */

/**
 * Runs the discovery pipeline and returns the scored, deduped playlist.
 *
 * With no `YOUTUBE_API_KEY` the built-in catalogue is scored instead and the
 * network is never touched — demo mode is checked first on purpose, because
 * demo mode costs no quota and must never be blocked by a budget somebody
 * else spent.
 */
export async function discover(
  seed: Track,
  options: DiscoveryOptions,
  meter: QuotaMeter,
  context: DiscoverContext = {},
): Promise<Candidate[]> {
  if (!canReachLiveApi(context.apiKeyOverride)) {
    const demo = discoverDemo(seed, options, context)
    await cacheCandidates(seed, options, demo)
    return demo
  }

  const sessionId = context.sessionId ?? 'anonymous'
  // The shared budget caps what the deployment spends on everybody's
  // behalf. A visitor who brought their own key spends their own quota, so
  // the shared cap has nothing to say about their run.
  const onOwnKey = Boolean(context.apiKeyOverride)
  if (!onOwnKey) {
    assertWithinBudget(sessionId)
  }

  const depth = context.depth ?? options.depth
  const sources = new Map<string, SourceKind[]>()
  const hydrated = new Map<string, Track>()

  // 1 — Regional trending chart. One unit, and it arrives fully hydrated.
  await collectTrending(meter, context, sources, hydrated)
  // 2 — Artist radio. Two units (channels.list + playlistItems.list).
  await collectArtistRadio(seed, meter, context, sources)
  // 3 — Curated playlists. One unit each, only for operator-verified ids.
  await collectCurated(meter, context, sources)
  // 4 — Topic expansion. 100 units.
  await collectTopic(seed, options, meter, context, sources)
  // 5 — Related videos. 100 units.
  await collectRelated(seed, options, meter, context, sources)

  // Hydrate hop 1 before the second hop, so the second hop can be seeded
  // with the *actual* winners rather than an arbitrary guess.
  for (const [id, track] of await hydrateTracks(pendingIds(sources, hydrated), meter, context)) {
    hydrated.set(id, track)
  }

  // 6 — Second hop: `related` on the three best hop-1 winners.
  if (depth === 2) {
    await collectSecondHop(seed, options, meter, context, sources, hydrated)
  }

  const candidates = buildCandidates(hydrated, sources, seed, options, context)
  const selected = finalize(candidates, options, context, seed)
  await cacheCandidates(seed, options, selected)
  return selected
}

/* ── sources ────────────────────────────────────────────────────────────── */

/** Adds a source to every id that was found through it. */
function collect(sources: Map<string, SourceKind[]>, ids: Iterable<string>, kind: SourceKind): void {
  for (const id of ids) {
    if (!id) continue
    const list = sources.get(id)
    if (!list) {
      sources.set(id, [kind])
      continue
    }
    if (!list.includes(kind)) list.push(kind)
  }
}

/** The ids that still have to be hydrated (the chart arrives complete). */
function pendingIds(sources: Map<string, SourceKind[]>, hydrated: Map<string, Track>): string[] {
  return [...sources.keys()].filter((id) => !hydrated.has(id))
}

/**
 * The regional trending chart (PLAN-ADDENDUM §34 correction 9).
 *
 * `videos.list?chart=mostPopular&videoCategoryId=10` costs **one** unit and
 * yields the chart for the visitor's region — which makes it the cheapest
 * source in the pipeline by an order of magnitude.
 */
async function collectTrending(
  meter: QuotaMeter,
  context: DiscoverContext,
  sources: Map<string, SourceKind[]>,
  hydrated: Map<string, Track>,
): Promise<void> {
  try {
    const response = await cachedFetch<VideoResponse>(
      'videos.list',
      {
        part: 'snippet,topicDetails,contentDetails,statistics,status',
        chart: 'mostPopular',
        videoCategoryId: '10',
        maxResults: 50,
        // Only sent when the region is known: a wrong guess would be a lie.
        regionCode: context.region ?? undefined,
      },
      meter,
      { sessionId: context.sessionId, runId: context.runId, apiKeyOverride: context.apiKeyOverride },
    )

    const ids: string[] = []
    for (const item of response.items ?? []) {
      const track = trackFromVideo(item)
      if (!track) continue
      hydrated.set(track.videoId, track)
      ids.push(track.videoId)
    }
    collect(sources, ids, 'trending')
  } catch (error) {
    if (isQuotaError(error)) throw error
    // The chart is a bonus; losing it must not lose the run.
  }
}

/**
 * The artist's own catalogue, for two units instead of a hundred.
 *
 * `search.list?q=<artist>+radio` costs 100 units (PLAN-ADDENDUM §34
 * correction 10). The cheap path is `channels.list?part=contentDetails` →
 * `relatedPlaylists.uploads` → `playlistItems.list`, which is two units.
 * When the seed has no channel id the source is skipped rather than paying
 * the expensive fallback.
 */
async function collectArtistRadio(
  seed: Track,
  meter: QuotaMeter,
  context: DiscoverContext,
  sources: Map<string, SourceKind[]>,
): Promise<void> {
  const channelId = seed.channelId?.trim()
  if (!channelId) return

  try {
    const channels = await cachedFetch<ChannelResponse>(
      'channels.list',
      { part: 'contentDetails', id: channelId, maxResults: 1 },
      meter,
      { sessionId: context.sessionId, runId: context.runId, apiKeyOverride: context.apiKeyOverride },
    )
    const uploads = channels.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
    if (!uploads) return

    const items = await cachedFetch<PlaylistItemsResponse>(
      'playlistItems.list',
      { part: 'contentDetails', playlistId: uploads, maxResults: 50 },
      meter,
      { sessionId: context.sessionId, runId: context.runId, apiKeyOverride: context.apiKeyOverride },
    )
    collect(
      sources,
      (items.items ?? []).map((item) => item.contentDetails?.videoId ?? ''),
      'artistRadio',
    )
  } catch (error) {
    if (isQuotaError(error)) throw error
  }
}

/**
 * The operator-verified curated playlists.
 *
 * One unit each. The corpus starts empty, in which case the source is
 * skipped completely — no id is ever invented.
 */
async function collectCurated(
  meter: QuotaMeter,
  context: DiscoverContext,
  sources: Map<string, SourceKind[]>,
): Promise<void> {
  if (curatedPlaylists.length === 0) return

  for (const entry of curatedPlaylists) {
    if (!entry.id) continue
    try {
      const items = await cachedFetch<PlaylistItemsResponse>(
        'playlistItems.list',
        { part: 'contentDetails', playlistId: entry.id, maxResults: 50 },
        meter,
        { sessionId: context.sessionId, runId: context.runId, apiKeyOverride: context.apiKeyOverride },
      )
      collect(
        sources,
        (items.items ?? []).map((item) => item.contentDetails?.videoId ?? ''),
        'curated',
      )
    } catch (error) {
      if (isQuotaError(error)) throw error
    }
  }
}

/**
 * Topic expansion: the seed's Wikipedia topic as a query.
 *
 * 100 units, so it runs after every cheap source.
 */
async function collectTopic(
  seed: Track,
  options: DiscoveryOptions,
  meter: QuotaMeter,
  context: DiscoverContext,
  sources: Map<string, SourceKind[]>,
): Promise<void> {
  const topic = seed.topicName?.trim()
  if (!topic || topic === 'Unknown topic') return

  try {
    const ids = await searchVideoIds(meter, context, {
      q: topic,
      maxResults: 25,
      ...queryFilters(options),
    })
    collect(sources, ids, 'topic')
  } catch (error) {
    if (isQuotaError(error)) throw error
  }
}

/** Related videos: the closest thing YouTube has to "songs like this". */
async function collectRelated(
  seed: Track,
  options: DiscoveryOptions,
  meter: QuotaMeter,
  context: DiscoverContext,
  sources: Map<string, SourceKind[]>,
): Promise<void> {
  try {
    const ids = await searchVideoIds(meter, context, {
      relatedToVideoId: seed.videoId,
      maxResults: 50,
      ...queryFilters(options),
    })
    collect(sources, ids, 'related')
  } catch (error) {
    if (isQuotaError(error)) throw error
  }
}

/**
 * The second hop: `related` on the three best hop-1 winners.
 *
 * Three `search.list` calls is 300 units, so the hop is skipped when the
 * session budget could not absorb it — the plan says to skip it "when the
 * daily budget is tight".
 */
async function collectSecondHop(
  seed: Track,
  options: DiscoveryOptions,
  meter: QuotaMeter,
  context: DiscoverContext,
  sources: Map<string, SourceKind[]>,
  hydrated: Map<string, Track>,
): Promise<void> {
  const hop1 = buildCandidates(hydrated, sources, seed, options, context)
  const winners = [...hop1].sort((a, b) => b.score - a.score).slice(0, HOP2_SEEDS)
  if (winners.length === 0) return
  // A visitor on their own key pays for the hop out of their own quota, so
  // the shared session budget has no reason to shorten their run.
  if (!context.apiKeyOverride && !hop2Affordable(context.sessionId ?? 'anonymous', winners.length)) {
    return
  }

  const found: string[] = []
  for (const winner of winners) {
    try {
      const ids = await searchVideoIds(meter, context, {
        relatedToVideoId: winner.videoId,
        maxResults: 50,
        ...queryFilters(options),
      })
      found.push(...ids)
    } catch (error) {
      if (isQuotaError(error)) throw error
    }
  }

  collect(sources, found, 'related')
  for (const [id, track] of await hydrateTracks(
    found.filter((id) => !hydrated.has(id)),
    meter,
    context,
  )) {
    hydrated.set(id, track)
  }
}

/* ── queries ────────────────────────────────────────────────────────────── */

/**
 * Runs a music search and returns the video ids it produced.
 *
 * `related` results are not guaranteed to be music (PLAN-ADDENDUM §34
 * correction 8), so the category is checked here as well as after hydration:
 * a non-music id is cheaper to drop now than to hydrate.
 */
async function searchVideoIds(
  meter: QuotaMeter,
  context: DiscoverContext,
  params: Record<string, string | number | boolean | undefined>,
): Promise<string[]> {
  const response = await cachedFetch<SearchResponse>(
    'search.list',
    { part: 'snippet', type: 'video', videoCategoryId: '10', maxResults: 50, ...params },
    meter,
    {
      sessionId: context.sessionId,
      runId: context.runId,
      // Without this the searches would be billed to the shared project
      // even for a visitor who brought their own key — and these are the
      // most expensive calls in the whole pipeline.
      apiKeyOverride: context.apiKeyOverride,
    },
  )

  return (response.items ?? [])
    .filter((item) => {
      const categoryId = item.snippet?.categoryId
      return !categoryId || categoryId === '10'
    })
    .map((item) => item.id?.videoId ?? '')
    .filter((id) => id.length > 0)
}

/**
 * The query-level pre-filters (PLAN §13.1.8).
 *
 * Applying the user's constraints to the *query* means fewer candidates are
 * hydrated (one unit per fifty ids) and no hydrated work is thrown away.
 */
function queryFilters(options: DiscoveryOptions): Record<string, string> {
  const filters: Record<string, string> = {}

  const range = options.publishedRange
  if (range) {
    filters.publishedAfter = `${range.from}-01-01T00:00:00Z`
    filters.publishedBefore = `${range.to}-12-31T23:59:59Z`
  }

  const bucket = durationBucket(options.durationSec)
  if (bucket) filters.videoDuration = bucket

  // `relevanceLanguage` only exists for a single language; with several the
  // choice would be arbitrary, so the filter happens after hydration.
  const languages = options.languages ?? []
  if (languages.length === 1) filters.relevanceLanguage = languages[0]

  return filters
}

/**
 * The YouTube `videoDuration` bucket a window falls into.
 *
 * The buckets are `short` (under four minutes), `medium` (four to twenty
 * minutes) and `long` (over twenty minutes). A window that touches more
 * than one bucket cannot be expressed as a single parameter, so the duration
 * is filtered after hydration instead.
 */
function durationBucket(
  window: { min: number; max: number } | undefined,
): 'short' | 'medium' | 'long' | null {
  if (!window) return null
  const { min, max } = window

  const buckets: Array<'short' | 'medium' | 'long'> = []
  if (min < 240 && max >= 0) buckets.push('short')
  if (min <= 1200 && max >= 240) buckets.push('medium')
  if (max > 1200) buckets.push('long')

  return buckets.length === 1 ? buckets[0] : null
}

/* ── hydration ──────────────────────────────────────────────────────────── */

/**
 * Hydrates video ids into tracks.
 *
 * `videos.list` costs one unit *per call* no matter how many ids it
 * carries (PLAN-ADDENDUM §34 correction 16), so the ids are batched fifty
 * at a time.
 */
async function hydrateTracks(
  ids: string[],
  meter: QuotaMeter,
  context: DiscoverContext,
): Promise<Map<string, Track>> {
  const tracks = new Map<string, Track>()
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length === 0) return tracks

  for (let index = 0; index < unique.length; index += HYDRATION_BATCH) {
    const batch = unique.slice(index, index + HYDRATION_BATCH)
    try {
      const response = await cachedFetch<VideoResponse>(
        'videos.list',
        {
          part: 'snippet,topicDetails,contentDetails,statistics,status',
          id: batch.join(','),
        },
        meter,
        { sessionId: context.sessionId, runId: context.runId, apiKeyOverride: context.apiKeyOverride },
      )
      for (const item of response.items ?? []) {
        const track = trackFromVideo(item)
        if (track) tracks.set(track.videoId, track)
      }
    } catch (error) {
      if (isQuotaError(error)) throw error
      // A failed batch is skipped: partial results beat no results.
    }
  }

  return tracks
}

/** Country codes are normalised so a comparison is never case-sensitive. */
function normalizeCountry(code: string): string {
  return code.trim().toUpperCase()
}

/**
 * Turns a `videos.list` item into a `Track`.
 *
 * The field mapping follows PLAN-ADDENDUM §34: there is no
 * `snippet.availableCountries`, so the region projection comes from
 * `contentDetails.regionRestriction`; an absent restriction means "no region
 * restriction reported", never "available everywhere".
 */
function trackFromVideo(item: VideoItem): Track | null {
  if (!item.id) return null

  const snippet = item.snippet ?? {}
  const details = item.contentDetails ?? {}
  const topicDetails = item.topicDetails
  const restriction = details.regionRestriction
  const allowed = restriction?.allowed?.map(normalizeCountry).filter(Boolean) ?? []

  const topicCategories = topicCategoriesOf(item)
  const topicCategoryNames = (topicDetails?.topicCategoryLinks ?? [])
    .map((link) => link.title?.trim() || topicNameFromUrl(link.url))
    .filter((name) => name.length > 0)

  return {
    videoId: item.id,
    title: snippet.title ?? 'Unknown track',
    artist: snippet.channelTitle ?? 'Unknown artist',
    channelTitle: snippet.channelTitle ?? 'Unknown channel',
    durationSec: parseIsoDuration(details.duration),
    thumbnail: `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`,
    topicId: topicDetails?.topicId ?? '',
    topicName: topicCategories[0] ?? topicNameFromUrl(topicDetails?.topicCategories?.[0]),
    viewCount: Number(item.statistics?.viewCount ?? 0),
    // An unknown publication date stays unknown: pretending it is "now"
    // would feed the recency prior a lie.
    publishedAt: snippet.publishedAt ?? '',
    categoryId: snippet.categoryId ?? '10',
    channelId: snippet.channelId,
    topicCategories: topicCategories.length > 0 ? topicCategories : undefined,
    topicCategoryNames: topicCategoryNames.length > 0 ? topicCategoryNames : undefined,
    likeCount: item.statistics?.likeCount ? Number(item.statistics.likeCount) : undefined,
    language: snippet.defaultLanguage,
    availableCountries: allowed.length > 0 ? allowed : undefined,
    regionRestriction: restriction,
    liveBroadcastContent: snippet.liveBroadcastContent,
    tags: snippet.tags && snippet.tags.length > 0 ? snippet.tags : undefined,
    madeForKids: item.status?.madeForKids,
    embeddable: item.status?.embeddable,
    license: item.status?.license,
  }
}

/* ── candidates ─────────────────────────────────────────────────────────── */

/**
 * Scores every hydrated track and drops what the library already holds.
 *
 * The source list is passed on verbatim: a candidate found by two
 * independent sources earns the cross-source bonus, and that bonus is the
 * engine's decision, not the pipeline's.
 */
function buildCandidates(
  tracks: Map<string, Track>,
  sources: Map<string, SourceKind[]>,
  seed: Track,
  options: DiscoveryOptions,
  context: DiscoverContext,
): Candidate[] {
  const libraryKeys = context.libraryKeys ?? new Set<string>()
  const candidates: Candidate[] = []

  for (const [videoId, track] of tracks) {
    if (videoId === seed.videoId) continue

    const candidate = toCandidate(track, seed, sources.get(videoId) ?? [], options)

    // Library-aware dedupe on the canonical key: the same song uploaded to
    // another channel is still a song the user has.
    if (
      options.skipAlreadyInLibrary &&
      libraryKeys.size > 0 &&
      candidate.trackKey &&
      libraryKeys.has(candidate.trackKey)
    ) {
      continue
    }

    candidates.push(candidate)
  }

  return candidates
}

/**
 * Runs the engine's filters and picks the final list.
 *
 * Everything policy-shaped happens in `selectPlaylist`: versions, duration,
 * family mode, region safety, blocked lists, canonical dedupe and the
 * per-artist cap. The pipeline only supplies the context.
 */
function finalize(
  candidates: Candidate[],
  options: DiscoveryOptions,
  context: DiscoverContext,
  seed: Track,
): Candidate[] {
  const libraryKeys = context.libraryKeys ?? new Set<string>()

  const selected = selectPlaylist(candidates, options, {
    seedVideoIds: [seed.videoId],
    seedArtistKeys: options.hideSeedArtist ? [...seedArtists(seed).keys()] : [],
    userRegion: context.region ?? null,
    libraryTrackKeys: options.skipAlreadyInLibrary ? [...libraryKeys] : [],
  })

  return orderCandidates(selected, options)
}

/* ── demo mode ──────────────────────────────────────────────────────────── */

/**
 * Scores the built-in catalogue.
 *
 * The demo path runs through the very same engine, so the version filter,
 * the duration window, the artist cap and the breadth weighting behave
 * exactly as they do live — the demo must not lie about the behaviour.
 */
function discoverDemo(
  seed: Track,
  options: DiscoveryOptions,
  context: DiscoverContext,
): Candidate[] {
  const tracks = new Map<string, Track>()
  const sources = new Map<string, SourceKind[]>()

  for (const track of DEMO_TRACKS) {
    tracks.set(track.videoId, track)
    sources.set(track.videoId, demoSources(track, seed))
  }

  return finalize(buildCandidates(tracks, sources, seed, options, context), options, context, seed)
}

/* ── the estimate ───────────────────────────────────────────────────────── */

/** One line of the estimate: an operation, what it is for and what it costs. */
export type EstimateLine = {
  /** The Data API operation this line covers. */
  operation: string
  /** What the line is for, in words a user can read. */
  label: string
  /** How many calls the line covers. */
  count: number
  /** How many units the line costs in total. */
  units: number
}

/** The full cost of a planned run: discovery *and* playlist creation. */
export type DiscoveryPlan = {
  units: number
  calls: number
  breakdown: EstimateLine[]
}

/**
 * What a run is *planned* to cost — no call is made.
 *
 * The dry run has to agree with the pipeline, so the numbers live next to
 * the code that spends them: same sources, same order, same batch sizes.
 */
export function estimatePlan(
  seed: Track,
  options: DiscoveryOptions,
  context?: { depth?: 1 | 2 },
): DiscoveryPlan {
  const depth = context?.depth ?? options.depth
  const breakdown: EstimateLine[] = []

  const add = (operation: string, label: string, count: number, units: number): void => {
    if (count <= 0) return
    breakdown.push({ operation, label, count, units })
  }

  add('videos.list', 'Regional trending chart', 1, UNIT_COST.videosList)

  if (seed.channelId?.trim()) {
    add('channels.list', 'Artist channel (uploads playlist)', 1, UNIT_COST.channelsList)
    add('playlistItems.list', 'Artist uploads', 1, UNIT_COST.playlistItemsList)
  }

  const curated = curatedPlaylists.length
  add('playlistItems.list', 'Curated playlists', curated, curated * UNIT_COST.playlistItemsList)

  if (seed.topicName?.trim() && seed.topicName.trim() !== 'Unknown topic') {
    add('search.list', 'Topic expansion', 1, UNIT_COST.search)
  }

  add('search.list', 'Related videos', 1, UNIT_COST.search)

  if (depth === 2) {
    add('search.list', `Second hop (${HOP2_SEEDS} winners)`, HOP2_SEEDS, HOP2_SEEDS * UNIT_COST.search)
  }

  const expected =
    (seed.channelId?.trim() ? 50 : 0) +
    curated * 50 +
    25 +
    50 +
    (depth === 2 ? HOP2_SEEDS * 50 : 0)
  const batches = expected > 0 ? Math.ceil(expected / HYDRATION_BATCH) : 0
  add('videos.list', `Hydration (${expected} candidates)`, batches, batches * UNIT_COST.videosList)

  add('playlists.insert', 'Create the playlist', 1, UNIT_COST.playlistsInsert)
  add(
    'playlistItems.insert',
    `Insert ${options.count} tracks`,
    options.count,
    options.count * UNIT_COST.playlistItemsInsert,
  )

  return {
    units: breakdown.reduce((sum, line) => sum + line.units, 0),
    calls: breakdown.reduce((sum, line) => sum + line.count, 0),
    breakdown,
  }
}

/* ── caching ────────────────────────────────────────────────────────────── */

/**
 * The cache key of a discovery result.
 *
 * The plan route reads it to show a preview without spending quota, so the
 * key has to cover everything that changes the outcome.
 */
export function discoveryCacheKey(seed: Track, options: DiscoveryOptions): string {
  return namespacedKey('discovery', {
    seed: seed.videoId,
    artist: seed.artist,
    options: JSON.stringify(options),
  })
}

/** Stores the result so a later dry run can show a preview for free. */
async function cacheCandidates(
  seed: Track,
  options: DiscoveryOptions,
  candidates: Candidate[],
): Promise<void> {
  try {
    await setCached(discoveryCacheKey(seed, options), candidates, CACHE_TTL.default)
  } catch {
    // A cache write must never break a discovery run.
  }
}

/* ── budget ─────────────────────────────────────────────────────────────── */

/**
 * Whether the session could still absorb the second hop.
 *
 * The plan says to skip hop 2 "when the daily budget is tight"; three
 * `search.list` calls are 300 units, which is a lot to spend speculatively.
 */
function hop2Affordable(sessionId: string, calls: number): boolean {
  const status = budgetStatus(sessionId)
  if (status.globalExceeded) return false
  return status.used + calls * UNIT_COST.search <= status.sessionBudget
}

/* ── request identity ───────────────────────────────────────────────────── */
/**
 * A stable identity for the quota ledger, derived from the request.
 *
 * The anonymous cookie is preferred because it survives an IP change; the
 * client IP is the fallback. No cookie is created here — handing out an
 * identifier must not be a side effect of asking for a budget check.
 */
export function sessionIdFromRequest(request: Request): string {
  const cookie = request.headers.get('cookie') ?? ''
  const match = /(?:^|;\s*)needledrop_anon=([^;]+)/.exec(cookie)
  if (match?.[1]) return `anon:${match[1]}`

  const forwarded = request.headers.get('x-forwarded-for')
  const ip = forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown'
  return `ip:${ip}`
}
