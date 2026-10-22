/**
 * Shared domain types (PLAN §14.2).
 *
 * This module is imported by client components as well as the server, so it
 * must stay free of server-only imports (no `zod`, no `node:*`).
 * Runtime parsing lives in `lib/youtube/options.ts`.
 */

export type VersionTag =
  | 'live'
  | 'remix'
  | 'acoustic'
  | 'instrumental'
  | 'karaoke'
  | 'cover'
  | 'spedUp'
  | 'nightcore'
  | 'reverb'
  | 'unplugged'
  | 'remaster'
  | 'official'
  | 'audio'
  | 'video'
  | 'lyrics'
  | 'visualizer'
  | 'explicit'
  | 'clean'
  | '4k'
  | 'hd'

export const VERSION_TAGS: VersionTag[] = [
  'live',
  'remix',
  'acoustic',
  'instrumental',
  'karaoke',
  'cover',
  'spedUp',
  'nightcore',
  'reverb',
  'unplugged',
  'remaster',
  'official',
  'audio',
  'video',
  'lyrics',
  'visualizer',
  'explicit',
  'clean',
  '4k',
  'hd',
]

/** Version tags that identify a *different recording* of the same song. */
export const DERIVATIVE_VERSION_TAGS: VersionTag[] = [
  'live',
  'remix',
  'acoustic',
  'instrumental',
  'karaoke',
  'cover',
  'spedUp',
  'nightcore',
  'reverb',
  'unplugged',
]

export type SourceKind =
  | 'related'
  | 'artistRadio'
  | 'topic'
  | 'curated'
  | 'trending'
  | 'artistChannel'
  | 'library'

export type ScoreReason = {
  label: string
  points: number
  /** Machine-readable signal id, e.g. `topic`, `official`, `popularity`. */
  kind?: string
}

export type Ordering = 'score' | 'energyArc' | 'releaseDate' | 'artist' | 'shuffle'

export type Track = {
  videoId: string
  title: string
  artist: string
  channelTitle: string
  durationSec: number
  thumbnail: string
  topicId: string
  topicName: string
  viewCount: number
  publishedAt: string
  categoryId: string

  /* ── v2 enrichment (PLAN §13.1.1, §13.1.4, §13.1.7) ───────────── */

  /** `snippet.channelId` — lets the artist-radio source cost 2 units, not 100. */
  channelId?: string
  /** Canonical `artist::title` key — one song, one key, whatever the channel. */
  trackKey?: string
  /** Parsed from the raw title. */
  featureArtist?: string | null
  /** All Wikipedia topic categories, not just the first. */
  topicCategories?: string[]
  /** Human-readable category titles, when the API provides them. */
  topicCategoryNames?: string[]
  likeCount?: number
  /** `snippet.defaultLanguage` */
  language?: string
  /**
   * `snippet.availableCountries` does not exist in the Data API v3. Region
   * restriction is reported as `contentDetails.regionRestriction`
   * (PLAN-ADDENDUM §34 correction 1), and only on restricted content.
   * An empty list means **"no region restriction reported"**, which is not
   * the same as "available everywhere".
   */
  availableCountries?: string[]
  /** The raw restriction, so the UI can say *why* a track was filtered. */
  regionRestriction?: { blocked?: string[]; allowed?: string[] }
  /**
   * `snippet.liveBroadcastContent` ∈ none | upcoming | live. Free, and
   * present on every snippet — unlike `liveBroadcasts.list`, which only
   * sees what is live right now.
   */
  liveBroadcastContent?: 'none' | 'upcoming' | 'live'
  /** `snippet.tags` — best-effort, optional enrichment only. */
  tags?: string[]
  madeForKids?: boolean
  embeddable?: boolean
  license?: string
}

export type Candidate = Track & {
  sources: SourceKind[]
  score: number
  reasons: ScoreReason[]
  versionTags: VersionTag[]
  official: boolean
}

export type DiscoveryOptions = {
  /** How many tracks the final playlist should hold (5–50). */
  count: number
  /** 0 = strict similarity, 100 = exploration (PLAN §13.1.6). */
  breadth: number

  /* ── v1 toggles, still sent by the existing client ─────────────── */
  includeLive: boolean
  includeRemix: boolean
  includeAcoustic: boolean
  hideSeedArtist: boolean
  maxPerArtist: number
  includePopularity: boolean

  /* ── v2 controls (PLAN §13.3) ───────────────────────────────────── */
  /** 1 = one hop from the seed, 2 = two hops. */
  depth: 1 | 2
  /** Explicit allow-list of derivative versions. */
  includeVersions: VersionTag[]
  /** Duration window in seconds. */
  durationSec?: { min: number; max: number }
  /** Inclusive year range. */
  publishedRange?: { from: number; to: number }
  languages?: string[]
  /** Drop candidates that already exist in the user's library. */
  skipAlreadyInLibrary: boolean
  /** Skip `madeForKids` content and the explicit heuristic. */
  familyMode: boolean
  /** Skip items that are not available in the user's region. */
  regionSafeOnly: boolean
  /** Reward recent releases. */
  includeNewReleases: boolean
  /** Final ordering of the selected tracks. */
  order: Ordering
  /** Seed for the deterministic shuffle. */
  shuffleSeed?: number
  /** Blocked artists (canonical slug form). */
  blockedArtists: string[]
  /** Blocked keywords, matched case-insensitively against the title. */
  blockedKeywords: string[]
}

export const DEFAULT_OPTIONS: DiscoveryOptions = {
  count: 20,
  breadth: 50,
  includeLive: false,
  includeRemix: false,
  includeAcoustic: false,
  hideSeedArtist: false,
  maxPerArtist: 2,
  includePopularity: false,
  depth: 1,
  includeVersions: [],
  durationSec: { min: 45, max: 20 * 60 },
  publishedRange: undefined,
  languages: [],
  skipAlreadyInLibrary: false,
  familyMode: false,
  regionSafeOnly: false,
  includeNewReleases: false,
  order: 'score',
  shuffleSeed: undefined,
  blockedArtists: [],
  blockedKeywords: [],
}

export type PlaylistPrivacy = 'private' | 'unlisted' | 'public'

export type SeedKind = 'video' | 'playlist' | 'artist' | 'profile'

/**
 * A seed is a *profile*, not a single track (PLAN §13.2). A pasted playlist
 * becomes a centroid of up to 50 reference tracks.
 */
export type SeedProfile = {
  kind: SeedKind
  videoIds: string[]
  artistWeights: Map<string, number>
  topicIds: Set<string>
  topicCategories: Set<string>
  meanDurationSec: number
  /** The reference tracks themselves. */
  tracks: Track[]
  /** Display name for the centroid, e.g. the playlist title. */
  label: string
}

/** JSON-safe projection of `SeedProfile` for API responses. */
export type SeedProfileJson = {
  kind: SeedKind
  videoIds: string[]
  artistWeights: Array<[string, number]>
  topicIds: string[]
  topicCategories: string[]
  meanDurationSec: number
  tracks: Track[]
  label: string
}

export function seedProfileToJson(profile: SeedProfile): SeedProfileJson {
  return {
    kind: profile.kind,
    videoIds: profile.videoIds,
    artistWeights: [...profile.artistWeights.entries()],
    topicIds: [...profile.topicIds],
    topicCategories: [...profile.topicCategories],
    meanDurationSec: profile.meanDurationSec,
    tracks: profile.tracks,
    label: profile.label,
  }
}

export type ScoreProfile = 'strict' | 'balanced' | 'explore'
