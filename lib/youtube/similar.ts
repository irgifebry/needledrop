/**
 * The similarity engine (PLAN §4 stage 5, §13.1.6, §13.1.9).
 *
 * Pure functions only — no I/O, no environment. Everything here is unit
 * testable without touching the network, which is the whole reason the
 * scoring lives in its own module.
 *
 * The engine is a *superset* of v1: the same seed and the same options
 * still produce a sane playlist, only better explained and better filtered.
 */

import { seedContextOf, type SeedLike } from '@/lib/seed/centroid'
import { explainScore, formatViewCount, popularityPrior, recencyPrior } from '@/lib/scoring/explain'
import { weightsFor, weightsForProfile, type Weights } from '@/lib/scoring/weights'
import { artistKey, officialSignalStrength } from '@/lib/youtube/artist'
import {
  canonicalTitleOf,
  canonicalTrackArtist,
  extractVersionTags,
  isVersionAllowed,
  normalizeTitle,
  parseArtistTitle,
  trackKeyOf,
  versionKeyOf,
} from '@/lib/youtube/normalize'
import { isRegionSafe, languageMatches } from '@/lib/youtube/regions'
import { isMusicVideo } from '@/lib/youtube/music'
import type {
  Candidate,
  DiscoveryOptions,
  ScoreReason,
  SourceKind,
  Track,
  VersionTag,
} from '@/lib/youtube/types'

export { formatViewCount, popularityPrior, recencyPrior, weightsFor, weightsForProfile }
export type { Weights }

/** Extra inputs the filters need that do not live in `DiscoveryOptions`. */
export type SelectContext = {
  /** The seed's own video id(s) — the seed never appears in its playlist. */
  seedVideoIds?: string[]
  /**
   * Canonical artist keys of the seed.
   *
   * Needed by the *hide seed artist* control: the option itself says nothing
   * about which artist to hide, only the seed knows that.
   */
  seedArtistKeys?: string[]
  /** The visitor's country, when the platform knows it. */
  userRegion?: string | null
  /** Video ids already in the user's library. */
  libraryVideoIds?: string[]
  /** Canonical track keys already in the user's library. */
  libraryTrackKeys?: string[]
  /** Topic categories of the seed, used to keep candidates in the same genre. */
  seedTopicCategories?: string[]
}

/**
 * Scores a candidate against a seed.
 *
 * The seed may be a single track or a whole centroid — a pasted playlist
 * scores candidates against the *shape* of that playlist, not against one
 * arbitrary song in it.
 */
export function scoreCandidate(
  seed: SeedLike,
  candidate: Track,
  sources: SourceKind[],
  options: DiscoveryOptions,
): { score: number; reasons: ScoreReason[] } {
  const reasons = explainScore(seed, candidate, sources, options, weightsFor(options.breadth))
  const score = reasons.reduce((sum, reason) => sum + reason.points, 0)
  return { score: Number(score.toFixed(1)), reasons }
}

/**
 * The canonical identity of a candidate.
 *
 * The artist becomes the canonical one, the title is normalised, and the
 * version tags are extracted once so every downstream filter agrees on what
 * the track is.
 */
export function toCandidate(
  track: Track,
  seed: SeedLike,
  sources: SourceKind[],
  options: DiscoveryOptions,
): Candidate {
  const { score, reasons } = scoreCandidate(seed, track, sources, options)
  const artist = canonicalTrackArtist(track) || track.artist
  const versionTags = extractVersionTags(track.title, track.channelTitle)
  const clean = canonicalTitleOf(track.title, track.channelTitle)
  const { featureArtist } = normalizeTitle(track.title, track.channelTitle)

  return {
    ...track,
    artist,
    trackKey: trackKeyOf(artist, clean),
    featureArtist,
    sources,
    score,
    reasons,
    versionTags,
    official: officialSignalStrength(track.channelTitle) >= 0.5,
  }
}

/** The canonical artist of a track. */
export function canonicalArtistFor(track: Track): string {
  return canonicalTrackArtist(track) || track.artist
}

