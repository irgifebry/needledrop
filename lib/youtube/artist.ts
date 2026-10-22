/**
 * Artist and channel parsing (PLAN §13.1.1).
 *
 * The engine needs to know three things about a channel: what the artist is
 * called, how official the channel looks, and whether a string is an artist
 * name at all. Pure functions only — the discovery engine is unit-tested
 * without a network.
 */

import { channelArtistName, foldText, humanizeChannelName, nameKey } from './normalize'

/** What a channel claims to be. */
export type ChannelKind = 'topic' | 'vevo' | 'official' | 'label' | 'user'

/** A parsed channel: the artist behind it and how official it is. */
export type ChannelName = {
  /** The artist the channel belongs to, decorations removed. */
  artist: string
  /** How trustworthy the channel is as an official source. */
  kind: ChannelKind
}

/**
 * Parses a channel name into its artist and its kind.
 *
 * `- Topic` and `VEVO` are the channels YouTube creates for an artist, so
 * they are strong official signals. `Official` is self-declared and weaker;
 * `Records` / `Music` / `Label` are record labels, which are official for
 * their own catalogue but not necessarily for the artist.
 */
export function parseChannelName(channelTitle: string): ChannelName {
  const raw = channelTitle.trim()

  if (/\s*-\s*Topic$/i.test(raw)) {
    return { artist: humanizeChannelName(raw.replace(/\s*-\s*Topic$/i, '').trim()), kind: 'topic' }
  }
  if (/VEVO$/i.test(raw)) {
    return { artist: humanizeChannelName(raw.replace(/VEVO$/i, '').trim()), kind: 'vevo' }
  }
  if (/\bOfficial$/i.test(raw)) {
    return { artist: humanizeChannelName(raw.replace(/\bOfficial$/i, '').trim()), kind: 'official' }
  }
  if (/(?:Records|Music|Label|Entertainment|Productions)$/i.test(raw)) {
    return { artist: humanizeChannelName(raw.replace(/(?:Records|Music|Label|Entertainment|Productions)$/i, '').trim()), kind: 'label' }
  }

  return { artist: humanizeChannelName(raw), kind: 'user' }
}

/**
 * How official a channel looks, in `[0, 1]`.
 *
 * Used for the "official artist channel" bonus and for the `official` flag on
 * a candidate. A random upload channel still gets a small amount of credit
 * because plenty of genuine tracks live there.
 */
export function officialSignalStrength(channelTitle: string): number {
  switch (parseChannelName(channelTitle).kind) {
    case 'topic':
      return 1
    case 'vevo':
      return 1
    case 'official':
      return 1
    case 'label':
      return 0.6
    case 'user':
    default:
      return 0.2
  }
}

/** Words that mark a string as a description, not a name. */
const DESCRIPTION_WORDS = new Set([
  'live',
  'remix',
  'acoustic',
  'instrumental',
  'karaoke',
  'cover',
  'unplugged',
  'nightcore',
  'reverb',
  'official',
  'audio',
  'video',
  'lyrics',
  'lyric',
  'visualizer',
  'remaster',
  'remastered',
  'explicit',
  'clean',
  'hd',
  'hq',
  '4k',
  'mv',
  'm/v',
  'topic',
  'vevo',
  'records',
  'music',
  'label',
  'radio',
  'session',
  'version',
])

/**
 * Whether a string reads like an artist name.
 *
 * Used to decide whether the left half of `Artist - Title` really is an
 * artist, and whether a channel-derived name is worth showing to the user.
 */
export function isLikelyArtistName(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (trimmed.length > 60) return false
  if (/[-–—|]/.test(trimmed)) return false
  if (/\d{3,}/.test(trimmed)) return false

  const words = trimmed.split(/\s+/).filter(Boolean)
  if (words.length === 0 || words.length > 6) return false

  const last = foldText(words[words.length - 1] ?? '').replace(/[^a-z0-9/]/g, '')
  if (DESCRIPTION_WORDS.has(last)) return false

  return true
}

/**
 * The canonical artist key (PLAN §13.1.1).
 *
 * `The Weeknd`, `Weeknd` and `weeknd` all collapse onto `weeknd`, and
 * diacritics are dropped. This is the key the diversity cap and the
 * seed-artist rule work on.
 */
export function artistKey(value: string): string {
  return nameKey(value)
}

/**
 * The artist behind a channel, with the decorations removed.
 *
 * Re-exported from the identity module so channel parsing has a single
 * source of truth for what a channel name means.
 */
export { channelArtistName }
