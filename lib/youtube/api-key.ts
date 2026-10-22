import { createMeter, YouTubeError, youtubeFetch, type QuotaMeter } from './client'

/**
 * Bring-your-own-key support (PLAN §13.7, PLAN-ADDENDUM §13.9).
 *
 * The shared project key pays for every search, and the project's daily
 * budget is a hundred searches — a hard ceiling for the whole deployment.
 * A visitor who brings a key from their own Google Cloud project moves their
 * traffic onto their own quota and leaves the shared budget for everyone
 * else. That is the only way to make the product usable at any scale without
 * multiplying the project's quota, which would be a circumvention pattern.
 *
 * The key is never logged and never leaves the server except as the `key`
 * query parameter of a Data API request.
 */

/** A Google API key: `AIza` plus 35 URL-safe characters. */
const KEY_PATTERN = /^AIza[0-9A-Za-z_-]{35}$/

export function isWellFormedApiKey(key: string): boolean {
  return KEY_PATTERN.test(key.trim())
}

export type KeyCheck =
  | { ok: true }
  | {
      ok: false
      reason: 'malformed' | 'rejected' | 'quota'
      message: string
    }

/**
 * Check a key against the live API.
 *
 * `videos.list` is the cheapest call there is — one unit, one id — so it is
 * the right probe: it proves the key authenticates without spending a
 * search, which is the whole thing a verification is trying to avoid.
 *
 * A key whose *own* project quota is spent is reported separately: it is a
 * valid key, but it cannot be used today, and saying so is more useful than
 * "rejected".
 */
export async function verifyApiKey(key: string, meter: QuotaMeter = createMeter()): Promise<KeyCheck> {
  const trimmed = key.trim()

  if (!isWellFormedApiKey(trimmed)) {
    return {
      ok: false,
      reason: 'malformed',
      message:
        'That does not look like a YouTube API key. A Google API key starts with "AIza" and is 39 characters long.',
    }
  }

  try {
    await youtubeFetch(
      'videos.list',
      { part: 'id', id: 'dQw4w9WgXcQ' },
      meter,
      { apiKeyOverride: trimmed },
    )
    return { ok: true }
  } catch (error) {
    if (error instanceof YouTubeError) {
      if (error.code === 'quotaExceeded' || error.status === 429) {
        return {
          ok: false,
          reason: 'quota',
          message:
            'That key works, but its own daily quota is already used up. Try again tomorrow, or use a different key.',
        }
      }
      if (error.status === 400 || error.status === 403) {
        return {
          ok: false,
          reason: 'rejected',
          message:
            'YouTube rejected that key. Check that the YouTube Data API v3 is enabled for it and that no API restrictions are blocking it.',
        }
      }
    }
    return {
      ok: false,
      reason: 'rejected',
      message: 'YouTube could not verify that key right now. Try again in a moment.',
    }
  }
}
