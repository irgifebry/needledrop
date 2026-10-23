/**
 * Playlist lifecycle operations (PLAN §13.4, §13.5).
 *
 * Everything in this module mutates the user's *own* YouTube account, so
 * every function needs an OAuth access token — the shared API key is not
 * enough. Every call is also charged to the project quota, which is why the
 * `QuotaMeter` is a required argument: the ledger has to stay honest even
 * when a request fails halfway through.
 *
 * The module is I/O-only through `youtubeFetch`; it has no `next/*` imports
 * and no server-only dependency, so it can be imported from a route handler
 * or unit-tested with a fake meter.
 */

import { AppError } from '@/lib/http/errors'

import {
  isQuotaError,
  parseIsoDuration,
  youtubeFetch,
  YouTubeError,
  type QuotaMeter,
} from './client'
import {
  appendLineage,
  extractLineageMarker,
  hasLineage,
  parseLineage,
  stripLineage,
  type Lineage,
} from './lineage'
import { parseArtistTitle, trackKeyOf } from './normalize'
import type { PlaylistPrivacy } from './types'

/* ── bounds ─────────────────────────────────────────────────────────────── */

/** Most items a single `playlistItems.list` page can return. */
const MAX_PAGE_SIZE = 50

/** How many of the user's playlists the duplicate index may look at. */
export const DEFAULT_MAX_SCANNED_PLAYLISTS = 20

/** How many playlist items the duplicate index may look at. */
export const DEFAULT_MAX_SCANNED_ITEMS = 500

/** Hard ceiling on the items a single lifecycle call will page through. */
const DEFAULT_MAX_PAGED_ITEMS = 500

/* ── raw Data API shapes ────────────────────────────────────────────────── */

type RawThumbnail = { url?: string; width?: number; height?: number }

type RawThumbnails = Record<string, RawThumbnail | undefined>

type RawPlaylist = {
  id?: string
  snippet?: {
    title?: string
    description?: string
    tags?: string[]
    publishedAt?: string
    thumbnails?: RawThumbnails
  }
  contentDetails?: { itemCount?: number }
  status?: { privacyStatus?: string }
}

type RawPlaylistItem = {
  id?: string
  snippet?: {
    title?: string
    videoId?: string
    position?: number
    channelTitle?: string
    videoOwnerChannelTitle?: string
    resourceId?: { kind?: string; videoId?: string }
    thumbnails?: RawThumbnails
  }
  contentDetails?: { videoId?: string; duration?: string }
}

type RawPlaylistList = { items?: RawPlaylist[]; nextPageToken?: string }

type RawItemList = { items?: RawPlaylistItem[]; nextPageToken?: string }

/* ── public shapes ──────────────────────────────────────────────────────── */

/** A playlist as the UI needs it. */
export type PlaylistSummary = {
  id: string
  title: string
  description: string
  tags?: string[]
  itemCount: number
  privacy: PlaylistPrivacy
  thumbnail?: string
  /** Parsed lineage marker — `null` for playlists the user made themselves. */
  lineage: Lineage | null
}

/** One entry of a playlist. */
export type PlaylistItemSummary = {
  id: string
  videoId: string
  /** Cleaned title, split from the artist the same way the engine does it. */
  title: string
  /** Cleaned artist name. */
  artist: string
  /** The title exactly as YouTube stores it. */
  rawTitle: string
  /** The channel the track was uploaded by. */
  channelTitle: string
  position: number
  durationSec: number
  thumbnail?: string
}

/** Fields a caller may change on an existing playlist. */
export type PlaylistPatch = {
  title?: string
  description?: string
  tags?: string[]
  privacy?: PlaylistPrivacy
}

/** What {@link updatePlaylist} and {@link duplicatePlaylist} accept. */
export type DuplicatePlaylistOptions = {
  title?: string
  description?: string
  privacy?: PlaylistPrivacy
}

/** Result of copying a playlist. */
export type DuplicatePlaylistResult = {
  playlistId: string
  playlistUrl: string
  title: string
  /** How many tracks actually made it into the copy. */
  itemCount: number
  /** Tracks that could not be copied. */
  failed: Array<{ videoId: string; reason: string }>
}