/** The dedupe key of a candidate: the track key plus its derivative version. */
export function versionKeyFor(candidate: Candidate): string {
  const artist = canonicalArtistFor(candidate)
  const clean = canonicalTitleOf(candidate.title, candidate.channelTitle)
  const versionTags = candidate.versionTags?.length
    ? candidate.versionTags
    : extractVersionTags(candidate.title, candidate.channelTitle)
  return versionKeyOf(artist, clean, versionTags)
}

/* ── hard filters ─────────────────────────────────────────────────────── */

const EXPLICIT_HINT = /\b(?:xxx|nsfw|porn(?:ographic)?|18\s*\+)\b/i

function isExplicit(track: Track, versionTags: VersionTag[]): boolean {
  if (versionTags.includes('explicit')) return true
  return EXPLICIT_HINT.test(track.title)
}

function yearOf(iso: string): number | null {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return null
  return new Date(time).getUTCFullYear()
}

/**
 * The filters that decide whether a candidate may enter the playlist at all.
 *
 * Everything here is a *policy* the user asked for; the scoring only ranks
 * what survives.
 */
function passesHardFilters(
  candidate: Candidate,
  options: DiscoveryOptions,
  context: SelectContext,
): boolean {
  const seedVideoIds = context.seedVideoIds ?? []
  if (seedVideoIds.includes(candidate.videoId)) return false

  // "Hide the seed artist" is a *removal* control, not a scoring tweak: the
  // user asked not to see that artist again, so their tracks do not enter
  // the playlist at all (PLAN §4 stage 5, §13.3).
  if (options.hideSeedArtist) {
    const seedArtists = context.seedArtistKeys ?? []
    if (seedArtists.length > 0) {
      const candidateKey = artistKey(canonicalArtistFor(candidate))
      if (candidateKey && seedArtists.includes(candidateKey)) return false
    }
  }

  if (options.skipAlreadyInLibrary) {
    if ((context.libraryVideoIds ?? []).includes(candidate.videoId)) return false
    const library = context.libraryTrackKeys ?? []
    if (library.includes(versionKeyFor(candidate))) return false
    if (candidate.trackKey && library.includes(candidate.trackKey)) return false
  }

  // Not music. An unknown category is kept; only a known non-music one is dropped.
  if (candidate.categoryId && candidate.categoryId !== '10') return false

  // Only audio recordings, not music videos (PLAN §4 "music only").
  if (isMusicVideo(candidate)) return false

  // Keep the playlist in the seed's genre: when the seed carries genre
  // categories, a candidate that carries its own categories must share at
  // least one of them. Candidates without categories are left alone so a
  // genre the API files under an unexpected name never comes back empty.
  const normalizeCategory = (value: string) =>
    value
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/[^a-z0-9]+/g, '')
  const seedCategories = (context.seedTopicCategories ?? [])
    .map((category) => normalizeCategory(category))
    .filter((category) => category.length > 0 && category !== 'music')
  if (seedCategories.length > 0) {
    const candidateCategories = [
      ...(candidate.topicCategoryNames ?? []),
      ...(candidate.topicCategories ?? []),
    ]
      .map((category) => normalizeCategory(category))
      .filter((category) => category.length > 0 && category !== 'music')
    if (candidateCategories.length > 0 && !candidateCategories.some((category) => seedCategories.includes(category))) {
      return false
    }
  }

  // Embeddable previews (PLAN §13.1.7).
  if (candidate.embeddable === false) return false

  const duration = options.durationSec
  if (duration) {
    if (candidate.durationSec < duration.min) return false
    if (candidate.durationSec > duration.max) return false
  }

  const versionTags = candidate.versionTags?.length
    ? candidate.versionTags
    : extractVersionTags(candidate.title, candidate.channelTitle)
  if (!isVersionAllowed(versionTags, { includeVersions: allowedVersions(options) })) return false

  if (options.familyMode) {
    if (candidate.madeForKids === true) return false
    if (isExplicit(candidate, versionTags)) return false
  }

  if (options.regionSafeOnly && !isRegionSafe(candidate, context.userRegion)) return false

  if (options.languages && options.languages.length > 0) {
    if (!languageMatches(candidate, options.languages)) return false
  }

  if (options.publishedRange) {
    const year = yearOf(candidate.publishedAt)
    if (year !== null && (year < options.publishedRange.from || year > options.publishedRange.to)) {
      return false
    }
  }

  if (options.blockedArtists.length > 0) {
    const blocked = new Set(options.blockedArtists.map((artist) => artistKey(artist)))
    const candidateKey = artistKey(candidate.artist)
    if (candidateKey && blocked.has(candidateKey)) return false
  }

  if (options.blockedKeywords.length > 0) {
    const title = candidate.title.toLowerCase()
    for (const keyword of options.blockedKeywords) {
      const needle = keyword.trim().toLowerCase()
      if (!needle) continue
      if (title.includes(needle)) return false
    }
  }

  return true
}

