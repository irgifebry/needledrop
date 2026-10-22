/**
 * Test fixtures shared by the unit, property and contract suites.
 *
 * The factories return *complete* objects so that a test only has to name the
 * one field it cares about — a half-built `Track` would make a failing
 * assertion ambiguous ("is the duration wrong, or was it never set?").
 *
 * Everything here is deterministic: no clock, no randomness, no network.
 */

import { toCandidate } from '@/lib/youtube/similar'
import {
  DEFAULT_OPTIONS,
  type Candidate,
  type DiscoveryOptions,
  type SourceKind,
  type Track,
} from '@/lib/youtube/types'

/** A valid music track. Override only what the test is about. */
export function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    videoId: 'vid00000001',
    title: 'Artist One - Song Alpha',
    artist: 'Artist One',
    channelTitle: 'Artist One - Topic',
    durationSec: 200,
    thumbnail: 'https://i.ytimg.com/vi/vid00000001/hqdefault.jpg',
    topicId: '/m/topicalpha',
    topicName: 'Synth-pop',
    viewCount: 1_000_000,
    publishedAt: '2020-01-01T00:00:00Z',
    categoryId: '10',
    ...overrides,
  }
}

/** Discovery options with the plan's defaults, overridden per test. */
export function makeOptions(overrides: Partial<DiscoveryOptions> = {}): DiscoveryOptions {
  return { ...DEFAULT_OPTIONS, ...overrides }
}

/** A scored candidate, as the engine would produce it. */
export function makeCandidate(
  track: Track,
  seed: Track,
  options: DiscoveryOptions,
  sources: SourceKind[] = ['related'],
): Candidate {
  return toCandidate(track, seed, sources, options)
}

/** The ids of a list of candidates, in order — handy for order assertions. */
export function videoIds(candidates: Candidate[]): string[] {
  return candidates.map((candidate) => candidate.videoId)
}