/** Result of a reorder: what moved and what did not. */
export type ReorderResult = {
  /** Items that were actually moved — each one cost 50 quota units. */
  moved: number
  /** Items that could not be moved. */
  failed: Array<{ videoId: string; reason: string }>
}

/** The library-wide "which tracks do I already have" index. */
export type DuplicateIndex = {
  /** Canonical `artist::title` keys of everything the user already has. */
  trackKeys: Set<string>
  scannedPlaylists: number
  scannedItems: number
  maxPlaylists: number
  maxItems: number
  /** True when the scan hit a bound and did not see everything. */
  truncated: boolean
}

/* ── error mapping ──────────────────────────────────────────────────────── */

const NOT_FOUND_REASONS = new Set([
  'playlistNotFound',
  'playlistItemNotFound',
  'playlistItemsNotFound',
  'videoNotFound',
  'channelNotFound',
])

const INVALID_REASONS = new Set([
  'invalidPlaylistId',
  'invalidParameter',
  'invalidValue',
  'invalidId',
  'invalidRequest',
  'invalidSnippet',
  'invalidVideoId',
  'badRequest',
])

const FORBIDDEN_REASONS = new Set([
  'forbidden',
  'insufficientPermissions',
  'youtubeSignupRequired',
  'dailyLimitExceededReadOnly',
])

/**
 * Turns a Data API failure into one of the app's stable error codes.
 *
 * The Data API answers with a machine-readable `reason` next to the HTTP
 * status, and the reason is far more precise than the status: a
 * `playlistNotFound` is a 404, while a 403 with the same body can mean "your
 * token cannot do this" (forbidden) or "your token is stale" (unauthorized).
 */
export function mapUpstreamError(error: unknown): AppError {
  if (error instanceof AppError) return error

  if (!(error instanceof YouTubeError)) {
    return new AppError('upstream_error', 'The YouTube API request failed.', 502)
  }

  const reason = error.code

  if (isQuotaError(error)) {
    return new AppError('quota_exceeded', error.message, 429)
  }
  if (NOT_FOUND_REASONS.has(reason)) {
    return new AppError('not_found', error.message, 404)
  }
  if (INVALID_REASONS.has(reason)) {
    return new AppError('invalid_request', error.message, 400)
  }
  if (FORBIDDEN_REASONS.has(reason)) {
    return new AppError('forbidden', error.message, 403)
  }

  if (error.status === 401) return new AppError('unauthorized', error.message, 401)
  if (error.status === 403) return new AppError('forbidden', error.message, 403)
  if (error.status === 404) return new AppError('not_found', error.message, 404)
  if (error.status === 429) return new AppError('rate_limited', error.message, 429)

  return new AppError('upstream_error', error.message, 502)
}

/** Runs an API call and normalises its failure into an `AppError`. */
async function apiCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (error) {
    throw mapUpstreamError(error)
  }
}

/* ── small helpers ──────────────────────────────────────────────────────── */

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const rounded = Math.trunc(value)
  if (rounded < min) return min
  if (rounded > max) return max
  return rounded
}

export function isUsableThumbnail(url: string | undefined): url is string {
  if (!url) return false
  // YouTube answers "this playlist/video has no thumbnail" with a placeholder
  // URL that itself 404s (`i.ytimg.com/img/no_thumbnail.jpg`). Treating it as
  // a real thumbnail only produces a broken image, so drop it and let the
  // caller fall back to its honest "no thumbnail" state.
  return !/no_thumbnail/i.test(url)
}

export function pickThumbnail(thumbnails: RawThumbnails | undefined): string | undefined {
  if (!thumbnails) return undefined
  for (const size of ['medium', 'default', 'high', 'standard'] as const) {
    const url = thumbnails[size]?.url
    if (isUsableThumbnail(url)) return url
  }
  return undefined
}

function toPrivacy(value: string | undefined): PlaylistPrivacy {
  if (value === 'public' || value === 'unlisted') return value
  // `private` is the app-wide default (PLAN §19.1 decision 3), so an unknown
  // value is treated as the safest option rather than leaking a playlist.
  return 'private'
}

