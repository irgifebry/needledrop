/**
 * Explainable scoring (PLAN §13.1.5).
 *
 * A score the user cannot interrogate is a score the user cannot steer. Every
 * signal therefore produces a `(label, points, kind)` triple: the label is
 * what the UI shows in the "why?" popover, the kind is what a client can
 * filter or style on.
 *
 * Pure functions only.
 */

import { seedContextOf, type SeedLike } from '@/lib/seed/centroid'
import { artistKey, officialSignalStrength } from '@/lib/youtube/artist'
import { canonicalTrackArtist, foldText } from '@/lib/youtube/normalize'
import { topicDisplayName } from '@/lib/youtube/topic'
import type { DiscoveryOptions, ScoreReason, SourceKind, Track } from '@/lib/youtube/types'

import { weightsFor, type Weights } from './weights'

/** The machine-readable id of a scoring signal. */
export type ReasonKind =
  | 'topic'
  | 'artist'
  | 'official'
  | 'titleMatch'
  | 'shape'
  | 'duration'
  | 'popularity'
  | 'recency'
  | 'crossSource'
  | 'genre'

/**
 * Formats a view count the way the UI shows it.
 *
 * 1_200_000 → "1.2M", 340_000 → "340K", 1_900_000_000 → "1.9B".
 */
export function formatViewCount(viewCount: number): string {
  if (viewCount >= 1e9) return `${(viewCount / 1e9).toFixed(1)}B`
  if (viewCount >= 1e6) return `${(viewCount / 1e6).toFixed(1)}M`
  if (viewCount >= 1e3) return `${Math.round(viewCount / 1e3)}K`
  return String(viewCount)
}

/**
 * The popularity prior (PLAN §13.1.4).
 *
 * Logarithmic on purpose: the difference between 10 K and 100 K views
 * matters far more than the difference between 1 B and 1.1 B.
 */
export function popularityPrior(viewCount: number): number {
  const MAX = 1e8
  if (!Number.isFinite(viewCount) || viewCount <= 0) return 0
  return Math.min(1, Math.log10(1 + viewCount) / Math.log10(1 + MAX))
}

/**
 * The engagement prior (PLAN §13.1.4), in `[0, 1]`.
 *
 * `likeCount / max(1, viewCount)` is the share of viewers who pressed the
 * like button, which is a better signal of *quality* than raw view count. It
 * is squashed through a logistic curve so a track with an absurd like ratio
 * cannot dominate the score.
 */
export function engagementPrior(likeCount: number, viewCount: number): number {
  if (!Number.isFinite(likeCount) || likeCount <= 0) return 0
  const views = Number.isFinite(viewCount) && viewCount > 0 ? viewCount : 1
  const rate = likeCount / views
  // Logistic centred on a 3 % like rate, which is a strong music video.
  return 1 / (1 + Math.exp(-(rate - 0.03) * 60))
}

/** The plan's band for the engagement signal: 0–5 points (§13.1.4). */
const ENGAGEMENT_MAX_POINTS = 5

/**
 * The recency prior (PLAN §13.1.4), in `[0, 1]`.
 *
 * Anything from the last year is 1; the prior then fades out over the next
 * four years, so a five-year-old track scores 0.
 */
export function recencyPrior(publishedAt: string, now: number = Date.now()): number {
  const published = Date.parse(publishedAt)
  if (Number.isNaN(published)) return 0
  const years = (now - published) / (365.25 * 24 * 60 * 60 * 1000)
  if (years <= 1) return 1
  if (years >= 5) return 0
  return 1 - (years - 1) / 4
}

function round(value: number): number {
  return Number(value.toFixed(1))
}

/** Whether the candidate's title literally names the seed artist. */
function titleNamesArtist(title: string, artistName: string): boolean {
  const needle = foldText(artistName).trim()
  if (needle.length < 3) return false
  const haystack = foldText(title)
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, 'u').test(haystack)
}

/**
 * Turns a candidate's score into reasons a human can read.
 *
 * The order of the checks mirrors the plan's scoring table (§13.1.9): topic,
 * artist, genre, official channel, title, shape, duration, popularity,
 * recency and finally the cross-source bonus.
 */
