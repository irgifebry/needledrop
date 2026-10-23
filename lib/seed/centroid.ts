/**
 * Seed centroids (PLAN §13.2).
 *
 * A seed is a *profile*, not a single track. One video is a centroid of size
 * one; a pasted playlist is a centroid of up to fifty reference tracks, and
 * "I like X but a bit more like Y" is a weighted blend of two centroids.
 *
 * Pure functions only — the whole point is that a centroid can be built,
 * inspected and blended without touching the network.
 */

import { artistKey } from '@/lib/youtube/artist'
import { canonicalTrackArtist, foldText, nameKey } from '@/lib/youtube/normalize'
import { topicDisplayName } from '@/lib/youtube/topic'
import type { SeedKind, SeedProfile, Track } from '@/lib/youtube/types'

/** A seed is either one track or a whole profile. */
export type SeedLike = Track | SeedProfile

/**
 * A seed flattened into the shape the scorer needs.
 *
 * Both a single track and a full profile reduce to this, which is what lets
 * the engine score against "one song" and "this 40-song playlist" alike.
 */
export type SeedContext = {
  kind: SeedKind
  label: string
  /** Canonical artist key → display name and weight. */
  artists: Map<string, { name: string; weight: number }>
  topicIds: Set<string>
  topicCategories: Set<string>
  /** The name of the seed's topic, for the "why" label. */
  topicName: string
  /** Mean title length — the reference for the "shape" signal. */
  meanTitleLength: number
  /** Mean duration — the reference for the "duration" signal. */
  meanDurationSec: number
  /** The reference tracks themselves. */
  tracks: Track[]
}

function isProfile(seed: SeedLike): seed is SeedProfile {
  return 'artistWeights' in seed && seed.artistWeights instanceof Map
}

/**
 * Builds a centroid from reference tracks.
 *
 * The artist weights are keyed by the canonical artist key, so `The Weeknd`
 * and `Weeknd` land on the same entry — that is what makes the diversity cap
 * and the seed-artist rule accurate.
 */
export function buildSeedProfile(
  tracks: Track[],
  kind: SeedProfile['kind'],
  label: string,
): SeedProfile {
  const videoIds: string[] = []
  const artistWeights = new Map<string, number>()
  const topicIds = new Set<string>()
  const topicCategories = new Set<string>()
  let durationSum = 0
  let durationCount = 0

  for (const track of tracks) {
    if (track.videoId && !videoIds.includes(track.videoId)) videoIds.push(track.videoId)

    const key = artistKey(canonicalTrackArtist(track) || track.artist)
    if (key) artistWeights.set(key, (artistWeights.get(key) ?? 0) + 1)

    if (track.topicId) topicIds.add(track.topicId)
    const categories = track.topicCategoryNames?.length
      ? track.topicCategoryNames
      : (track.topicCategories ?? [])
    for (const category of categories) {
      const normalized = foldText(topicDisplayName(category)).trim()
      if (normalized && normalized !== 'music') topicCategories.add(normalized)
    }

    if (track.durationSec > 0) {
      durationSum += track.durationSec
      durationCount += 1
    }
  }

  return {
    kind,
    videoIds,
    artistWeights,
    topicIds,
    topicCategories,
    meanDurationSec: durationCount > 0 ? durationSum / durationCount : 0,
    tracks: [...tracks],
    label,
  }
}

/**
 * Blends several centroids into one ("Seed A 70 % / Seed B 30 %").
 *
 * The weights are normalised, so any scale works: 70/30 and 7/3 produce the
 * same blend. The result is a profile, because a blend is no longer a single
 * seed shape.
 */