/**
 * The derivative versions the user opted into.
 *
 * `includeVersions` is the v2 allow-list. The v1 booleans are only read when
 * that allow-list is empty, so a v1 client — which sends `includeLive` but no
 * allow-list — keeps exactly the behaviour it had. A caller that sends an
 * explicit allow-list is always obeyed.
 */
export function allowedVersions(options: DiscoveryOptions): VersionTag[] {
  const allowed = new Set(options.includeVersions)
  if (allowed.size === 0) {
    if (options.includeLive) allowed.add('live')
    if (options.includeRemix) allowed.add('remix')
    if (options.includeAcoustic) allowed.add('acoustic')
  }
  return [...allowed]
}

/* ── ordering ─────────────────────────────────────────────────────────── */

/** A small deterministic PRNG, so a seeded shuffle is reproducible. */
function mulberry32(seed: number): () => number {
  let state = Math.trunc(seed) >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A Fisher-Yates shuffle driven by the seeded PRNG. */
function shuffleDeterministic(candidates: Candidate[], seed: number): Candidate[] {
  const random = mulberry32(seed)
  const result = [...candidates]
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    const swap = result[i]
    result[i] = result[j]
    result[j] = swap
  }
  return result
}

/**
 * How "loud" a track feels, in `[0, 1]`.
 *
 * The plan only offers proxies — duration, popularity, source confidence and
 * the version tags — so this is an honest approximation of an energy arc,
 * not a real audio analysis.
 */
export function energyScore(candidate: Candidate): number {
  const popularity = popularityPrior(candidate.viewCount)
  const duration = Math.min(1, Math.max(0, (candidate.durationSec - 90) / 210))
  const confidence = Math.min(1, candidate.sources.length / 2)

  let versionEnergy = 0
  if (candidate.versionTags?.includes('remix')) versionEnergy += 1
  if (candidate.versionTags?.includes('nightcore')) versionEnergy += 1
  if (candidate.versionTags?.includes('spedUp')) versionEnergy += 1
  if (candidate.versionTags?.includes('acoustic')) versionEnergy -= 1
  if (candidate.versionTags?.includes('unplugged')) versionEnergy -= 1
  if (candidate.versionTags?.includes('instrumental')) versionEnergy -= 0.5
  const version = (versionEnergy + 1.5) / 3

  const score =
    0.45 * popularity + 0.25 * duration + 0.2 * confidence + 0.1 * Math.min(1, Math.max(0, version))
  return Math.min(1, Math.max(0, score))
}

/**
 * Groups the final list into a session: warm-up → build → peak → cooldown.
 *
 * Purely cosmetic — the *selection* is already done by the time this runs,
 * so reordering can never change which tracks are in the playlist.
 */
