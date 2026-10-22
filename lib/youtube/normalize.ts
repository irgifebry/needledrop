/**
 * Canonical track identity (PLAN §13.1.1).
 *
 * Everything in this module is a pure function of the strings it is handed:
 * no I/O, no environment, no clock. That is what makes the identity layer
 * testable and what makes the dedupe key stable across requests.
 *
 * The hard part is *precision*. A song uploaded to six channels is one track,
 * but a track whose title merely contains the word "Live" is not a live
 * recording. Version tags are therefore only recognised when they come from
 * a bracketed group or from an explicit trailing marker — never from the
 * ordinary words of a title.
 */

import { DERIVATIVE_VERSION_TAGS, type VersionTag } from './types'

/* ── text folding ─────────────────────────────────────────────────────── */

/** Lowercase + diacritic removal — the canonical form for every comparison. */
export function foldText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/** Slug used inside dedupe keys: `slug('The Weeknd') === 'the-weeknd'`. */
export function slug(value: string): string {
  return foldText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * The canonical artist key (PLAN §13.1.1).
 *
 * Case, spacing, diacritics and a leading "the" are noise, so `The Weeknd`,
 * `Weeknd` and `weeknd` collapse onto one key. This is what makes the
 * per-artist diversity cap and the seed-artist rule count *artists* instead
 * of counting upload channels.
 */
export function nameKey(value: string): string {
  const folded = foldText(value).replace(/^the[\s\-_.]+/, '')
  return folded.replace(/[^a-z0-9]+/g, '')
}

/**
 * `TheWeeknd` → `The Weeknd`.
 *
 * YouTube channel names are usually a run-together brand name; recovering the
 * spaces is what makes the channel-derived artist readable and comparable.
 */
export function humanizeChannelName(name: string): string {
  return name
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/* ── channel names ────────────────────────────────────────────────────── */

/**
 * Strips the channel decorations that are not part of the artist name.
 *
 * `- Topic`, `VEVO`, `Official`, `Records`, `Music` and `Label` are upload
 * conventions, not names.
 */
export function tidyChannel(channelTitle: string): string {
  return channelTitle
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/\s*VEVO$/i, '')
    .replace(/\s+Official$/i, '')
    .replace(/\s+Records$/i, '')
    .replace(/\s+Music$/i, '')
    .replace(/\s+Label$/i, '')
    .trim()
}

/** The artist name behind a channel, with the decorations removed. */
export function channelArtistName(channelTitle: string): string {
  return humanizeChannelName(tidyChannel(channelTitle))
}

/**
 * Whether a channel looks like an official artist channel.
 *
 * `- Topic` and `VEVO` are the two channels YouTube itself creates for an
 * artist; `Official` / `Records` / `Music` are self-declared and weaker.
 */
export function isOfficialChannel(channelTitle: string): boolean {
  return (
    /-\s*Topic$/i.test(channelTitle) ||
    /VEVO$/i.test(channelTitle) ||
    /Official/i.test(channelTitle) ||
    /Records$/i.test(channelTitle) ||
    /Music$/i.test(channelTitle)
  )
}

/* ── bracketed groups ─────────────────────────────────────────────────── */

/** `(…)`, `[…]`, `{…}`, `【…】` and `（…）` — where uploaders put metadata. */
const BRACKET_GROUP = /[([{【（]\s*([^)\]}】）]*?)\s*[)\]}】）]/g

/**
 * Splits a raw title into its plain text and the bracketed groups.
 *
 * The groups are kept because they are where the version information lives
 * ("(Live)", "(Official Video)", "(Remastered 2011)").
 */
export function splitTags(raw: string): { clean: string; tags: string[] } {
  const tags: string[] = []
  const clean = raw.replace(BRACKET_GROUP, (_match, inner: string) => {
    tags.push(inner.trim())
    return ' '
  })
  return { clean: clean.replace(/\s{2,}/g, ' ').trim(), tags }
}

/* ── version vocabulary ───────────────────────────────────────────────── */

