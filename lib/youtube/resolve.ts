import { buildSeedProfile } from '@/lib/seed/centroid'

import { hasLiveApi, youtubeFetch, type QuotaMeter } from './client'
import { DEMO_TRACKS } from './demo'
import { channelArtistName, parseChannelName } from './artist'
import {
  channelById,
  demoSearch,
  resolveChannel,
  searchByChannelId,
  searchSeeds,
  videosByIds,
  type ResolvedChannel,
} from './search'
import type { SeedKind, SeedProfile, Track } from './types'

/**
 * Seed resolution (PLAN §4 stage 1–2, §13.2).
 *
 * A seed is a *profile*, not a single track: a pasted playlist becomes a
 * centroid of up to 50 reference tracks, a pasted video becomes a centroid of
 * one. This module turns whatever the user pasted — a link, an artist, a few
 * words — into that profile plus the ranked candidates it was built from.
 */

/** How the seed was entered, independent of what it resolved to. */
export type SeedSource = 'video' | 'playlist' | 'artist' | 'text'

export type SeedResolution = {
  /** The kind of the centroid that was built. */
  kind: SeedKind
  /** A human label for the resolved seed. */
  label: string
  centroid: SeedProfile | null
  /** The tracks the centroid was built from, best first. */
  candidates: Track[]
  source: SeedSource
}

export type SeedInputKind = 'video' | 'playlist' | 'artist' | 'text'

export type SeedInputClassification = {
  kind: SeedInputKind
  videoId?: string
  playlistId?: string
  channelId?: string
  query?: string
}

/* ── URL parsing ─────────────────────────────────────────────────────────── */

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const PLAYLIST_ID = /^(?:PL|UU|LL|RD|OLAK5uy_)[A-Za-z0-9_-]{8,}$/
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{20,}$/

/**
 * Pull the 11-character id out of any YouTube video link.
 *
 * People paste every shape of link there is — watch, short, live, embed,
 * `youtu.be` — and a broken seed is the single most common way a resolver
 * fails, so all of them are accepted and extra query parameters are ignored.
 */
export function parseVideoId(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  if (!looksLikeUrl(trimmed)) {
    return VIDEO_ID.test(trimmed) ? trimmed : null
  }

  const url = toUrl(trimmed)
  if (!url) return null

  const host = url.hostname.toLowerCase().replace(/^www\./, '')

  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0]
    return id && VIDEO_ID.test(id) ? id : null
  }

  if (!isYouTubeHost(host)) return null

  const fromQuery = url.searchParams.get('v')
  if (fromQuery && VIDEO_ID.test(fromQuery)) return fromQuery

  const segments = url.pathname.split('/').filter(Boolean)
  const [first, second] = segments
  if (first && second && ['shorts', 'live', 'embed', 'v'].includes(first) && VIDEO_ID.test(second)) {
    return second
  }

  return null
}

/**
 * Pull the playlist id out of a playlist link.
 *
 * Playlist links are the seed shape that unlocks the biggest quality jump —
 * a whole playlist becomes a centroid — so the id is worth recognising even
 * from a bare `PL…` string.
 */
export function parsePlaylistId(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  if (!looksLikeUrl(trimmed)) {
    return PLAYLIST_ID.test(trimmed) ? trimmed : null
  }

  const url = toUrl(trimmed)
  if (!url) return null

  const list = url.searchParams.get('list')
  return list && PLAYLIST_ID.test(list) ? list : null
}

/**
 * Pull the channel id out of a channel link.
 *
 * Only `UC…` ids are recognised: a handle (`/@someone`) cannot be resolved
 * without an extra lookup, so it is left to the free-text path.
 */
export function parseChannelId(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  if (!looksLikeUrl(trimmed)) {
    return CHANNEL_ID.test(trimmed) ? trimmed : null
  }

  const url = toUrl(trimmed)
  if (!url) return null

  const segments = url.pathname.split('/').filter(Boolean)
  const index = segments.indexOf('channel')
  const candidate = index >= 0 ? segments[index + 1] : undefined
  return candidate && CHANNEL_ID.test(candidate) ? candidate : null
}

/**
 * Decide what the user actually pasted.
 *
 * A watch link often carries a playlist id as well, so the video wins; a
 * channel link is an artist seed; everything else is free text.
 */
export function classifySeedInput(input: string): SeedInputClassification {
  const trimmed = input.trim()
  if (!trimmed) return { kind: 'text', query: '' }

  const videoId = parseVideoId(trimmed)
  if (videoId) return { kind: 'video', videoId }

  const playlistId = parsePlaylistId(trimmed)
  if (playlistId) return { kind: 'playlist', playlistId }

  const channelId = parseChannelId(trimmed)
  if (channelId) return { kind: 'artist', channelId }

  return { kind: 'text', query: trimmed }
}