export function energyArcOrder(candidates: Candidate[]): Candidate[] {
  if (candidates.length === 0) return []

  const scored = candidates
    .map((candidate) => ({ candidate, energy: energyScore(candidate) }))
    .sort((a, b) => a.energy - b.energy || a.candidate.videoId.localeCompare(b.candidate.videoId))

  const size = Math.max(1, Math.round(scored.length / 4))
  const groups: typeof scored[] = [[], [], [], []]
  scored.forEach((entry, index) => {
    groups[Math.min(3, Math.floor(index / size))].push(entry)
  })

  const ascending = (entries: typeof scored) => [...entries].sort((a, b) => a.energy - b.energy)
  const descending = (entries: typeof scored) => [...entries].sort((a, b) => b.energy - a.energy)

  // Warm-up (calmest) → build → peak (loudest) → cooldown (calm again).
  const ordered = [
    ...ascending(groups[0]),
    ...ascending(groups[2]),
    ...ascending(groups[3]),
    ...descending(groups[1]),
  ]

  return ordered.map((entry) => entry.candidate)
}

/**
 * The final order of the selected tracks.
 *
 * Every ordering is deterministic, including the shuffle: the same seed
 * always produces the same playlist, so a shared link shows the same songs.
 */
export function orderCandidates(candidates: Candidate[], options: DiscoveryOptions): Candidate[] {
  const copy = [...candidates]
  switch (options.order) {
    case 'energyArc':
      return energyArcOrder(copy)
    case 'releaseDate':
      return copy.sort(
        (a, b) =>
          (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0) ||
          b.score - a.score ||
          a.title.localeCompare(b.title),
      )
    case 'artist':
      // Sorted by the canonical artist key, so "The Beatles" lands under B
      // and diacritics never split a name in two.
      return copy.sort(
        (a, b) =>
          artistKey(a.artist).localeCompare(artistKey(b.artist)) ||
          a.artist.localeCompare(b.artist) ||
          a.title.localeCompare(b.title) ||
          a.videoId.localeCompare(b.videoId),
      )
    case 'shuffle':
      return shuffleDeterministic(copy, options.shuffleSeed ?? 0)
    case 'score':
    default:
      return copy.sort(
        (a, b) =>
          b.score - a.score ||
          a.title.localeCompare(b.title) ||
          a.videoId.localeCompare(b.videoId),
      )
  }
}

/* ── selection ────────────────────────────────────────────────────────── */

/**
 * The playlist the user actually gets (PLAN §4 stage 5, §13.1.9).
 *
 * Hard filters first, then the canonical dedupe (by *version* key, so a live
 * take stays a distinct track), then the per-artist cap, then the requested
 * order, then the truncation. The cap runs on the score-ranked list so the
 * best tracks win the available slots.
 */
export function selectPlaylist(
  candidates: Candidate[],
  options: DiscoveryOptions,
  context: SelectContext = {},
): Candidate[] {
  const ranked = [...candidates].sort(
    (a, b) => b.score - a.score || a.title.localeCompare(b.title) || a.videoId.localeCompare(b.videoId),
  )

  const seen = new Set<string>()
  const perArtist = new Map<string, number>()
  const chosen: Candidate[] = []

  for (const candidate of ranked) {
    if (!passesHardFilters(candidate, options, context)) continue

    const key = versionKeyFor(candidate)
    if (seen.has(key)) continue
    seen.add(key)

    const candidateArtistKey = artistKey(canonicalArtistFor(candidate))
    const used = perArtist.get(candidateArtistKey) ?? 0
    if (options.maxPerArtist > 0 && used >= options.maxPerArtist) continue
    perArtist.set(candidateArtistKey, used + 1)

    chosen.push(candidate)
  }

  return orderCandidates(chosen, options).slice(0, options.count)
}

/**
 * The artist and title of a raw video title.
 *
 * Kept because the demo catalogue and the v1 routes parse titles this way.
 */
export function parseTrack(raw: {
  videoId: string
  title: string
  channelTitle: string
}): { artist: string; title: string } {
  return parseArtistTitle(raw.title, raw.channelTitle)
}

/**
 * The artists of a seed, with their weights.
 *
 * Exposed for the resolve route, which shows the user what the centroid is
 * made of before they commit to a run.
 */
export function seedArtists(seed: SeedLike): Map<string, number> {
  const context = seedContextOf(seed)
  const weights = new Map<string, number>()
  for (const [key, entry] of context.artists) weights.set(key, entry.weight)
  return weights
}