function toSummary(raw: RawPlaylist): PlaylistSummary {
  const description = raw.snippet?.description ?? ''
  return {
    id: raw.id ?? '',
    title: raw.snippet?.title ?? 'Untitled playlist',
    description,
    tags: raw.snippet?.tags ?? [],
    itemCount: raw.contentDetails?.itemCount ?? 0,
    privacy: toPrivacy(raw.status?.privacyStatus),
    thumbnail: pickThumbnail(raw.snippet?.thumbnails),
    lineage: hasLineage(description) ? parseLineage(description) : null,
  }
}

function toItemSummary(raw: RawPlaylistItem): PlaylistItemSummary {
  const snippet = raw.snippet ?? {}
  const rawTitle = snippet.title ?? ''
  // `videoOwnerChannelTitle` is the artist's own channel; `channelTitle` is
  // whatever channel published the video. The former is the better artist.
  const channelTitle = snippet.videoOwnerChannelTitle ?? snippet.channelTitle ?? ''
  const { artist, title } = parseArtistTitle(rawTitle, channelTitle)

  return {
    id: raw.id ?? '',
    videoId: snippet.videoId ?? snippet.resourceId?.videoId ?? raw.contentDetails?.videoId ?? '',
    title,
    artist,
    rawTitle,
    channelTitle,
    position: snippet.position ?? 0,
    durationSec: parseIsoDuration(raw.contentDetails?.duration),
    thumbnail: pickThumbnail(snippet.thumbnails),
  }
}

function reasonOf(error: unknown): string {
  if (error instanceof AppError) return error.message
  if (error instanceof YouTubeError) return error.message
  return error instanceof Error ? error.message : 'unknown error'
}

/* ── playlists ──────────────────────────────────────────────────────────── */

/**
 * Lists the user's own playlists (PLAN §13.5 "My Playlists").
 *
 * Costs 1 quota unit per page. Needs the `youtube.readonly` scope; without
 * it the API answers 403, which {@link mapUpstreamError} turns into
 * `forbidden`.
 */
export async function listUserPlaylists(
  accessToken: string,
  meter: QuotaMeter,
  options: { maxResults?: number; pageToken?: string } = {},
): Promise<{ playlists: PlaylistSummary[]; nextPageToken?: string }> {
  const maxResults = clampInt(options.maxResults, 1, MAX_PAGE_SIZE, MAX_PAGE_SIZE)

  const response = await apiCall(() =>
    youtubeFetch<RawPlaylistList>(
      'playlists.list',
      {
        part: 'snippet,contentDetails,status',
        mine: true,
        maxResults,
        pageToken: options.pageToken,
      },
      meter,
      { accessToken },
    ),
  )

  return {
    playlists: (response.items ?? []).map(toSummary),
    nextPageToken: response.nextPageToken,
  }
}

/**
 * Reads a single playlist.
 *
 * Returns `null` when the playlist does not exist or is not visible to this
 * account — the caller decides whether that is a 404 or a soft miss.
 * Costs 1 quota unit.
 */
export async function getPlaylist(
  accessToken: string,
  playlistId: string,
  meter: QuotaMeter,
): Promise<PlaylistSummary | null> {
  const response = await apiCall(() =>
    youtubeFetch<RawPlaylistList>(
      'playlists.list',
      { part: 'snippet,contentDetails,status', id: playlistId, maxResults: 1 },
      meter,
      { accessToken },
    ),
  )

  const raw = response.items?.[0]
  return raw ? toSummary(raw) : null
}

/**
 * Renames, re-describes, re-tags or re-privates a playlist.
 *
 * The lineage marker is deliberately preserved: a user editing the title of a
 * generated playlist must not accidentally turn it into "one of mine". The
 * marker is stripped from whatever description arrives and re-appended, so an
 * edit that carries the marker round-trips untouched and an edit that drops it
 * still keeps the playlist recognisable.
 *
 * Costs 50 units for the update plus 1 unit for the read that makes the
 * marker (and the item count) survive.
 */
