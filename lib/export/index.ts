/**
 * Export facade (PLAN §13.9 "Output · Export", §27.2).
 *
 * One entry point maps a format to a rendered file, the content type the
 * browser needs and a filename that survives every filesystem. The parsers
 * below are deliberately tolerant: the same endpoint has to serve a client
 * that posts the full track objects it got from `/api/discover` and one that
 * posts nothing but a list of video ids.
 */

import type { Track } from '@/lib/youtube/types'

import { toCsv } from './csv'
import { toJson, type ExportMeta, type JsonExport, type JsonTrack } from './json'
import { toM3u } from './m3u'
import { toClipboardText, toText } from './text'

/** The formats a playlist can be exported as (PLAN §13.9, §27.2). */
export type ExportFormat = 'm3u' | 'csv' | 'json' | 'text'

export type RenderedExport = {
  /** The file body — never JSON-wrapped, so it can be written as-is. */
  body: string
  contentType: string
  filename: string
}

/** The content type each format must be served with. */
const CONTENT_TYPES: Record<ExportFormat, string> = {
  m3u: 'audio/x-mpegurl',
  csv: 'text/csv; charset=utf-8',
  json: 'application/json; charset=utf-8',
  text: 'text/plain; charset=utf-8',
}

/** The extension each format is downloaded with. */
const EXTENSIONS: Record<ExportFormat, string> = {
  m3u: 'm3u',
  csv: 'csv',
  json: 'json',
  text: 'txt',
}

export { toClipboardText, toCsv, toJson, toM3u, toText }
export type { ExportMeta, JsonExport, JsonTrack }

/**
 * Renders a track list in the requested format and names the file.
 *
 * The filename carries the playlist slug and the track count, so a user with
 * a dozen exports can tell them apart in the downloads folder.
 */
export function renderExport(
  format: ExportFormat,
  tracks: Track[],
  meta?: ExportMeta,
): RenderedExport {
  const body = renderBody(format, tracks, meta)
  const slug = slugifyFilename(meta?.title ?? '')

  return {
    body,
    contentType: CONTENT_TYPES[format],
    filename: `${slug}-${tracks.length}-tracks.${EXTENSIONS[format]}`,
  }
}

function renderBody(format: ExportFormat, tracks: Track[], meta?: ExportMeta): string {
  switch (format) {
    case 'm3u':
      return toM3u(tracks)
    case 'csv':
      return toCsv(tracks)
    case 'json':
      return toJson(tracks, meta)
    case 'text':
      return toText(tracks, meta)
  }
}

/**
 * A filesystem-safe slug: lowercase, dash-separated, no spaces, no path
 * separators.
 *
 * A download named `../../etc/passwd` must never escape the download folder,
 * so everything outside `[a-z0-9]` becomes a dash.
 */
export function slugifyFilename(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')

  return slug || 'playlist'
}

/**
 * Tolerant parser for the incoming track list.
 *
 * It accepts either full track objects (what `/api/discover` returns) or a
 * bare list of video ids (what a hand-picked list looks like), and always
 * returns complete `Track` objects so every renderer sees the same shape.
 * Entries that carry no usable id are dropped rather than rendered as
 * broken lines.
 */
export function parseTracksInput(input: unknown): Track[] {
  const items = toItems(input)
  const tracks: Track[] = []

  for (const item of items) {
    const track = toTrack(item)
    if (track) tracks.push(track)
  }

  return tracks
}

/** Unwraps the shapes a client may send. */
function toItems(input: unknown): unknown[] {
  if (Array.isArray(input)) return input
  if (isRecord(input) && Array.isArray(input.tracks)) return input.tracks
  if (isRecord(input) || typeof input === 'string') return [input]
  return []
}

/** Builds a full track from one client-supplied entry, or null if unusable. */
function toTrack(item: unknown): Track | null {
  if (typeof item === 'string') {
    const videoId = item.trim()
    return videoId ? defaultTrack(videoId) : null
  }

  if (!isRecord(item)) return null

  const videoId = readString(item.videoId) || readString(item.id) || readString(item.video_id)
  if (!videoId) return null

  const track: Track = {
    ...defaultTrack(videoId),
    title: readString(item.title) || 'Unknown title',
    artist: readString(item.artist) || 'Unknown artist',
    channelTitle: readString(item.channelTitle),
    durationSec: readNumber(item.durationSec),
    thumbnail: readString(item.thumbnail),
    topicId: readString(item.topicId),
    topicName: readString(item.topicName),
    viewCount: readNumber(item.viewCount),
    publishedAt: readString(item.publishedAt),
    categoryId: readString(item.categoryId),
  }

  const trackKey = readString(item.trackKey)
  if (trackKey) track.trackKey = trackKey

  const featureArtist = readString(item.featureArtist)
  if (featureArtist) track.featureArtist = featureArtist

  if (Array.isArray(item.topicCategories)) {
    track.topicCategories = item.topicCategories.filter(
      (value): value is string => typeof value === 'string',
    )
  }

  const language = readString(item.language)
  if (language) track.language = language

  const license = readString(item.license)
  if (license) track.license = license

  if (typeof item.likeCount === 'number' && Number.isFinite(item.likeCount)) {
    track.likeCount = item.likeCount
  }

  if (typeof item.madeForKids === 'boolean') track.madeForKids = item.madeForKids
  if (typeof item.embeddable === 'boolean') track.embeddable = item.embeddable

  if (Array.isArray(item.availableCountries)) {
    track.availableCountries = item.availableCountries.filter(
      (value): value is string => typeof value === 'string',
    )
  }

  return track
}

/** The shape a bare video id expands to. */
function defaultTrack(videoId: string): Track {
  return {
    videoId,
    title: 'Unknown title',
    artist: 'Unknown artist',
    channelTitle: '',
    durationSec: 0,
    thumbnail: '',
    topicId: '',
    topicName: '',
    viewCount: 0,
    publishedAt: '',
    categoryId: '',
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Numeric strings are accepted because hand-written clients send them. */
function readNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}