/**
 * The full version-tag vocabulary (PLAN §14.2).
 *
 * Every rule is applied (not first-match) so "Official Music Video" yields
 * `official` *and* `video`. `karaoke` is deliberately not a synonym for
 * `instrumental` and `unplugged` not a synonym for `acoustic`: the user can
 * allow one without the other.
 */
const TAG_RULES: Array<[VersionTag, RegExp]> = [
  ['4k', /\b4k\b/],
  ['hd', /\b(?:hd|hq)\b/],
  ['visualizer', /\bvisuali[sz]er\b/],
  ['lyrics', /\blyrics?\b/],
  ['nightcore', /\bnightcore\b/],
  ['spedUp', /\bsped\s*up\b|\b8d\s*audio\b|\bslowed\b/],
  ['reverb', /\breverb\b/],
  ['unplugged', /\bunplugged\b/],
  ['acoustic', /\bacoustic\b/],
  ['instrumental', /\binstrumental\b/],
  ['karaoke', /\bkaraoke\b|\bin the style of\b/],
  ['remix', /\bremix\b|\bbootleg\b|\bmashup\b/],
  ['live', /\blive\b|\bconcert\b/],
  ['cover', /\bcover(?:ed)?\b/],
  ['remaster', /\bremaster(?:ed)?\b/],
  ['official', /\bofficial\b/],
  ['audio', /\baudio\b/],
  ['video', /\bvideo\b|\bm\/v\b/],
  ['explicit', /\bexplicit\b/],
  ['clean', /\bclean\b/],
]

type MarkerRule = {
  /** Tags the phrase contributes. */
  tags: VersionTag[]
  /** The phrase, anchored at the end of the title. */
  pattern: RegExp
  /**
   * `true` when the phrase is distinctive enough to be recognised even when
   * it is only separated by a space. Single words such as "live" or "remix"
   * are *not*: they collide with real song titles ("Live", "Remix"), so they
   * only count when a dash or bracket clearly delimits them.
   */
  standalone: boolean
}

const MARKER_RULES: MarkerRule[] = [
  { tags: ['official', 'video', 'lyrics'], pattern: /\bofficial\s+lyric\s+video$/, standalone: true },
  { tags: ['official', 'video'], pattern: /\bofficial\s+music\s+video$/, standalone: true },
  { tags: ['official', 'video'], pattern: /\bofficial\s+video$/, standalone: true },
  { tags: ['official', 'audio'], pattern: /\bofficial\s+audio$/, standalone: true },
  { tags: ['official', 'visualizer'], pattern: /\bofficial\s+visuali[sz]er$/, standalone: true },
  { tags: ['lyrics', 'video'], pattern: /\blyric\s+video$/, standalone: true },
  { tags: ['video'], pattern: /\bmusic\s+video$/, standalone: true },
  { tags: ['video'], pattern: /\bvideo$/, standalone: true },
  { tags: ['lyrics'], pattern: /\blyrics?$/, standalone: true },
  { tags: ['audio'], pattern: /\baudio\s+only$/, standalone: true },
  { tags: ['audio'], pattern: /\baudio$/, standalone: true },
  { tags: ['visualizer'], pattern: /\bvisuali[sz]er$/, standalone: true },
  { tags: ['video'], pattern: /\bm\/v$/, standalone: true },
  { tags: ['4k'], pattern: /\b4k$/, standalone: true },
  { tags: ['hd'], pattern: /\b(?:hd|hq)$/, standalone: true },
  { tags: ['remaster'], pattern: /\bremaster(?:ed)?\s+\d{4}$/, standalone: true },
  { tags: ['remaster'], pattern: /\bremaster(?:ed)?$/, standalone: true },
  { tags: ['explicit'], pattern: /\bexplicit$/, standalone: true },
  { tags: ['clean'], pattern: /\bclean$/, standalone: true },
  { tags: ['live'], pattern: /\blive\s+at\s+.+$/, standalone: true },
  { tags: ['karaoke'], pattern: /\bin\s+the\s+style\s+of\s+.+$/, standalone: true },
  { tags: ['spedUp'], pattern: /\bslowed\s*\+\s*reverb$/, standalone: true },
  { tags: ['spedUp'], pattern: /\bsped\s*up$/, standalone: true },
  { tags: ['spedUp'], pattern: /\bslowed$/, standalone: true },
  { tags: ['spedUp'], pattern: /\b8d\s*audio$/, standalone: true },

  /* Single-word derivative markers: separator-delimited only. */
  { tags: ['live'], pattern: /\blive$/, standalone: false },
  { tags: ['remix'], pattern: /\bremix$/, standalone: false },
  { tags: ['acoustic'], pattern: /\bacoustic$/, standalone: false },
  { tags: ['instrumental'], pattern: /\binstrumental$/, standalone: false },
  { tags: ['karaoke'], pattern: /\bkaraoke$/, standalone: false },
  { tags: ['cover'], pattern: /\bcover$/, standalone: false },
  { tags: ['unplugged'], pattern: /\bunplugged$/, standalone: false },
  { tags: ['nightcore'], pattern: /\bnightcore$/, standalone: false },
  { tags: ['reverb'], pattern: /\breverb$/, standalone: false },
]