export async function updatePlaylist(
  accessToken: string,
  playlistId: string,
  patch: PlaylistPatch,
  meter: QuotaMeter,
): Promise<PlaylistSummary> {
  const current = await getPlaylist(accessToken, playlistId, meter)
  if (!current) {
    throw new AppError('not_found', 'That playlist no longer exists.', 404)
  }

  // playlists.update replaces the selected snippet resource. Include the
  // existing tags when the caller edits other metadata only.
  const snippet: Record<string, unknown> = { tags: patch.tags ?? current.tags }

  if (patch.title !== undefined) snippet.title = patch.title

  if (patch.description !== undefined) {
    const base = stripLineage(patch.description)
    const marker =
      extractLineageMarker(patch.description) ?? extractLineageMarker(current.description)
    snippet.description = marker ? appendLineage(base, marker) : base
  }

  if (patch.tags !== undefined) snippet.tags = patch.tags

  const body: Record<string, unknown> = { snippet }
  if (patch.privacy !== undefined) body.status = { privacyStatus: patch.privacy }

  const updated = await apiCall(() =>
    youtubeFetch<RawPlaylist>(
      'playlists.update',
      // The playlist is addressed by the query string; the body only carries
      // the parts that change.
      { part: 'snippet,status', id: playlistId },
      meter,
      { method: 'PUT', accessToken, body: JSON.stringify(body) },
    ),
  )

  const summary = toSummary(updated)

  return {
    ...summary,
    id: summary.id || playlistId,
    // `playlists.update` cannot return `contentDetails`, so the count read
    // before the update is the only one available.
    itemCount: current.itemCount,
  }
}

/**
 * Deletes a playlist and everything in it.
 *
 * Costs 50 units. There is no undo on YouTube's side, which is why the route
 * layer demands an explicit confirmation.
 */
export async function deletePlaylist(
  accessToken: string,
  playlistId: string,
  meter: QuotaMeter,
): Promise<void> {
  await apiCall(() =>
    youtubeFetch<void>('playlists.delete', { id: playlistId }, meter, {
      method: 'DELETE',
      accessToken,
    }),
  )
}

/* ── playlist items ─────────────────────────────────────────────────────── */

/**
 * Lists the entries of a playlist.
 *
 * Costs 1 unit per page of 50 items.
 */
export async function listPlaylistItems(
  accessToken: string,
  playlistId: string,
  meter: QuotaMeter,
  options: { maxResults?: number; pageToken?: string } = {},
): Promise<{ items: PlaylistItemSummary[]; nextPageToken?: string }> {
  const maxResults = clampInt(options.maxResults, 1, MAX_PAGE_SIZE, MAX_PAGE_SIZE)

  const response = await apiCall(() =>
    youtubeFetch<RawItemList>(
      'playlistItems.list',
      { part: 'snippet,contentDetails', playlistId, maxResults, pageToken: options.pageToken },
      meter,
      { accessToken },
    ),
  )

  return {
    items: (response.items ?? []).map(toItemSummary),
    nextPageToken: response.nextPageToken,
  }
}

/**
 * Pages through every entry of a playlist, up to a hard cap.
 *
 * The cap exists because a playlist can hold 5 000 tracks and each page costs
 * a unit; the caller is told where the list stops.
 *
 * Costs 1 unit per page of 50 items.
 */
export async function listAllPlaylistItems(
  accessToken: string,
  playlistId: string,
  meter: QuotaMeter,
  maxItems = DEFAULT_MAX_PAGED_ITEMS,
): Promise<{ items: PlaylistItemSummary[]; truncated: boolean }> {
  const items: PlaylistItemSummary[] = []
  let pageToken: string | undefined
  let truncated = false

  do {
    const page = await listPlaylistItems(accessToken, playlistId, meter, {
      maxResults: MAX_PAGE_SIZE,
      pageToken,
    })
    items.push(...page.items)
    pageToken = page.nextPageToken
    if (items.length >= maxItems) {
      truncated = Boolean(pageToken)
      break
    }
  } while (pageToken)

  return { items: items.slice(0, maxItems), truncated }
}

/**
 * Removes one entry from a playlist.
 *
 * Costs 50 units. `playlistItems.delete` only needs the item id.
 */
export async function removePlaylistItem(
  accessToken: string,
  itemId: string,
  meter: QuotaMeter,
): Promise<void> {
  await apiCall(() =>
    youtubeFetch<void>('playlistItems.delete', { id: itemId }, meter, {
      method: 'DELETE',
      accessToken,
    }),
  )
}

