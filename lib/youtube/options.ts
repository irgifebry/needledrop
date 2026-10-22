import { z } from 'zod'

import { DEFAULT_OPTIONS, DERIVATIVE_VERSION_TAGS, VERSION_TAGS, type DiscoveryOptions } from './types'

/**
 * Runtime validation for discovery options (PLAN §14.2, §15).
 *
 * Two shapes arrive here:
 *  - the **v1** options the existing client sends (`includeLive`,
 *    `includeRemix`, `includeAcoustic`, `includePopularity`), and
 *  - the **v2** options from the plan (an explicit `includeVersions`
 *    allow-list, filters, ordering).
 *
 * Both are accepted; the result is always a fully populated
 * `DiscoveryOptions`, so no downstream code has to guess whether a field is
 * missing.
 *
 * **Every field falls back on its own.** A client that sends `count: 3`
 * (below the floor of 5) must not lose the other twenty options it also
 * sent — so each field carries its own `.catch()` and its own clamp, and a
 * single bad value costs exactly that value. Silently resetting the whole
 * object would be a quiet, expensive bug: the user would get twenty tracks
 * instead of the five they asked for and no error to explain why.
 */

const VersionTagSchema = z.enum(VERSION_TAGS as [string, ...string[]])

const DurationRangeSchema = z.object({
  min: z.number().int().min(0).max(86_400),
  max: z.number().int().min(0).max(86_400),
})

const PublishedRangeSchema = z.object({
  from: z.number().int().min(1900).max(2200),
  to: z.number().int().min(1900).max(2200),
})

const RawOptionsSchema = z.object({
  count: z.number().int().min(5).max(50).catch(DEFAULT_OPTIONS.count),
  breadth: z.number().min(0).max(100).catch(DEFAULT_OPTIONS.breadth),
  depth: z.union([z.literal(1), z.literal(2)]).catch(DEFAULT_OPTIONS.depth),

  /* v1 — `optional` so "not sent" stays distinguishable from "sent as false" */
  includeLive: z.boolean().optional().catch(undefined),
  includeRemix: z.boolean().optional().catch(undefined),
  includeAcoustic: z.boolean().optional().catch(undefined),
  hideSeedArtist: z.boolean().optional().catch(undefined),
  maxPerArtist: z.number().int().min(0).max(10).catch(DEFAULT_OPTIONS.maxPerArtist),
  includePopularity: z.boolean().optional().catch(undefined),

  /* v2 */
  includeVersions: z.array(VersionTagSchema).max(50).optional().catch(undefined),
  durationSec: DurationRangeSchema.optional().catch(undefined),
  publishedRange: PublishedRangeSchema.optional().catch(undefined),
  languages: z.array(z.string().min(2).max(8)).max(20).optional().catch(undefined),
  skipAlreadyInLibrary: z.boolean().optional().catch(undefined),
  familyMode: z.boolean().optional().catch(undefined),
  regionSafeOnly: z.boolean().optional().catch(undefined),
  includeNewReleases: z.boolean().optional().catch(undefined),
  order: z.enum(['score', 'energyArc', 'releaseDate', 'artist', 'shuffle']).catch(DEFAULT_OPTIONS.order),
  shuffleSeed: z.number().int().optional().catch(undefined),
  blockedArtists: z.array(z.string().min(1).max(120)).max(200).optional().catch(undefined),
  blockedKeywords: z.array(z.string().min(1).max(120)).max(200).optional().catch(undefined),
})

export type RawDiscoveryOptions = z.infer<typeof RawOptionsSchema>

/** Folds the v1 booleans into the v2 allow-list. */
export function versionsFromLegacy(input: {
  includeLive?: boolean
  includeRemix?: boolean
  includeAcoustic?: boolean
}): string[] {
  const allowed: string[] = []
  if (input.includeLive) allowed.push('live')
  if (input.includeRemix) allowed.push('remix')
  if (input.includeAcoustic) allowed.push('acoustic')
  return allowed
}