/** Separators that may introduce a title half: `Artist - Title`. */
const SEPARATOR_PATTERNS = [/\s+[-–—]\s+/, /\s+\|\s+/, /\s+_\s+/, /[-–—]/]

type HeadTail = { head: string; tail: string }

/** Splits `Artist - Title` at the first strong separator. */
function splitHeadTail(text: string): HeadTail | null {
  for (const separator of SEPARATOR_PATTERNS) {
    const match = separator.exec(text)
    if (!match) continue
    const head = text.slice(0, match.index).trim()
    const tail = text.slice(match.index + match[0].length).trim()
    if (head && tail) return { head, tail }
  }
  return null
}

/** Whether the text before a marker ends in a delimiter (`Song - Live`). */
function isSeparatorDelimited(before: string): boolean {
  const trimmed = before.replace(/\s+$/, '')
  if (!trimmed) return false
  return /[-–—|:([]$/.test(trimmed)
}

/** Whether the channel's artist matches the head, i.e. the head *is* the artist. */
function channelMatchesHead(head: string, channelTitle?: string): boolean {
  if (!channelTitle) return false
  const channelArtist = nameKey(channelArtistName(channelTitle))
  const headKey = nameKey(head)
  if (!channelArtist || !headKey) return false
  return headKey === channelArtist || headKey.includes(channelArtist) || channelArtist.includes(headKey)
}

type MarkerMatch = { tags: VersionTag[]; start: number; text: string; standalone: boolean }

function matchTrailingMarker(text: string): MarkerMatch | null {
  for (const rule of MARKER_RULES) {
    const match = rule.pattern.exec(text)
    if (!match) continue
    return {
      tags: rule.tags,
      start: match.index,
      text: match[0].trim(),
      standalone: rule.standalone,
    }
  }
  return null
}

/**
 * Whether a trailing marker is really the *title* of the track.
 *
 * `Vampire Weekend - Live` is a song called "Live"; `Vampire Weekend - Live
 * (Live)` is a live recording. When the marker occupies the whole title half
 * and the channel agrees that the head is the artist, the marker is the
 * title. Without a channel the marker wins, because a dash-delimited marker
 * is the documented convention and the head is usually the artist anyway.
 */
function markerIsWholeTitleHalf(text: string, match: MarkerMatch, channelTitle?: string): boolean {
  const split = splitHeadTail(text)
  if (!split) return false
  if (split.tail.toLowerCase() !== match.text.toLowerCase()) return false
  return channelMatchesHead(split.head, channelTitle)
}

/**
 * Collects the version tags carried by trailing markers.
 *
 * Only markers that are clearly delimited count; a bare trailing word such as
 * "Live" in "The Way I Live" is left alone, because mistaking a song title
 * for a version marker silently deletes the song from the results.
 */
function trailingMarkerTags(text: string, channelTitle?: string): VersionTag[] {
  const tags: VersionTag[] = []
  let rest = text
  for (let round = 0; round < 4; round += 1) {
    const match = matchTrailingMarker(rest)
    if (!match) break
    const before = rest.slice(0, match.start)
    const core = before.replace(/[\s\-–—|:,.]+$/, '')
    if (!core) break
    if (!match.standalone && !isSeparatorDelimited(before)) break
    if (round === 0 && markerIsWholeTitleHalf(text, match, channelTitle)) break
    tags.push(...match.tags)
    rest = core
  }
  return tags
}

/**
 * The version tags of a raw title (PLAN §13.1.1).
 *
 * Tags are recognised inside bracketed groups and from explicit trailing
 * markers. A word in the middle of a title is never a version tag, so the
 * track called "Live" survives the version filter.
 *
 * @param raw The raw YouTube title.
 * @param channelTitle Optional channel name; it disambiguates
 *   `Artist - Live` (a song called "Live") from `Artist - Live` (a marker).
 */
export function extractVersionTags(raw: string, channelTitle?: string): VersionTag[] {
  const found = new Set<VersionTag>()
  const { clean, tags } = splitTags(raw)

  for (const tag of tags) {
    const folded = foldText(tag)
    for (const [version, pattern] of TAG_RULES) {
      if (pattern.test(folded)) found.add(version)
    }
  }

  for (const version of trailingMarkerTags(foldText(clean), channelTitle)) {
    found.add(version)
  }

  return [...found]
}

/* ── title normalisation ──────────────────────────────────────────────── */

export type NormalizedTitle = {
  /** The title without metadata, features or diacritics. Never empty. */
  clean: string
  /** Every version tag the title carries. */
  versionTags: Set<VersionTag>
  /** The featured artist, when the title names one. */
  featureArtist: string | null
}

/** Words that are never a featured artist ("Song with Me"). */
const FEATURE_STOPWORDS = new Set([
  'me',
  'you',
  'us',
  'them',
  'him',
  'her',
  'it',
  'all',
  'everyone',
  'myself',
  'yourself',
  'the world',
  'no one',
])

/** Cleans the captured name of a feature. */
function cleanFeatureName(value: string): string {
  return value
    .replace(/\s*[([][^)\]]*[)\]]\s*$/, '')
    .replace(/[)\]}]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * The artist featured on a track, when the title says so.
 *
 * `feat.`, `ft.` and `featuring` are unambiguous. `with` only counts when
 * what follows looks like a name, so "Dance With Me" keeps its title.
 */