/**
 * Moves one entry to a new position.
 *
 * `playlistItems.update` insists on `snippet.playlistId` and
 * `snippet.resourceId`, so the caller has to hand both over — an item id
 * alone cannot address a playlist.
 *
 * Costs 50 units.
 */
export async function movePlaylistItem(
  accessToken: string,
  itemId: string,
  newPosition: number,
  meter: QuotaMeter,
  context?: { playlistId: string; videoId: string },
): Promise<void> {
  if (!context?.playlistId || !context.videoId) {
    throw new AppError(
      'invalid_request',
      'Moving a playlist item needs the playlist id and the video id.',
      400,
    )
  }

  await apiCall(() =>
    youtubeFetch<RawPlaylistItem>(
      'playlistItems.update',
      { part: 'snippet', id: itemId },
      meter,
      {
        method: 'PUT',
        accessToken,
        body: JSON.stringify({
          snippet: {
            playlistId: context.playlistId,
            position: Math.max(0, Math.trunc(newPosition)),
            resourceId: { kind: 'youtube#video', videoId: context.videoId },
          },
        }),
      },
    ),
  )
}

/**
 * Applies a whole new order to a playlist.
 *
 * `playlistItems.update` can only move one item at a time, so the new order
 * is applied from the end backwards: placing an item never shifts the items
 * that are already in place behind it. Items that are not mentioned in
 * `orderedVideoIds` keep their relative order and end up after the ones that
 * were named, so a partial order is a safe request too.
 *
 * Only the items that actually change position are moved, which is what
 * keeps a drag & drop of one track at 50 units instead of 50 × n.
 *
 * Costs 1 unit per page read plus 50 units per moved item.
 */
export async function reorderPlaylistItems(
  accessToken: string,
  playlistId: string,
  orderedVideoIds: string[],
  meter: QuotaMeter,
): Promise<ReorderResult> {
  const current = await listAllPlaylistItems(accessToken, playlistId, meter)

  const byVideoId = new Map<string, PlaylistItemSummary>()
  for (const item of current.items) {
    if (item.videoId && !byVideoId.has(item.videoId)) byVideoId.set(item.videoId, item)
  }

  const failed: Array<{ videoId: string; reason: string }> = []
  const desired: PlaylistItemSummary[] = []
  const seen = new Set<string>()

  for (const videoId of orderedVideoIds) {
    const item = byVideoId.get(videoId)
    if (!item) {
      failed.push({ videoId, reason: 'This track is not in the playlist.' })
      continue
    }
    if (seen.has(videoId)) continue
    seen.add(videoId)
    desired.push(item)
  }

  for (const item of current.items) {
    if (seen.has(item.videoId)) continue
    seen.add(item.videoId)
    desired.push(item)
  }

  // The live order, simulated so that items which are already in place can be
  // skipped instead of costing 50 units each.
  const live = current.items.map((item) => item.id)
  let moved = 0

  for (let index = desired.length - 1; index >= 0; index -= 1) {
    const target = desired[index]
    const at = live.indexOf(target.id)
    if (at === -1 || at === index) continue

    try {
      await movePlaylistItem(accessToken, target.id, index, meter, {
        playlistId,
        videoId: target.videoId,
      })
      moved += 1
      live.splice(at, 1)
      live.splice(index, 0, target.id)
    } catch (error) {
      failed.push({ videoId: target.videoId, reason: reasonOf(error) })
    }
  }

  return { moved, failed }
}

/**
 * Copies a playlist — "make one like this" (PLAN §13.5).
 *
 * The copy keeps the lineage marker of the original, so duplicating a
 * generated playlist produces a second generated playlist instead of an
 * orphan. Videos that cannot be copied (deleted, private, region-blocked)
 * are reported instead of failing the whole copy.
 *
 * Costs 50 units for the new playlist plus 50 units per copied track, plus
 * 1 unit per page read of the source.
 */
