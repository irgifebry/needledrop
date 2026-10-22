/**
 * Plain-text tracklists (PLAN §13.9 "Output · Copy tracklist", §27.2).
 *
 * Two shapes: a numbered list for a file or a message, and the same list
 * without the numbering for pasting into Discord, Instagram or a notes app.
 * Pure: no I/O.
 */

import type { Track } from '@/lib/youtube/types'

export type TextMeta = {
  /** Optional heading printed above the list. */
  title?: string
}

/**
 * A human-readable tracklist: `1. Artist — Title (3:45)`.
 *
 * The em dash and the `m:ss` duration are the conventions people already
 * read on a streaming app, so the list drops straight into a message.
 */
export function toText(tracks: Track[], meta: TextMeta = {}): string {
  const lines: string[] = []

  const heading = meta.title?.trim()
  if (heading) {
    lines.push(oneLine(heading))
    lines.push('')
  }

  tracks.forEach((track, index) => {
    lines.push(`${index + 1}. ${artistOf(track)} — ${titleOf(track)} (${mms(track.durationSec)})`)
  })

  return `${lines.join('\n')}\n`
}

/**
 * The same list without the numbering, for pasting into a chat or a caption
 * where "1." would only get in the way.
 */
export function toClipboardText(tracks: Track[]): string {
  const lines = tracks.map((track) => `${artistOf(track)} — ${titleOf(track)} (${mms(track.durationSec)})`)
  return `${lines.join('\n')}\n`
}

/** `m:ss` — the duration format every music app uses. */
function mms(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0
  const mins = Math.floor(total / 60)
  const rest = total % 60
  return `${mins}:${rest.toString().padStart(2, '0')}`
}

/** Falls back to the video id so a bare-id list still carries its identity. */
function titleOf(track: Track): string {
  return oneLine(track.title) || safeVideoId(track.videoId)
}

function artistOf(track: Track): string {
  return oneLine(track.artist) || 'Unknown artist'
}

/** A newline inside a title would split one track into two broken lines. */
function oneLine(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').trim()
}

/** A YouTube video id is `[A-Za-z0-9_-]`; anything else is dropped. */
function safeVideoId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '')
}
