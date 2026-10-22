import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { extractVersionTags, normalizeTitle } from '@/lib/youtube/normalize'

/**
 * A title that carries at least one letter or digit.
 *
 * A string made only of whitespace or of combining marks folds away to
 * nothing, so it cannot be the subject of the "never empty" rule — it is not
 * a title anybody could paste.
 */
const titleLike = fc
  .string({ minLength: 1, maxLength: 48 })
  .filter((value) => /[\p{L}\p{N}]/u.test(value))

const RUNS = { seed: 20_250_101, numRuns: 250 } as const

const knownVersionTags = new Set([
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
])

describe('normalizeTitle', () => {
  it('never returns an empty clean title for a non-empty input', () => {
    fc.assert(
      fc.property(titleLike, (raw) => {
        expect(normalizeTitle(raw).clean).not.toBe('')
      }),
      RUNS,
    )
  })

  it('is idempotent', () => {
    fc.assert(
      fc.property(titleLike, (raw) => {
        const once = normalizeTitle(raw)
        const twice = normalizeTitle(once.clean)

        expect(twice.clean).toBe(once.clean)
      }),
      RUNS,
    )
  })

  it('never reports a version tag that is not in the vocabulary', () => {
    fc.assert(
      fc.property(titleLike, (raw) => {
        for (const tag of extractVersionTags(raw)) {
          expect(knownVersionTags.has(tag)).toBe(true)
        }
      }),
      RUNS,
    )
  })

  it('keeps the version tags of a bracketed title in the vocabulary', () => {
    fc.assert(
      fc.property(titleLike, (raw) => {
        const { versionTags } = normalizeTitle(raw)

        for (const tag of versionTags) {
          expect(knownVersionTags.has(tag)).toBe(true)
        }
      }),
      RUNS,
    )
  })
})
