/**
 * Scoring weights (PLAN §13.1.6, §13.1.9).
 *
 * One slider interpolates between two hand-tuned vectors. "Strict" (0) buys
 * sameness — same topic, same artist, same length. "Explore" (100) buys
 * breadth — popularity, cross-source agreement, recent releases. Every
 * weight is the *maximum* a signal can contribute; the engine multiplies it
 * by how strongly the signal fires.
 */

import type { ScoreProfile } from '@/lib/youtube/types'

/**
 * The maximum points each signal can contribute.
 *
 * The engine multiplies every weight by how strongly the signal fires, so
 * the weights are the *budget* of each signal, not its score.
 */
export type Weights = {
  /** Same Wikipedia topic as the seed. */
  topic: number
  /** Same artist as the seed. */
  artist: number
  /** Official artist channel. */
  official: number
  /** The title names the seed artist. */
  titleMatch: number
  /** The title has the same shape as the seed's titles. */
  shape: number
  /** The duration is close to the seed's. */
  duration: number
  /** Popularity prior (toggleable). */
  popularity: number
  /** Found by more than one independent source. */
  crossSource: number
  /** Same genre (topic category) as the seed. */
  genre: number
  /** Recent release (toggleable). */
  recency: number
}

/** Breadth 0 — "songs that sound like this". */
const STRICT: Weights = {
  topic: 60,
  artist: 40,
  official: 25,
  titleMatch: 20,
  shape: 8,
  duration: 10,
  popularity: 0,
  crossSource: 0,
  genre: 12,
  recency: 0,
}

/** Breadth 100 — "songs in the neighbourhood". */
const EXPLORE: Weights = {
  topic: 15,
  artist: 5,
  official: 10,
  titleMatch: 5,
  shape: 3,
  duration: 2,
  popularity: 10,
  crossSource: 8,
  genre: 4,
  recency: 5,
}

/** The v2 "Balanced" profile — the plan's default scoring table (§13.1.9). */
const BALANCED: Weights = {
  topic: 40,
  artist: 15,
  official: 20,
  titleMatch: 10,
  shape: 5,
  duration: 5,
  popularity: 10,
  crossSource: 6,
  genre: 12,
  recency: 5,
}

/**
 * The weight vector for a breadth setting.
 *
 * Linear in `breadth / 100`, so the slider is predictable: half way is half
 * way between "sounds like this" and "in the neighbourhood".
 */
export function weightsFor(breadth: number): Weights {
  const t = Math.min(100, Math.max(0, breadth)) / 100
  const lerp = (strict: number, explore: number) => strict + (explore - strict) * t
  return {
    topic: lerp(STRICT.topic, EXPLORE.topic),
    artist: lerp(STRICT.artist, EXPLORE.artist),
    official: lerp(STRICT.official, EXPLORE.official),
    titleMatch: lerp(STRICT.titleMatch, EXPLORE.titleMatch),
    shape: lerp(STRICT.shape, EXPLORE.shape),
    duration: lerp(STRICT.duration, EXPLORE.duration),
    popularity: lerp(STRICT.popularity, EXPLORE.popularity),
    crossSource: lerp(STRICT.crossSource, EXPLORE.crossSource),
    genre: lerp(STRICT.genre, EXPLORE.genre),
    recency: lerp(STRICT.recency, EXPLORE.recency),
  }
}

/**
 * The three presets the UI offers.
 *
 * `strict` and `explore` are the two ends of the slider; `balanced` is the
 * plan's revised scoring table (§13.1.9), which is the default profile.
 */
export function weightsForProfile(profile: ScoreProfile): Weights {
  switch (profile) {
    case 'strict':
      return { ...STRICT }
    case 'explore':
      return { ...EXPLORE }
    case 'balanced':
    default:
      return { ...BALANCED }
  }
}