/* ── ranking ─────────────────────────────────────────────────────────────── */

const TOKEN = /[\p{L}\p{N}]+/gu

/** Words that carry no signal when matching a title. */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'of', 'in', 'on', 'and', 'to', 'for', 'by', 'or', 'my', 'me',
  'with', 'vs', 'feat', 'ft', 'at', 'is', 'as', 'from', 'that', 'this', 'it',
])

/**
 * How official a channel looks (PLAN §4 stage 1).
 *
 * The order matters: an auto-generated `- Topic` channel is YouTube's own
 * artist entity and therefore the most trustworthy source, VEVO is the
 * artist's own label, and "Official" / "Records" / "Music" are weaker hints.
 * The channel grammar itself is owned by `lib/youtube/artist.ts` so the
 * ranking and the scoring engine always agree on what "official" means.
 */
export function officialChannelScore(channelTitle: string): number {
  switch (parseChannelName(channelTitle).kind) {
    case 'topic':
      return 4
    case 'vevo':
      return 3
    case 'official':
      return 2
    case 'label':
      return 1
    default:
      return 0
  }
}

/** Tokens of the query, minus the words that would match anything. */
function tokenize(query: string): string[] {
  return (query.toLowerCase().match(TOKEN) ?? []).filter(
    (token) => token.length >= 2 && !STOP_WORDS.has(token),
  )
}

/** How many of the query's tokens the track actually carries. */
function tokenMatchCount(track: Track, tokens: string[]): number {
  if (tokens.length === 0) return 0
  const haystack = `${track.title} ${track.artist} ${track.channelTitle}`.toLowerCase()
  return tokens.reduce((count, token) => (haystack.includes(token) ? count + 1 : count), 0)
}

/** Whether the title has the shape of a real track rather than a live upload. */
function musicShapeScore(track: Track): number {
  const title = track.title
  let score = 0
  if (/\s[-–—]\s/.test(title)) score += 1
  if (/\bofficial\s+music\s+video\b/i.test(title) || /\bofficial\s+video\b/i.test(title)) score += 1
  if (/\bofficial\s+audio\b/i.test(title)) score += 1
  return score
}

/**
 * Rank the search hits for a seed (PLAN §4 stage 1).
 *
 * This is what makes the seed picker good: YouTube's own relevance order
 * puts uploads, covers and 40-minute mixes next to the real track, so the
 * hits are re-ranked by how *official* the channel is, how well the title
 * matches what was typed, whether the title looks like a released song, and
 * only then by popularity.
 */
export function rankSeedCandidates(candidates: Track[], query: string): Track[] {
  const tokens = tokenize(query)

  return candidates
    .map((track, index) => ({
      track,
      index,
      official: officialChannelScore(track.channelTitle),
      tokens: tokenMatchCount(track, tokens),
      shape: musicShapeScore(track),
      views: track.viewCount,
    }))
    .sort(
      (a, b) =>
        b.official - a.official ||
        b.tokens - a.tokens ||
        b.shape - a.shape ||
        b.views - a.views ||
        a.index - b.index,
    )
    .map((entry) => entry.track)
}

/* ── artist detection ────────────────────────────────────────────────────── */

/** Words that turn a name into a song description rather than an artist. */
const SONG_WORDS = new Set([
  'song', 'songs', 'music', 'video', 'videos', 'audio', 'official', 'lyric',
  'lyrics', 'live', 'remix', 'cover', 'theme', 'soundtrack', 'concert',
  'radio', 'playlist', 'instrumental', 'karaoke', 'nightcore', 'sped', 'slowed',
  'wallpaper', 'ringtone', 'visualizer', 'mix', 'hits', 'track',
])

/** Articles are tolerated only at the front ("The Weeknd"). */
const LEADING_ARTICLES = new Set(['the', 'a', 'an'])

/**
 * Guess whether free text names an artist.
 *
 * A song title and an artist name look the same ("Radiohead", "Hello"), so
 * the guess is deliberately conservative — it only fires on shapes that are
 * overwhelmingly artist-like, and the caller falls back to a free-text
 * search when the resolved channel does not actually match the name.
 */