export async function duplicatePlaylist(
  accessToken: string,
  playlistId: string,
  meter: QuotaMeter,
  options: DuplicatePlaylistOptions = {},
): Promise<DuplicatePlaylistResult> {
  const source = await getPlaylist(accessToken, playlistId, meter)
  if (!source) {
    throw new AppError('not_found', 'That playlist no longer exists.', 404)
  }

  const sourceItems = await listAllPlaylistItems(accessToken, playlistId, meter)
  const title = options.title?.trim() || `${source.title} (copy)`
  const description = options.description ?? source.description

  const created = await apiCall(() =>
    youtubeFetch<RawPlaylist>(
      'playlists.insert',
      { part: 'snippet,status' },
      meter,
      {
        method: 'POST',
        accessToken,
        body: JSON.stringify({
          snippet: {
            title,
            description,
            tags: ['needledrop', 'generated-playlist'],
          },
          status: { privacyStatus: options.privacy ?? source.privacy },
        }),
      },
    ),
  )

  const newId = created.id ?? ''
  const failed: Array<{ videoId: string; reason: string }> = []
  let itemCount = 0

  for (const [index, item] of sourceItems.items.entries()) {
    if (!item.videoId) continue
    try {
      await apiCall(() =>
        youtubeFetch<RawPlaylistItem>(
          'playlistItems.insert',
          { part: 'snippet' },
          meter,
          {
            method: 'POST',
            accessToken,
            body: JSON.stringify({
              snippet: {
                playlistId: newId,
                resourceId: { kind: 'youtube#video', videoId: item.videoId },
                position: index,
              },
            }),
          },
        ),
      )
      itemCount += 1
    } catch (error) {
      failed.push({ videoId: item.videoId, reason: reasonOf(error) })
    }
  }

  return {
    playlistId: newId,
    playlistUrl: `https://music.youtube.com/playlist?list=${newId}`,
    title,
    itemCount,
    failed,
  }
}

/* ── library ────────────────────────────────────────────────────────────── */

/**
 * Builds the set of tracks the user already has (PLAN §13.5 "library-aware
 * dedupe").
 *
 * The scan is deliberately bounded: playlists and items are counted against
 * caps so a user with a hundred playlists cannot turn one UI click into a
 * quota disaster. The bounds and what was actually scanned travel with the
 * result, because "12 of these tracks" is only meaningful next to "out of
 * 40 playlists".
 *
 * Costs 1 unit for the playlist list plus 1 unit per page of 50 items read.
 */
export async function libraryDuplicateIndex(
  accessToken: string,
  meter: QuotaMeter,
  options: {
    maxPlaylists?: number
    maxItems?: number
    /** Reuse an already fetched playlist list instead of paying for it twice. */
    playlists?: PlaylistSummary[]
  } = {},
): Promise<DuplicateIndex> {
  const maxPlaylists = clampInt(
    options.maxPlaylists,
    1,
    MAX_PAGE_SIZE,
    DEFAULT_MAX_SCANNED_PLAYLISTS,
  )
  const maxItems = clampInt(options.maxItems, 1, 2_000, DEFAULT_MAX_SCANNED_ITEMS)

  const listed =
    options.playlists ??
    (await listUserPlaylists(accessToken, meter, { maxResults: maxPlaylists })).playlists

  const playlists = listed.slice(0, maxPlaylists)
  const trackKeys = new Set<string>()
  let scannedItems = 0
  let truncated = playlists.length < listed.length

  for (const playlist of playlists) {
    if (scannedItems >= maxItems) {
      truncated = true
      break
    }

    let pageToken: string | undefined
    do {
      const page = await listPlaylistItems(accessToken, playlist.id, meter, {
        maxResults: MAX_PAGE_SIZE,
        pageToken,
      })

      for (const item of page.items) {
        if (scannedItems >= maxItems) {
          truncated = true
          break
        }
        const key = trackKeyOf(item.artist, item.title)
        if (key) trackKeys.add(key)
        scannedItems += 1
      }

      pageToken = page.nextPageToken
      if (!pageToken && scannedItems >= maxItems) truncated = true
    } while (pageToken && scannedItems < maxItems)
  }

  return {
    trackKeys,
    scannedPlaylists: playlists.length,
    scannedItems,
    maxPlaylists,
    maxItems,
    truncated,
  }
}
