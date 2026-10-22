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
 *
 * A "music video" is still a video, not an audio recording. The Data API has
 * no "audio only" flag, so the verdict is inferred from the title and the
 * channel: a VEVO channel hosts music videos (unless the title says it is an
 * audio upload), and a title carrying the word "video", the `video` version
 * tag ("Official Music Video", "Official Video", "Music Video", "Lyric
 * Video", …) or an "mv" marker is a video upload.
 */

import { extractVersionTags } from '@/lib/youtube/normalize'
import type { Track } from '@/lib/youtube/types'

/** A recording shorter than this is a teaser or a clip, not a track. */
export const TRACK_MIN_SEC = 45
/** Longer than this and it is a mix, a radio stream or a compilation. */
export const TRACK_MAX_SEC = 12 * 60

/**
 * Whether the candidate is a music *video* rather than an audio recording.
 */
export function isMusicVideo(track: Track): boolean {
  const title = track.title.toLowerCase()
  const channel = track.channelTitle.toLowerCase()

  // A VEVO channel hosts music videos, unless the title says it is an audio
  // upload (no "video" marker and an "audio" marker).
  if (channel.includes('vevo')) {
    const hasVideoMarker = /\bvideo\b/.test(title) || /\bmv\b/.test(title)
    const hasAudioMarker = /\baudio\b/.test(title)
    if (hasVideoMarker || !hasAudioMarker) return true
  }

  // Title-based markers.
  if (/\bvideo\b/.test(title)) return true
  if (/\bmv\b/.test(title)) return true
  if (/\bm\/v\b/.test(title)) return true

  const tags = extractVersionTags(track.title, track.channelTitle)
  if (tags.includes('video')) return true

  const tagText = (track.tags ?? []).join(' ').toLowerCase()
  if (/\bvideo\b/.test(tagText)) return true
  if (/\bmv\b/.test(tagText)) return true

  return false
}

/** Why a candidate was kept or dropped. */
export type TrackShape =
  | 'track' // a real recording
  | 'live' // a live broadcast or an upcoming one
  | 'musicVideo' // a music video, not an audio recording
  | 'noDuration' // a livestream: YouTube reports no length for these
  | 'tooShort' // under TRACK_MIN_SEC
  | 'tooLong' // over TRACK_MAX_SEC

/**
 * Classifies a candidate by its length, broadcast state and video-ness.
 */
export function trackShape(track: Track): TrackShape {
  const broadcast = track.liveBroadcastContent
  if (broadcast === 'live' || broadcast === 'upcoming') return 'live'

  if (isMusicVideo(track)) return 'musicVideo'

  const duration = track.durationSec
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
    return 'noDuration'
  }

  if (duration < TRACK_MIN_SEC) return 'tooShort'
  if (duration > TRACK_MAX_SEC) return 'tooLong'

  return 'track'
}

/** Whether a candidate is a real recording rather than a mix, clip, stream or music video. */
export function isTrack(track: Track): boolean {
  return trackShape(track) === 'track'
}

/**
 * Keeps only the real recordings, in the order they arrived.
 */
export function filterTracks<T extends Track>(tracks: T[]): T[] {
  return tracks.filter((track) => isTrack(track))
}