export function looksLikeArtistName(input: string): boolean {
  const trimmed = input.trim()
  if (!trimmed || trimmed.length > 60) return false
  if (/["'“”‘’()[\]{}]/.test(trimmed)) return false
  if (/\s[-–—]\s/.test(trimmed)) return false

  const words = trimmed.split(/\s+/).filter(Boolean)
  if (words.length === 0 || words.length > 4) return false

  const lowered = words.map((word) => word.toLowerCase())
  if (lowered.some((word) => SONG_WORDS.has(word))) return false
  if (lowered.some((word) => /^\d+$/.test(word))) return false

  const meaningful = LEADING_ARTICLES.has(lowered[0]) ? lowered.slice(1) : lowered
  if (meaningful.length === 0 || meaningful.length > 3) return false
  if (meaningful.some((word) => STOP_WORDS.has(word))) return false
  if (!meaningful.every((word) => /^[\p{L}\p{M}][\p{L}\p{M}0-9'&.]*$/u.test(word))) return false
  if (!meaningful.some((word) => word.replace(/[^\p{L}]/gu, '').length >= 3)) return false

  return true
}

/** Does the channel we resolved actually look like the artist we asked for? */
function channelMatchesQuery(channelTitle: string, query: string): boolean {
  const channel = foldForMatch(channelTitle)
  const needle = foldForMatch(query)
  if (!needle) return false
  if (channel === needle || channel.startsWith(needle)) return true

  const tokens = tokenize(query)
  if (tokens.length === 0) return channel.includes(needle)
  return tokens.every((token) => channel.includes(foldForMatch(token)))
}

function foldForMatch(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '')
}

/** `Radiohead - Topic` → `Radiohead`, `TheWeekndVEVO` → `The Weeknd`. */
function cleanChannelTitle(title: string): string {
  return channelArtistName(title) || title
}

/* ── centroid ────────────────────────────────────────────────────────────── */

/**
 * Build the seed profile from resolved tracks.
 *
 * The centroid itself belongs to the engine module — this wrapper only keeps
 * the resolver from reaching into another layer's internals, so the shape of
 * a `SeedProfile` is decided in exactly one place.
 */
export function buildCentroidFromTracks(
  tracks: Track[],
  kind: SeedProfile['kind'],
  label: string,
): SeedProfile {
  return buildSeedProfile(tracks, kind, label)
}

/* ── resolution ──────────────────────────────────────────────────────────── */

type PlaylistItemsResponse = {
  items?: Array<{
    contentDetails?: { videoId?: string }
    snippet?: { title?: string }
  }>
}

/**
 * Resolve any seed input into a profile plus the candidates behind it.
 *
 * The four shapes (a video, a playlist, an artist, free text) all end as a
 * `SeedProfile`, which is what the discovery engine consumes — the difference
 * only shows up in how much quota was spent and how many reference tracks the
 * centroid carries.
 */
export async function resolveSeed(input: string, meter: QuotaMeter): Promise<SeedResolution> {
  const classified = classifySeedInput(input)

  if (classified.kind === 'video' && classified.videoId) {
    return resolveVideoSeed(classified.videoId, meter)
  }
  if (classified.kind === 'playlist' && classified.playlistId) {
    return resolvePlaylistSeed(classified.playlistId, meter)
  }
  if (classified.kind === 'artist' && classified.channelId) {
    return resolveArtistByChannelId(classified.channelId, meter)
  }

  const query = (classified.query ?? '').trim()
  if (!query) {
    return { kind: 'video', label: '', centroid: null, candidates: [], source: 'text' }
  }

  if (looksLikeArtistName(query)) {
    const artist = await resolveArtistByName(query, meter)
    if (artist) return artist
  }

  return resolveTextSeed(query, meter)
}

/** A pasted video is the cheapest possible seed: one `videos.list` call. */
async function resolveVideoSeed(videoId: string, meter: QuotaMeter): Promise<SeedResolution> {
  const tracks = hasLiveApi()
    ? await videosByIds([videoId], meter)
    : DEMO_TRACKS.filter((track) => track.videoId === videoId)
  const track = tracks[0]
  if (!track) {
    return { kind: 'video', label: videoId, centroid: null, candidates: [], source: 'video' }
  }

  const label = track.title
  return {
    kind: 'video',
    label,
    centroid: buildCentroidFromTracks([track], 'video', label),
    candidates: [track],
    source: 'video',
  }
}

/**
 * A pasted playlist is the richest seed: its items become the centroid.
 *
 * The playlist title is not fetched — `playlistItems.list` does not carry it
 * and an extra call is not worth it — so the label is derived from the items
 * themselves.
 */
async function resolvePlaylistSeed(playlistId: string, meter: QuotaMeter): Promise<SeedResolution> {
  let tracks: Track[]

  if (hasLiveApi()) {
    const items = await youtubeFetch<PlaylistItemsResponse>(
      'playlistItems.list',
      { part: 'snippet,contentDetails', playlistId, maxResults: 50 },
      meter,
    )
    const ids = (items.items ?? [])
      .map((item) => item.contentDetails?.videoId)
      .filter((id): id is string => Boolean(id))
    tracks = await videosByIds(ids, meter)
  } else {
    tracks = demoPlaylistTracks(playlistId)
  }

  const label = playlistLabel(tracks)
  return {
    kind: 'playlist',
    label,
    centroid: tracks.length > 0 ? buildCentroidFromTracks(tracks, 'playlist', label) : null,
    candidates: tracks,
    source: 'playlist',
  }
}

/**
 * An artist becomes a centroid of that artist's own uploads.
 *
 * Two `search.list` calls are needed: the first turns a name into a channel
 * (preferring the auto-generated `- Topic` one), the second lists that
 * channel's music.
 */
async function resolveArtistByName(query: string, meter: QuotaMeter): Promise<SeedResolution | null> {
  const channel = await resolveChannel(query, meter)
  if (!channel) return null
  if (!channelMatchesQuery(channel.title, query)) return null
  return resolveArtistFromChannel(channel, meter)
}

/** A pasted channel URL already names the channel, so only the title is missing. */
async function resolveArtistByChannelId(channelId: string, meter: QuotaMeter): Promise<SeedResolution> {
  const channel = await channelById(channelId, meter)
  const tracks = await searchByChannelId(channelId, meter)
  if (tracks.length === 0) {
    return {
      kind: 'artist',
      label: channel ? cleanChannelTitle(channel.title) : channelId,
      centroid: null,
      candidates: [],
      source: 'artist',
    }
  }

  const label = channel ? cleanChannelTitle(channel.title) : tracks[0].artist
  return {
    kind: 'artist',
    label,
    centroid: buildCentroidFromTracks(tracks, 'artist', label),
    candidates: tracks,
    source: 'artist',
  }
}

async function resolveArtistFromChannel(
  channel: ResolvedChannel,
  meter: QuotaMeter,
): Promise<SeedResolution | null> {
  const tracks = await searchByChannelId(channel.id, meter)
  if (tracks.length === 0) return null

  const label = cleanChannelTitle(channel.title)
  return {
    kind: 'artist',
    label,
    centroid: buildCentroidFromTracks(tracks, 'artist', label),
    candidates: tracks,
    source: 'artist',
  }
}

/**
 * Free text is the seed people type most often.
 *
 * The search hits become the candidates and the best-ranked one becomes the
 * single-track centroid the engine works from.
 */
async function resolveTextSeed(query: string, meter: QuotaMeter): Promise<SeedResolution> {
  const hits = hasLiveApi() ? await searchSeeds(query, meter) : demoSearch(query)
  const ranked = rankSeedCandidates(hits, query)
  const top = ranked[0]

  return {
    kind: 'video',
    label: query,
    centroid: top ? buildCentroidFromTracks([top], 'video', top.title) : null,
    candidates: ranked,
    source: 'text',
  }
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

/** A playlist has no title here, so the label comes from its dominant artist. */
function playlistLabel(tracks: Track[]): string {
  if (tracks.length === 0) return 'Playlist'

  const counts = new Map<string, number>()
  for (const track of tracks) {
    const artist = track.artist.trim()
    if (!artist) continue
    counts.set(artist, (counts.get(artist) ?? 0) + 1)
  }

  const [topArtist, topCount] = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )[0] ?? ['', 0]

  if (topArtist && topCount / tracks.length >= 0.6) {
    return `${topArtist} · ${tracks.length} tracks`
  }
  return `Playlist · ${tracks.length} tracks`
}

/**
 * The demo catalogue has no playlists.
 *
 * A pasted playlist id deterministically selects a slice of the catalogue so
 * the flow is exercisable end to end without credentials.
 */
function demoPlaylistTracks(playlistId: string): Track[] {
  const music = DEMO_TRACKS.filter((track) => track.categoryId === '10')
  if (music.length === 0) return []

  const size = Math.min(12, music.length)
  const start = hashString(playlistId) % music.length
  const tracks: Track[] = []
  for (let index = 0; index < size; index++) {
    tracks.push(music[(start + index) % music.length])
  }
  return tracks
}

function hashString(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index++) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash)
}

function looksLikeUrl(input: string): boolean {
  return (
    /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ||
    /^www\./i.test(input) ||
    /^youtu\.be\//i.test(input)
  )
}

function toUrl(input: string): URL | null {
  try {
    return new URL(/^https?:\/\//i.test(input) ? input : `https://${input.replace(/^\/+/, '')}`)
  } catch {
    return null
  }
}

function isYouTubeHost(host: string): boolean {
  return host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtube-nocookie.com'
}