export function explainScore(
  seed: SeedLike,
  candidate: Track,
  sources: SourceKind[],
  options: DiscoveryOptions,
  weights: Weights = weightsFor(options.breadth),
): ScoreReason[] {
  const context = seedContextOf(seed)
  const reasons: ScoreReason[] = []

  const candidateArtist = canonicalTrackArtist(candidate) || candidate.artist
  const candidateArtistKey = artistKey(candidateArtist)
  const seedArtist = context.artists.get(candidateArtistKey)

  if (candidate.topicId && context.topicIds.has(candidate.topicId)) {
    const topicName = topicDisplayName(context.topicName || candidate.topicName)
    reasons.push({
      kind: 'topic',
      label: topicName && topicName !== 'Unknown topic'
        ? `Same Wikipedia topic (${topicName})`
        : 'Same Wikipedia topic',
      points: weights.topic,
    })
  }

  if (seedArtist && !options.hideSeedArtist) {
    reasons.push({
      kind: 'artist',
      label: 'Same artist as the seed',
      points: weights.artist,
    })
  } else if (!seedArtist) {
    const mentioned = [...context.artists.values()].some((entry) =>
      titleNamesArtist(candidate.title, entry.name),
    )
    const similar = [...context.artists.keys()].some(
      (key) =>
        key.length >= 3 &&
        candidateArtistKey.length >= 3 &&
        (key.includes(candidateArtistKey) || candidateArtistKey.includes(key)),
    )
    if (mentioned || similar) {
      const name = context.artists.values().next().value?.name ?? 'the seed artist'
      reasons.push({
        kind: 'titleMatch',
        label: `Title mentions ${name}`,
        points: weights.titleMatch,
      })
    }
  }

  // The human-readable category titles are preferred when the API has them.
  const candidateCategories = candidate.topicCategoryNames?.length
    ? candidate.topicCategoryNames
    : (candidate.topicCategories ?? [])
  if (candidateCategories.length > 0) {
    const shared = candidateCategories.find((category) =>
      context.topicCategories.has(foldText(topicDisplayName(category)).trim()),
    )
    if (shared) {
      reasons.push({
        kind: 'genre',
        label: `Same genre (${shared})`,
        points: weights.genre,
      })
    }
  }

  const officialStrength = officialSignalStrength(candidate.channelTitle)
  if (officialStrength >= 0.5) {
    reasons.push({
      kind: 'official',
      label: officialStrength >= 1 ? 'Official artist channel' : 'Record label channel',
      points: round(weights.official * officialStrength),
    })
  }

  if (context.meanTitleLength > 0 && Math.abs(candidate.title.length - context.meanTitleLength) <= 14) {
    reasons.push({ kind: 'shape', label: 'Same title shape', points: weights.shape })
  }

  if (
    context.meanDurationSec > 0 &&
    candidate.durationSec > 0 &&
    Math.abs(candidate.durationSec - context.meanDurationSec) / context.meanDurationSec <= 0.25
  ) {
    reasons.push({ kind: 'duration', label: 'Similar length', points: weights.duration })
  }

  if (options.includePopularity) {
    const prior = popularityPrior(candidate.viewCount) * weights.popularity
    if (prior > 0.4) {
      reasons.push({
        kind: 'popularity',
        label: `Popular (${formatViewCount(candidate.viewCount)} views)`,
        points: round(prior),
      })
    }

    // The engagement signal rides with the popularity prior: both belong to
    // the "popular now" profile, and both are off in pure-similarity mode.
    // §13.1.4 gives it an absolute band of 0–5 points, not a breadth-driven
    // weight, so that is how it is applied here.
    if (candidate.likeCount !== undefined) {
      const engagement = engagementPrior(candidate.likeCount, candidate.viewCount) * ENGAGEMENT_MAX_POINTS
      if (engagement > 0.4) {
        const rate = Math.round((candidate.likeCount / Math.max(1, candidate.viewCount)) * 1000) / 10
        reasons.push({
          kind: 'engagement',
          label: `Well received (${rate}% like rate)`,
          points: round(engagement),
        })
      }
    }
  }

  if (options.includeNewReleases) {
    const prior = recencyPrior(candidate.publishedAt) * weights.recency
    if (prior > 0.4) {
      const year = new Date(candidate.publishedAt).getUTCFullYear()
      reasons.push({
        kind: 'recency',
        label: Number.isFinite(year) ? `Recent release (${year})` : 'Recent release',
        points: round(prior),
      })
    }
  }

  if (sources.length >= 2) {
    reasons.push({
      kind: 'crossSource',
      label: `Found by ${sources.length} independent sources`,
      points: weights.crossSource,
    })
  }

  reasons.sort((a, b) => b.points - a.points)
  return reasons
}
