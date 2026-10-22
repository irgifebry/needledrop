/**
 * Availability, region and language flags (PLAN §13.1.7).
 *
 * A track that cannot be played in the visitor's region is a broken playlist
 * entry, and a track the visitor cannot embed is a broken preview. The
 * engine therefore needs a plain "is this playable here?" answer.
 *
 * The Data API does not actually expose `snippet.availableCountries`; the
 * real field is `contentDetails.regionRestriction` (`blocked` / `allowed`).
 * Both shapes are accepted so a hydrator can pass either, and *absent* data
 * always means "allowed" — guessing would silently drop good tracks.
 */

export type RegionAwareTrack = {
  /** Country codes the track may be played in. Empty means "not reported". */
  availableCountries?: string[]
  /** `snippet.defaultLanguage`. */
  language?: string
  /** The real API shape: `contentDetails.regionRestriction`. */
  regionRestriction?: {
    blocked?: string[]
    allowed?: string[]
  }
}

function normalizeCountry(code: string): string {
  return code.trim().toUpperCase()
}

/**
 * Whether a track is playable for the visitor.
 *
 * Unknown ⇒ allowed: a missing restriction report is not evidence of a
 * block, and the cost of guessing wrong (a silently unplayable track) is
 * higher than the cost of keeping one.
 */
export function isRegionSafe(track: RegionAwareTrack, userRegion?: string | null): boolean {
  const region = userRegion ? normalizeCountry(userRegion) : ''
  if (!region) return true

  const restriction = track.regionRestriction
  if (restriction) {
    const allowed = restriction.allowed?.map(normalizeCountry) ?? []
    if (allowed.length > 0) return allowed.includes(region)
    const blocked = restriction.blocked?.map(normalizeCountry) ?? []
    if (blocked.length > 0) return !blocked.includes(region)
  }

  const countries = track.availableCountries?.map(normalizeCountry) ?? []
  if (countries.length === 0) return true
  return countries.includes(region)
}

/**
 * A human label for the availability of a track.
 *
 * "No region restriction reported" is deliberately not "available
 * everywhere" — the API simply did not tell us.
 */
export function regionLabel(countries: string[] | undefined | null): string {
  if (!countries || countries.length === 0) return 'No region restriction reported'
  if (countries.length === 1) return `Available in ${countries.length} country`
  return `Available in ${countries.length} countries`
}

/**
 * Whether a track matches the requested languages.
 *
 * An unknown language is kept: `snippet.defaultLanguage` is frequently
 * missing, and a filter that empties the playlist because the API was
 * terse is worse than no filter at all.
 */
export function languageMatches(
  track: RegionAwareTrack,
  languages: string[] | undefined | null,
): boolean {
  if (!languages || languages.length === 0) return true
  const language = track.language?.trim().toLowerCase()
  if (!language) return true
  return languages.some((candidate) => candidate.trim().toLowerCase() === language)
}
