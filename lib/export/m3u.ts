/**
 * M3U / extended-M3U rendering (PLAN §13.9 "Output · Export", §27.2).
 *
 * Pure by design: no I/O, no `fetch`, no `next/headers`. The route handler
 * and a client-side "save playlist" button share this exact renderer, and
 * the module is unit-testable without a network.
 */

import type { Track } from '@/lib/youtube/types'

export type M3uOptions = {
  /**
   * Emit the extended directive (`tvg-id`, `tvg-name`, `artist`) understood by
   * IPTV-style players. Off by default because the plain form is what generic
   * music players expect.
   */
  extended?: boolean
}

/**
 * Renders a track list as an M3U playlist.
 *
 * Plain form — one `#EXTINF` line and one URL line per track:
 *
 * ```
 * #EXTM3U
 * #EXTINF:225,Artist - Title
 * https://music.youtube.com/watch?v=<videoId>
 * ```
 */
export function toM3u(tracks: Track[], options: M3uOptions = {}): string {
  const lines: string[] = ['#EXTM3U']

  for (const track of tracks) {
    const videoId = safeVideoId(track.videoId)
    const title = oneLine(track.title)
    const artist = oneLine(track.artist)

    if (options.extended) {
      lines.push(
        `#EXTINF:-1 tvg-id="${escapeAttr(videoId)}" tvg-name="${escapeAttr(title)}" artist="${escapeAttr(artist)}"`,
      )
    } else {
      const seconds = Math.max(0, Math.round(track.durationSec))
      lines.push(`#EXTINF:${seconds},${artist} - ${title}`)
    }

    lines.push(`https://music.youtube.com/watch?v=${videoId}`)
  }

  return `${lines.join('\n')}\n`
}

/**
 * Flattens a value to a single line.
 *
 * A stray newline inside a title would otherwise split one track into two
 * broken lines and desynchronise the directive/URL pairing every M3U parser
 * depends on.
 */
function oneLine(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').trim()
}

/** A double quote would end an extended attribute value early. */
function escapeAttr(value: string): string {
  return oneLine(value).replace(/"/g, "'")
}

/**
 * A YouTube video id is `[A-Za-z0-9_-]`; anything else is dropped so a hostile
 * payload cannot inject extra lines into the generated file.
 */
function safeVideoId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '')
}