/** The raw input as a plain record, so "was this field sent?" is answerable. */
function asRecord(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {}
}

/**
 * Parse anything into a complete `DiscoveryOptions`.
 *
 * The allow-list and the legacy booleans are two spellings of the same
 * thing, so they are reconciled in both directions:
 *
 * - an explicit `includeVersions` wins, and the legacy booleans are then
 *   *mirrored* from it (`['live']` ⇒ `includeLive: true`);
 * - otherwise the legacy booleans decide the allow-list.
 *
 * A field that was never sent keeps its default; a field that was sent with
 * a nonsense value falls back on its own. Neither takes the rest of the
 * options down with it.
 */
export function normalizeDiscoveryOptions(input: unknown): DiscoveryOptions {
  // The schema is total — every field has a fallback — so this parse only
  // fails when `input` is not an object at all.
  const parsed = RawOptionsSchema.safeParse(input ?? {})
  const raw: RawDiscoveryOptions = parsed.success
    ? parsed.data
    : (RawOptionsSchema.parse({}) as RawDiscoveryOptions)

  const provided = asRecord(input)
  const sentAllowList =
    Array.isArray(provided.includeVersions) && provided.includeVersions.length > 0

  const legacyVersions = versionsFromLegacy(raw)
  const includeVersions = sentAllowList
    ? ([...new Set(raw.includeVersions ?? [])] as DiscoveryOptions['includeVersions'])
    : ([...new Set(legacyVersions)] as DiscoveryOptions['includeVersions'])

  const durationSec = raw.durationSec
    ? {
        min: Math.min(raw.durationSec.min, raw.durationSec.max),
        max: Math.max(raw.durationSec.min, raw.durationSec.max),
      }
    : DEFAULT_OPTIONS.durationSec

  const publishedRange = raw.publishedRange
    ? {
        from: Math.min(raw.publishedRange.from, raw.publishedRange.to),
        to: Math.max(raw.publishedRange.from, raw.publishedRange.to),
      }
    : undefined

  return {
    count: raw.count ?? DEFAULT_OPTIONS.count,
    breadth: raw.breadth ?? DEFAULT_OPTIONS.breadth,
    includeLive: raw.includeLive ?? includeVersions.includes('live'),
    includeRemix: raw.includeRemix ?? includeVersions.includes('remix'),
    includeAcoustic: raw.includeAcoustic ?? includeVersions.includes('acoustic'),
    hideSeedArtist: raw.hideSeedArtist ?? DEFAULT_OPTIONS.hideSeedArtist,
    maxPerArtist: raw.maxPerArtist ?? DEFAULT_OPTIONS.maxPerArtist,
    includePopularity: raw.includePopularity ?? DEFAULT_OPTIONS.includePopularity,
    depth: raw.depth ?? DEFAULT_OPTIONS.depth,
    includeVersions,
    durationSec,
    publishedRange,
    languages: raw.languages ?? [],
    skipAlreadyInLibrary: raw.skipAlreadyInLibrary ?? DEFAULT_OPTIONS.skipAlreadyInLibrary,
    familyMode: raw.familyMode ?? DEFAULT_OPTIONS.familyMode,
    regionSafeOnly: raw.regionSafeOnly ?? DEFAULT_OPTIONS.regionSafeOnly,
    includeNewReleases: raw.includeNewReleases ?? DEFAULT_OPTIONS.includeNewReleases,
    order: raw.order ?? DEFAULT_OPTIONS.order,
    shuffleSeed: raw.shuffleSeed,
    blockedArtists: raw.blockedArtists ?? [],
    blockedKeywords: raw.blockedKeywords ?? [],
  }
}

/** Derivative versions the user has *not* opted into are dropped by default. */
export function isDerivativeVersion(tag: string): boolean {
  return DERIVATIVE_VERSION_TAGS.includes(tag as (typeof DERIVATIVE_VERSION_TAGS)[number])
}
