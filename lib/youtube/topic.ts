/**
 * Wikipedia topic helpers (PLAN §13.1.1, §16).
 *
 * `topicDetails` is the strongest "what is this, really?" signal YouTube
 * gives us: a song about a person or a genre is tagged with the matching
 * Wikipedia topic, and the categories list the genres it belongs to.
 *
 * Pure functions only. `lib/youtube/search.ts` keeps its own copy of
 * `topicNameFromUrl` for now; this module is the canonical one and the two
 * are reconciled in the integration pass.
 */

import { foldText, slug } from './normalize'
import type { Track } from './types'

/**
 * Turns a topic category URL into a readable name.
 *
 * `https://en.wikipedia.org/wiki/Category:Indonesian_pop` → "Indonesian Pop".
 *
 * The `Category:` prefix the slug still carries is dropped — it is an
 * artefact of the URL, not part of the name — and the words are title-cased
 * so the label reads like a name rather than a slug.
 */
export function topicNameFromUrl(url: string | undefined): string {
  if (!url) return 'Unknown topic'
  const slugPart = url.split('/').filter(Boolean).pop() ?? 'Unknown topic'
  return slugPart
    .replace(/^category:/i, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
    .trim()
}

/**
 * A readable topic name.
 *
 * The API only gives us URLs, and the last path segment still carries the
 * `Category:` prefix. The label the user reads should not.
 */
export function topicDisplayName(nameOrUrl: string | undefined): string {
  if (!nameOrUrl) return 'Unknown topic'
  const last = nameOrUrl.split('/').filter(Boolean).pop() ?? nameOrUrl
  return last
    .replace(/^category:/i, '')
    .replace(/_/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** The `topicDetails` shape of a `videos.list` item. */
export type TopicDetailsLike = {
  topicId?: string
  topicCategories?: string[]
  topicCategoryLinks?: Array<{ title?: string; url?: string }>
}

/** The shape of a `videos.list` item the topic helpers need. */
export type TopicItemLike = {
  topicDetails?: TopicDetailsLike
}

/**
 * Every category of a video, as readable names.
 *
 * Newer API versions expose `topicCategoryLinks` with real titles; older
 * responses only carry category URLs, so the slug is the fallback.
 */
export function topicCategoriesOf(videoItem: TopicItemLike): string[] {
  const details = videoItem.topicDetails
  if (!details) return []

  const names: string[] = []
  for (const link of details.topicCategoryLinks ?? []) {
    const title = link.title?.trim()
    if (title) {
      names.push(title)
      continue
    }
    // The URL is a slug, so it is title-cased first and then stripped of
    // the `Category:` prefix the slug still carries.
    const fromUrl = topicDisplayName(topicNameFromUrl(link.url))
    if (fromUrl && fromUrl !== 'Unknown topic') names.push(fromUrl)
  }

  if (names.length === 0) {
    for (const url of details.topicCategories ?? []) {
      const name = topicDisplayName(topicNameFromUrl(url))
      if (name && name !== 'Unknown topic') names.push(name)
    }
  }

  return [...new Set(names)]
}

/** Whether two tracks describe the same Wikipedia topic. */
export function sameTopic(a: Track, b: Track): boolean {
  if (!a.topicId || !b.topicId) return false
  return a.topicId === b.topicId
}

/**
 * Whether two tracks share a genre.
 *
 * Genre comes from the category lists, so it is a much looser signal than
 * the topic id: two songs about two different artists can still be
 * "Indonesian pop".
 */
export function sameGenre(a: Track, b: Track): boolean {
  const left = new Set((a.topicCategories ?? []).map((category) => slug(category)))
  const right = new Set((b.topicCategories ?? []).map((category) => slug(category)))
  for (const category of left) {
    if (category && right.has(category)) return true
  }
  return false
}

/** A normalised category list, used when a category is compared by name. */
export function normalizedCategories(categories: string[] | undefined): string[] {
  return (categories ?? []).map((category) => foldText(category).trim()).filter(Boolean)
}
