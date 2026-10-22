/**
 * What a track actually is (PLAN §4, and the "music only" requirement).
 *
 * Pure by design: no I/O, no fetch, no node:*. The same predicate has to
 * run on the search path and on every discovery source, so it lives here
 * rather than in one caller.
 *
 * The Music category (`videoCategoryId=10`) also holds user-uploaded covers,
 * reaction videos, hour-long "radio" streams and DJ mixes. Measured against
 * the live API: real recordings run 3–7 minutes, mixes and radio streams run
 * 25–370 minutes, and livestreams report no length at all. The server-side
 * `videoDuration=medium` filter (4–20 minutes) removes most of the noise for
 * free, but it still admits 11–20 minute radio segments, and it does nothing
 * for candidates that arrive from related videos, artist radio or topic
 * expansion, which have no server-side filter at all.
 */

import type { Track } from '@/lib/youtube/types'

/** A recording shorter than this is a teaser or a clip, not a track. */
export const TRACK_MIN_SEC = 45
/** Longer than this and it is a mix, a radio stream or a compilation. */
export const TRACK_MAX_SEC = 12 * 60

/** Why a candidate was kept or dropped. */
export type TrackShape =
  | 'track' // a real recording
  | 'live' // a live broadcast or an upcoming one
  | 'noDuration' // a livestream: YouTube reports no length for these
  | 'tooShort' // under TRACK_MIN_SEC
  | 'tooLong' // over TRACK_MAX_SEC

/**
 * Classifies a candidate by its length and broadcast state.
 *
 * The live check comes first: a live broadcast also has no duration, and
 * "live" is the more informative verdict — a live show is not a broken
 * duration report, it is a different thing entirely.
 */
export function trackShape(track: Track): TrackShape {
  const broadcast = track.liveBroadcastContent
  if (broadcast === 'live' || broadcast === 'upcoming') return 'live'

  const duration = track.durationSec
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
    return 'noDuration'
  }

  if (duration < TRACK_MIN_SEC) return 'tooShort'
  if (duration > TRACK_MAX_SEC) return 'tooLong'

  return 'track'
}

/** Whether a candidate is a real recording rather than a mix, clip or stream. */
export function isTrack(track: Track): boolean {
  return trackShape(track) === 'track'
}

/**
 * Keeps only the real recordings, in the order they arrived.
 *
 * The element type survives so callers can pass richer objects (candidates,
 * search rows) through without widening their type on the way back.
 */
export function filterTracks<T extends Track>(tracks: T[]): T[] {
  return tracks.filter((track) => isTrack(track))
}