export function blendSeedProfiles(
  profiles: Array<{ profile: SeedProfile; weight: number }>,
): SeedProfile {
  const usable = profiles.filter((entry) => entry.profile && entry.weight > 0)
  const totalWeight = usable.reduce((sum, entry) => sum + entry.weight, 0)

  const videoIds: string[] = []
  const artistWeights = new Map<string, number>()
  const topicIds = new Set<string>()
  const topicCategories = new Set<string>()
  const tracks: Track[] = []
  const seenTracks = new Set<string>()
  let durationSum = 0
  let durationCount = 0
  let label = ''

  for (const { profile, weight } of usable) {
    const share = totalWeight > 0 ? weight / totalWeight : 0
    label = label ? `${label} + ${profile.label} (${Math.round(share * 100)}%)` : `${profile.label} (${Math.round(share * 100)}%)`

    for (const id of profile.videoIds) {
      if (!videoIds.includes(id)) videoIds.push(id)
    }
    for (const [key, value] of profile.artistWeights) {
      const canonical = nameKey(key) || key
      artistWeights.set(canonical, (artistWeights.get(canonical) ?? 0) + value * share)
    }
    for (const topicId of profile.topicIds) topicIds.add(topicId)
    for (const category of profile.topicCategories) topicCategories.add(category)
    for (const track of profile.tracks) {
      if (seenTracks.has(track.videoId)) continue
      seenTracks.add(track.videoId)
      tracks.push(track)
    }
    if (profile.meanDurationSec > 0) {
      durationSum += profile.meanDurationSec * share
      durationCount += share
    }
  }

  return {
    kind: 'profile',
    videoIds,
    artistWeights,
    topicIds,
    topicCategories,
    meanDurationSec: durationCount > 0 ? durationSum / durationCount : 0,
    tracks,
    label: label || 'Blend',
  }
}

/** The average duration of a centroid. */
export function centroidDuration(centroid: SeedProfile): number {
  if (centroid.meanDurationSec > 0) return centroid.meanDurationSec
  const durations = centroid.tracks.map((track) => track.durationSec).filter((value) => value > 0)
  if (durations.length === 0) return 0
  return durations.reduce((sum, value) => sum + value, 0) / durations.length
}

/** The artists of a centroid, heaviest first. */
export function centroidArtists(centroid: SeedProfile): Map<string, number> {
  return new Map(
    [...centroid.artistWeights.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  )
}

/**
 * Flattens a seed into the shape the scorer needs.
 *
 * Accepts a single track (a centroid of size one) or a full profile, so the
 * engine can score against "one song" and "this 40-song playlist" with the
 * same code path.
 */
export function seedContextOf(seed: SeedLike): SeedContext {
  if (isProfile(seed)) {
    const artists = new Map<string, { name: string; weight: number }>()
    for (const [key, weight] of seed.artistWeights) {
      const canonical = nameKey(key) || key
      artists.set(canonical, { name: key, weight })
    }
    for (const track of seed.tracks) {
      const canonical = artistKey(canonicalTrackArtist(track) || track.artist)
      const entry = artists.get(canonical)
      if (entry) {
        entry.name = canonicalTrackArtist(track) || entry.name
      } else if (canonical) {
        artists.set(canonical, { name: canonicalTrackArtist(track), weight: 1 })
      }
    }

    const titleLengths = seed.tracks.map((track) => track.title.length)
    const meanTitleLength =
      titleLengths.length > 0
        ? titleLengths.reduce((sum, value) => sum + value, 0) / titleLengths.length
        : 0

    return {
      kind: seed.kind,
      label: seed.label,
      artists,
      topicIds: new Set(seed.topicIds),
      topicCategories: new Set(seed.topicCategories),
      topicName: seed.tracks[0]?.topicName ?? '',
      meanTitleLength,
      meanDurationSec: centroidDuration(seed),
      tracks: [...seed.tracks],
    }
  }

  const canonicalArtist = canonicalTrackArtist(seed) || seed.artist
  const key = artistKey(canonicalArtist)
  const artists = new Map<string, { name: string; weight: number }>()
  if (key) artists.set(key, { name: canonicalArtist, weight: 1 })

  const topicCategories = new Set<string>()
  const categories = seed.topicCategoryNames?.length
    ? seed.topicCategoryNames
    : (seed.topicCategories ?? [])
  for (const category of categories) {
    const normalized = foldText(topicDisplayName(category)).trim()
    if (normalized && normalized !== 'music') topicCategories.add(normalized)
  }

  return {
    kind: 'video',
    label: canonicalArtist,
    artists,
    topicIds: seed.topicId ? new Set([seed.topicId]) : new Set<string>(),
    topicCategories,
    topicName: seed.topicName,
    meanTitleLength: seed.title.length,
    meanDurationSec: seed.durationSec,
    tracks: [seed],
  }
}
