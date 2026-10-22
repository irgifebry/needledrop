/**
 * JSON manifest rendering (PLAN §13.9 "Output · Export", §27.2).
 *
 * The manifest is the machine-readable sibling of the playlist: it keeps the
 * ids, the canonical metadata and the topic label so another tool can rebuild
 * the list without re-querying YouTube. Pure: no I/O.
 */

import type { Track } from '@/lib/youtube/types'

/**
 * Metadata about the export itself.
 *
 * `generatedAt` is injectable rather than read from the clock inside the
 * renderer, so the output is deterministic in tests and a caller can restamp
 * a manifest it re-serves from cache.
 */
export type ExportMeta = {
  title?: string
  generatedAt?: string
  seed?: string
}

/** One track in the manifest — a flat projection of `Track`. */
export type JsonTrack = {
  videoId: string
  title: string
  artist: string
  channelTitle: string
  durationSec: number
  publishedAt: string
  url: string
  topicName: string
}

export type JsonExport = {
  /** Schema version of this manifest, bumped when the shape changes. */
  version: number
  generatedAt: string
  title: string
  seed?: string
  tracks: JsonTrack[]
}

const DEFAULT_TITLE = 'NeedleDrop export'

/**
 * Renders a track list as a pretty-printed JSON manifest.
 *
 * Two-space indentation keeps the file readable in a diff, and the output is
 * valid JSON for `JSON.parse` without any pre-processing.
 */
export function toJson(tracks: Track[], meta: ExportMeta = {}): string {
  const payload: JsonExport = {
    version: 1,
    generatedAt: meta.generatedAt ?? new Date().toISOString(),
    title: meta.title?.trim() || DEFAULT_TITLE,
    ...(meta.seed ? { seed: meta.seed } : {}),
    tracks: tracks.map(toJsonTrack),
  }

  return JSON.stringify(payload, null, 2)
}

/** Flattens the track to the fields a downstream tool actually consumes. */
function toJsonTrack(track: Track): JsonTrack {
  const videoId = safeVideoId(track.videoId)

  return {
    videoId,
    title: oneLine(track.title),
    artist: oneLine(track.artist),
    channelTitle: oneLine(track.channelTitle),
    durationSec: Math.max(0, Math.round(track.durationSec)),
    publishedAt: track.publishedAt,
    url: `https://music.youtube.com/watch?v=${videoId}`,
    topicName: oneLine(track.topicName),
  }
}

/** A newline inside a title would break the one-track-per-line reading. */
function oneLine(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').trim()
}

/**
 * A YouTube video id is `[A-Za-z0-9_-]`; anything else is dropped so a hostile
 * payload cannot inject extra fields or break out of the URL.
 */
function safeVideoId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '')
}
