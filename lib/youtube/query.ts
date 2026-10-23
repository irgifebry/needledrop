/**
 * Query intent and relevance (PLAN §4 stage 1).
 *
 * Pure by design: no I/O, no fetch, no node:*. The search path and the
 * discovery path both need to know how well a track answers what was
 * typed, and neither should have to re-derive it.
 */

import { parseChannelName } from '@/lib/youtube/artist'
import { foldText } from '@/lib/youtube/normalize'
import type { Track } from '@/lib/youtube/types'

/* ── vocabulary ─────────────────────────────────────────────────────────── */

/** A word: letters and digits, nothing else. */
const WORD = /[\p{L}\p{N}]+/gu

/**
 * Words that carry no signal when a query is matched against a track.
 *
 * The same list lives in `lib/youtube/resolve.ts`, but it is repeated here
 * on purpose: that module belongs to the seed-resolution layer and this one
 * to the query layer, and neither has to reach into the other for a handful
 * of words.
 */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'of', 'in', 'on', 'and', 'to', 'for', 'by', 'or', 'my', 'me',
  'with', 'vs', 'feat', 'ft', 'at', 'is', 'as', 'from', 'that', 'this', 'it',
])

/* ── weights ────────────────────────────────────────────────────────────── */

/**
 * How much each signal is worth (PLAN §4 stage 1).
 *
 * The scale is deliberate: every weight is larger than the sum of the ones
 * below it, so a track that matches an artist always outranks a track that
 * only matches a genre, a genre always outranks a title that merely repeats
 * the query, and so on. The two halves of the scale are also separated
 * inside each band: a partial artist match (0.5) still beats a perfect
 * genre match.
 */
const WEIGHT_ARTIST = 1000
const WEIGHT_GENRE = 100
const WEIGHT_TITLE = 10

/**
 * The floor of every score.
 *
 * A track that matches neither the artist nor the genre is still worth
 * returning — "lofi" lives under "Electronic music" in the Data API, and a
 * query the categories do not cover must not come back empty — so the score
 * never drops to zero.
 */
const BASE_SCORE = 1

/* ── helpers ────────────────────────────────────────────────────────────── */

/** The folded words of a name, without a leading article. */
function nameWords(value: string): string[] {
  const words = foldText(value).match(WORD) ?? []
  return words[0] === 'the' ? words.slice(1) : words
}

/** Whether two name lists hold the same words, in any order. */
function sameWords(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const set = new Set(right)
  return left.every((word) => set.has(word))
}

/** Whether every word of `subset` also appears in `container`. */
function covers(container: string[], subset: string[]): boolean {
  const set = new Set(container)
  return subset.every((word) => set.has(word))
}

/**
 * A category name in the one form everything is compared in.
 *
 * The Data API hands out Wikipedia slugs ("Pop_music"), the display names
 * come as prose ("Pop music"), and a query is neither. Folding case and
 * diacritics and turning underscores into spaces makes all three
 * comparable.
 */
function normalizeCategory(value: string): string {
  return foldText(value)
    .replace(/[_-]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** How many leading characters two strings share. */
function commonPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length)
  let index = 0
  while (index < limit && left[index] === right[index]) index += 1
  return index
}

/**
 * The shortest leading run that still counts as the same genre.
 *
 * A query names a genre with the beginning of the category name, so the
 * shared run is what is compared: "pop" and "Pop music" share "pop",
 * "indie" and "Independent music" share "ind". A plain character prefix
 * would find the first and miss the second, because "indie" is an
 * abbreviation of "independent" and not the start of it.
 */
const GENRE_PREFIX_LENGTH = 3

/** Whether a category covers a query token. */
function coversGenre(token: string, category: string): boolean {
  const needed = Math.min(GENRE_PREFIX_LENGTH, token.length)
  return commonPrefixLength(token, category) >= needed
}

/** The categories of a track, as comparable names. */
function categoriesOf(track: Track): string[] {
  const names = track.topicCategoryNames?.length
    ? track.topicCategoryNames
    : (track.topicCategories ?? [])

  return names
    .map((name) => normalizeCategory(name))
    .filter((name) => name.length > 0 && name !== 'music')
}

/** The words of the title, folded. */
function titleWords(track: Track): string[] {
  return foldText(track.title).match(WORD) ?? []
}

/** Whether a run of words appears, in order, inside another list of words. */
function coversRun(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    let matched = true
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[start + offset] !== needle[offset]) {
        matched = false
        break
      }
    }
    if (matched) return true
  }
  return false
}

/** How official a channel looks, in the same order the plan ranks it. */
function officialnessOf(channelTitle: string): number {
  switch (parseChannelName(channelTitle).kind) {
    case 'topic':
      return 4
    case 'vevo':
      return 3
    case 'official':
      return 2
    case 'label':
      return 1
    default:
      return 0
  }
}

