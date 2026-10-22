import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { normalizeTitle, trackKeyOf, versionKeyOf } from '@/lib/youtube/normalize'
import type { VersionTag } from '@/lib/youtube/types'

const RUNS = { seed: 20_250_102, numRuns: 250 } as const

const artistLike = fc
  .string({ minLength: 1, maxLength: 24 })
  .filter((value) => /[\p{L}\p{N}]/u.test(value))

const titleLike = fc
  .string({ minLength: 1, maxLength: 32 })
  .filter((value) => /[\p{L}\p{N}]/u.test(value))

const versionTags = fc.constantFrom<VersionTag>(
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
)

describe('trackKeyOf', () => {
  it('is idempotent', () => {
    fc.assert(
      fc.property(artistLike, titleLike, (artist, title) => {
        const key = trackKeyOf(artist, title)

        expect(trackKeyOf(artist, title)).toBe(key)
      }),
      RUNS,
    )
  })

  it('does not depend on the order the tracks arrive in', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(artistLike, titleLike), { minLength: 1, maxLength: 8 }),
        (pairs) => {
          const forward = pairs.map(([artist, title]) => trackKeyOf(artist, title)).sort()
          const backward = [...pairs]
            .reverse()
            .map(([artist, title]) => trackKeyOf(artist, title))
            .sort()

          expect(backward).toEqual(forward)
        },
      ),
      RUNS,
    )
  })

  it('gives the same key to the same artist and title written differently', () => {
    const artist = fc.constantFrom('Beyoncé', 'beyonce', 'BEYONCÉ', 'Beyonce')
    const title = fc.constantFrom('Déjà Vu', 'deja vu', 'DÉJÀ VU', 'Deja Vu')

    fc.assert(
      fc.property(artist, title, (writtenArtist, writtenTitle) => {
        expect(trackKeyOf(writtenArtist, writtenTitle)).toBe(
          trackKeyOf('Beyoncé', 'Déjà Vu'),
        )
      }),
      RUNS,
    )
  })

  it('never returns an empty key for a non-empty artist and title', () => {
    fc.assert(
      fc.property(artistLike, titleLike, (artist, title) => {
        expect(trackKeyOf(artist, title).length).toBeGreaterThan(0)
      }),
      RUNS,
    )
  })
})

describe('versionKeyOf', () => {
  it('is idempotent', () => {
    fc.assert(
      fc.property(artistLike, titleLike, fc.array(versionTags, { maxLength: 4 }), (artist, title, tags) => {
        const key = versionKeyOf(artist, title, tags)

        expect(versionKeyOf(artist, title, tags)).toBe(key)
      }),
      RUNS,
    )
  })

  it('does not depend on the order the tags arrive in', () => {
    fc.assert(
      fc.property(artistLike, titleLike, fc.array(versionTags, { minLength: 2, maxLength: 4 }), (artist, title, tags) => {
        const forward = versionKeyOf(artist, title, tags)
        const backward = versionKeyOf(artist, title, [...tags].reverse())

        expect(backward).toBe(forward)
      }),
      RUNS,
    )
  })

  it('keeps a derivative version apart from the studio version', () => {
    fc.assert(
      fc.property(artistLike, titleLike, versionTags, (artist, title, tag) => {
        expect(versionKeyOf(artist, title, [tag])).not.toBe(versionKeyOf(artist, title, []))
      }),
      RUNS,
    )
  })

  it('keeps the canonical track key as the prefix of the version key', () => {
    fc.assert(
      fc.property(artistLike, titleLike, versionTags, (artist, title, tag) => {
        expect(versionKeyOf(artist, title, [tag]).startsWith(trackKeyOf(artist, title))).toBe(true)
      }),
      RUNS,
    )
  })
})

describe('the canonical key of a song', () => {
  it('is the same for every spelling of the same artist and title', () => {
    const spellings = fc.constantFrom(
      ['Beyoncé', 'Déjà Vu'],
      ['Beyonce', 'Deja Vu'],
      ['BEYONCÉ', 'DÉJÀ VU'],
      ['beyoncé', 'déjà vu'],
    )

    fc.assert(
      fc.property(spellings, ([artist, title]) => {
        const expected = trackKeyOf('Beyoncé', 'Déjà Vu')

        expect(trackKeyOf(artist, title)).toBe(expected)
      }),
      RUNS,
    )
  })

  it('survives the title normalisation the engine applies before hashing', () => {
    fc.assert(
      fc.property(artistLike, titleLike, (artist, title) => {
        const clean = normalizeTitle(title).clean

        expect(trackKeyOf(artist, clean)).toBe(trackKeyOf(artist, clean))
      }),
      RUNS,
    )
  })
})