export function extractFeatureArtist(title: string): string | null {
  const explicit = /(?:feat\.?|ft\.)\s+(.+)$/i.exec(title)
  if (explicit) {
    const name = cleanFeatureName(explicit[1])
    if (name) return name
  }

  const featuring = /\bfeaturing\s+(.+)$/i.exec(title)
  if (featuring) {
    const name = cleanFeatureName(featuring[1])
    if (name) return name
  }

  const withMatch = /\bwith\s+(.+)$/i.exec(title)
  if (withMatch) {
    const name = cleanFeatureName(withMatch[1])
    if (name && !FEATURE_STOPWORDS.has(name.toLowerCase())) return name
  }

  return null
}

/**
 * Strips the metadata, the feature and the separators from a title.
 *
 * The feature is only removed when it was really a feature, so "Dance With
 * Me" keeps its title.
 */
function normalizeCore(text: string, featureArtist: string | null): string {
  let value = text.replace(/[–—]/g, '-')
  if (featureArtist) {
    value = value.replace(/\s+(?:feat\.?|ft\.?|featuring|with)\s+.+$/i, '')
  }
  return value
    .replace(/^[\s\-–—|:,.!?]+/, '')
    .replace(/[\s\-–—|:,.!?]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * The canonical form of a title (PLAN §13.1.1).
 *
 * Bracketed groups become version tags, a trailing `feat. X` becomes
 * `featureArtist`, separators are unified and the result is lowercased
 * without diacritics. The `clean` value is never empty — a title made only
 * of metadata falls back to the trimmed raw string.
 */
export function normalizeTitle(raw: string, channelTitle?: string): NormalizedTitle {
  const { clean: bracketClean, tags } = splitTags(raw)

  const versionTags = new Set<VersionTag>()
  for (const tag of tags) {
    const folded = foldText(tag)
    for (const [version, pattern] of TAG_RULES) {
      if (pattern.test(folded)) versionTags.add(version)
    }
  }
  for (const version of trailingMarkerTags(foldText(bracketClean), channelTitle)) {
    versionTags.add(version)
  }

  const featureArtist = extractFeatureArtist(raw)
  const clean = foldText(normalizeCore(bracketClean, featureArtist))

  return {
    clean: clean.length > 0 ? clean : foldText(raw.trim()),
    versionTags,
    featureArtist,
  }
}

/* ── artist / title split ─────────────────────────────────────────────── */

export type TitleParts = {
  artist: string
  title: string
  /** `true` when the artist came from the title, not from the channel. */
  artistFromTitle: boolean
}

/**
 * Splits a raw title into artist and title.
 *
 * The candidates are tried in the order the plan lists them: `Artist - Title`,
 * `Artist | Title`, `Artist _ Title`, `Title by Artist`. When none matches,
 * the artist is derived from the channel name.
 */
export function parseTitleParts(title: string, channelTitle: string): TitleParts {
  const { clean } = splitTags(title)

  for (const separator of SEPARATOR_PATTERNS) {
    const match = separator.exec(clean)
    if (!match) continue
    const head = clean.slice(0, match.index).trim()
    const tail = clean.slice(match.index + match[0].length).trim()
    if (!head || !tail || head.length > 60) continue
    const artist = head.replace(/\s*feat\.?\s.*$/i, '').trim()
    if (!artist) continue
    return { artist, title: tail, artistFromTitle: true }
  }

  const byMatch = /^(.*?)\s+by\s+(.+)$/i.exec(clean)
  if (byMatch) {
    const byTitle = byMatch[1].trim()
    const byArtist = byMatch[2].trim()
    if (byTitle && byArtist) return { artist: byArtist, title: byTitle, artistFromTitle: true }
  }

  return { artist: tidyChannel(channelTitle), title: clean, artistFromTitle: false }
}

/**
 * The artist and title of a video (PLAN §13.1.1).
 *
 * Kept as the public entry point because the whole app parses titles this
 * way; the extra `TitleParts` shape only exists for callers that need to
 * know *where* the artist came from.
 */
export function parseArtistTitle(
  title: string,
  channelTitle: string,
): { artist: string; title: string } {
  const parts = parseTitleParts(title, channelTitle)
  return { artist: parts.artist, title: parts.title }
}

/**
 * The best-known artist for a track.
 *
 * The title wins when it names one; otherwise the channel does. Used for the
 * per-artist diversity cap, where a channel name would over-count.
 */
export function canonicalArtistOf(rawTitle: string, channelTitle: string): string {
  const parts = parseTitleParts(rawTitle, channelTitle)
  if (parts.artistFromTitle) return parts.artist
  return channelArtistName(channelTitle) || parts.artist
}

/**
 * The canonical artist for a hydrated track.
 *
 * A track that already carries a proper `artist` (the demo catalogue, or a
 * hydrator that parsed the title) keeps it; otherwise the artist is derived
 * from the title or the channel.
 */
export function canonicalTrackArtist(track: {
  title: string
  channelTitle: string
  artist?: string
}): string {
  const parts = parseTitleParts(track.title, track.channelTitle)
  if (parts.artistFromTitle) return parts.artist
  const declared = track.artist?.trim()
  if (declared && declared !== track.channelTitle && nameKey(declared).length >= 2) {
    return declared
  }
  return channelArtistName(track.channelTitle) || parts.artist
}

/**
 * The canonical title of a raw video title.
 *
 * Unlike `normalizeTitle` this also drops the `Artist - ` prefix, so it is
 * the right value for the dedupe key: two uploads of the same song must
 * produce the same title half whatever the channel called itself.
 */
export function canonicalTitleOf(rawTitle: string, channelTitle: string): string {
  const parts = parseTitleParts(rawTitle, channelTitle)
  const featureArtist = extractFeatureArtist(rawTitle)
  const clean = foldText(normalizeCore(parts.title, featureArtist))
  return clean.length > 0 ? clean : foldText(rawTitle.trim())
}

/* ── identity keys ────────────────────────────────────────────────────── */

/** The dedupe key of a song: `artist::title`, whatever the channel. */
export function trackKeyOf(artist: string, title: string): string {
  return `${slug(artist)}::${slug(title)}`
}

/**
 * The dedupe key that keeps a derivative recording distinct.
 *
 * A live take or a remix is a different recording, so it must not be deduped
 * against the studio version — but it is still the same song, so it keeps the
 * canonical `trackKey` as its prefix.
 */
export function versionKeyOf(
  artist: string,
  title: string,
  versionTags: Iterable<VersionTag>,
): string {
  const base = trackKeyOf(artist, title)
  const derivative = [...new Set(versionTags)]
    .filter((tag) => DERIVATIVE_VERSION_TAGS.includes(tag))
    .sort()
  return derivative.length > 0 ? `${base}::${derivative.join('+')}` : base
}

/* ── version policy ───────────────────────────────────────────────────── */

/** The v2 allow-list: only the listed derivative versions survive. */
export type VersionAllowList = {
  includeVersions: VersionTag[]
}

/** The v1 policy, still accepted so older callers keep compiling. */
export type VersionPolicy = {
  includeLive: boolean
  includeRemix: boolean
  includeAcoustic: boolean
  includeInstrumental?: boolean
  includeKaraoke?: boolean
  includeCover?: boolean
  includeSpedUp?: boolean
}

type VersionTagInput =
  | VersionTag[]
  | Set<VersionTag>
  | { versionTags?: VersionTag[] | Set<VersionTag> }
  | { tags?: VersionTag[] | Set<VersionTag> }

function readVersionTags(input: VersionTagInput): VersionTag[] {
  if (Array.isArray(input)) return input
  if (input instanceof Set) return [...input]
  if (input && typeof input === 'object') {
    const object = input as { versionTags?: VersionTag[] | Set<VersionTag>; tags?: VersionTag[] | Set<VersionTag> }
    if (object.versionTags) {
      return Array.isArray(object.versionTags) ? object.versionTags : [...object.versionTags]
    }
    if (object.tags) return Array.isArray(object.tags) ? object.tags : [...object.tags]
  }
  return []
}

/**
 * Whether a track's version tags survive the policy.
 *
 * The v2 policy is an explicit allow-list of derivative versions; the v1
 * booleans are still honoured so old callers keep working.
 */
export function isVersionAllowed(input: VersionTagInput, policy: VersionAllowList): boolean
export function isVersionAllowed(input: VersionTagInput, policy: VersionPolicy): boolean
export function isVersionAllowed(
  input: VersionTagInput,
  policy: VersionAllowList | VersionPolicy,
): boolean {
  const tags = new Set(readVersionTags(input))

  if ('includeVersions' in policy && Array.isArray(policy.includeVersions)) {
    const allowed = new Set(policy.includeVersions)
    for (const tag of tags) {
      if (!DERIVATIVE_VERSION_TAGS.includes(tag)) continue
      if (!allowed.has(tag)) return false
    }
    return true
  }

  const legacy = policy as VersionPolicy
  if (!legacy.includeLive && tags.has('live')) return false
  if (!legacy.includeRemix && tags.has('remix')) return false
  if (!legacy.includeAcoustic && tags.has('acoustic')) return false
  if (legacy.includeInstrumental === false && tags.has('instrumental')) return false
  if (legacy.includeKaraoke === false && tags.has('karaoke')) return false
  if (legacy.includeCover === false && tags.has('cover')) return false
  if (legacy.includeSpedUp === false && (tags.has('spedUp') || tags.has('nightcore'))) return false
  return true
}