/** Popularity, compressed so that it can never outweigh a signal above it. */
function popularityOf(viewCount: number): number {
  if (!Number.isFinite(viewCount) || viewCount <= 0) return 0
  return Math.min(0.9, Math.log10(1 + viewCount) / 10)
}

/**
 * How many of the query's tokens the title carries.
 *
 * Words are matched whole: "pop" does not match the title word "popular",
 * and a multi-word token has to appear as a run.
 */
function titleMatch(track: Track, tokens: string[]): number {
  const words = titleWords(track)
  if (words.length === 0) return 0

  let covered = 0
  for (const token of tokens) {
    const needle = normalizeCategory(token)
    if (!needle) continue
    if (coversRun(words, needle.split(' '))) covered += 1
  }

  return covered
}

/* ── signals ────────────────────────────────────────────────────────────── */

/**
 * The lower-cased words of a query, minus the ones that carry no signal.
 *
 * Case and diacritics are folded away, so `Beyoncé` and `Beyonce` are the
 * same token.
 */
export function queryTokens(query: string): string[] {
  return (foldText(query).match(WORD) ?? []).filter(
    (token) => token.length >= 2 && !STOP_WORDS.has(token),
  )
}

/**
 * How well the track's channel names the artist the query is asking for.
 *
 * 0 means no match. 1 means the channel's artist IS the query's artist.
 * Fractions mean a partial match — the channel artist contains the query,
 * or the query contains the channel artist.
 *
 * The comparison is word-wise, not on the folded string: "JAZZ HUJAN" is
 * an Indonesian jazz radio channel and must not score as a match for the
 * genre query "jazz".
 *
 * The rules, in order:
 *
 *   1. the same words on both sides — an exact match, worth 1
 *   2. the query says more than the channel names — the artist is a part of
 *      what was asked for, worth the share of the query the artist covers
 *   3. the channel says more than the query — only an artist channel
 *      (`- Topic`, VEVO, `Official`) may claim to name one, because a user
 *      channel called "JAZZ HUJAN" is a radio station and not an artist
 *
 * A record label never matches: a label names a company or a genre
 * ("City Pop Records"), not the artist the query is asking for.
 */
export function artistMatch(track: Track, query: string): number {
  const { artist, kind } = parseChannelName(track.channelTitle)
  if (kind === 'label') return 0

  const artistWords = nameWords(artist)
  const queryWords = queryTokens(query)
  if (artistWords.length === 0 || queryWords.length === 0) return 0

  if (sameWords(artistWords, queryWords)) return 1

  if (covers(queryWords, artistWords)) {
    return artistWords.length / queryWords.length
  }

  if (kind !== 'user' && covers(artistWords, queryWords)) {
    return queryWords.length / artistWords.length
  }

  return 0
}

/**
 * How many of the query's tokens the track's own genre categories cover.
 *
 * The categories are Wikipedia slugs, so the match is a prefix match:
 * "indie" covers "Independent music" and "hip hop" covers "Hip hop music".
 * A token covered by two categories still counts once.
 */
export function genreMatch(track: Track, tokens: string[]): number {
  const categories = categoriesOf(track)
  if (categories.length === 0 || tokens.length === 0) return 0

  let covered = 0
  for (const token of tokens) {
    const needle = normalizeCategory(token)
    if (!needle) continue
    const hit = categories.some((category) => coversGenre(needle, category))
    if (hit) covered += 1
  }

  return covered
}

/**
 * How relevant the track is to the query, as a single comparable number.
 *
 * This is a RANKING signal, not a filter. A track that matches neither the
 * artist nor the genre is still worth returning — a query for a genre that
 * the Data API files under a different name ("lofi" lives under "Electronic
 * music") would otherwise come back empty — but it has to rank below the
 * ones that do match.
 *
 * The order of the weights matters and is deliberate:
 *   1. an artist match — the user named an artist
 *   2. a genre match — the user named a genre
 *   3. the query's words in the title
 *   4. the channel's officialness (`parseChannelName(...).kind`)
 *   5. popularity
 *
 * The upstream order breaks every remaining tie, so the result is stable.
 */
export function relevanceScore(track: Track, query: string): number {
  const tokens = queryTokens(query)
  const tokenCount = tokens.length

  const artist = artistMatch(track, query)
  const genre = tokenCount > 0 ? genreMatch(track, tokens) / tokenCount : 0
  const title = tokenCount > 0 ? titleMatch(track, tokens) / tokenCount : 0

  return (
    BASE_SCORE +
    WEIGHT_ARTIST * artist +
    WEIGHT_GENRE * genre +
    WEIGHT_TITLE * title +
    officialnessOf(track.channelTitle) +
    popularityOf(track.viewCount)
  )
}

/**
 * Rank tracks by how well they answer the query, best first.
 *
 * Stable: tracks that score the same keep their original order.
 */
export function rankByRelevance<T extends Track>(tracks: T[], query: string): T[] {
  return tracks
    .map((track, index) => ({ track, index, score: relevanceScore(track, query) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.track)
}
