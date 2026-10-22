import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { artistKey } from '@/lib/youtube/artist'
import { canonicalArtistFor, scoreCandidate, selectPlaylist } from '@/lib/youtube/similar'
import type { SourceKind, Track } from '@/lib/youtube/types'

import { makeCandidate, makeOptions, makeTrack } from '@/tests/helpers/fixtures'

const RUNS = { seed: 20_250_103, numRuns: 200 } as const

const seed: Track = makeTrack({
  videoId: 'seed0000001',
  title: 'Seed Artist - Seed Song',
  artist: 'Seed Artist',
  channelTitle: 'Seed Artist - Topic',
  topicId: '/m/seedtopic',
  topicName: 'Synth-pop',
  durationSec: 200,
})

const artistPool = fc.constantFrom('Alpha', 'Beta', 'Gamma', 'Delta')
const songPool = fc.constantFrom('Song One', 'Song Two', 'Song Three', 'Live Your Life')
const sourcePool = fc.constantFrom<SourceKind>('related', 'artistRadio', 'topic', 'curated', 'trending')

const trackArbitrary = fc.record({
  artist: artistPool,
  song: songPool,
  duration: fc.integer({ min: 60, max: 600 }),
  views: fc.integer({ min: 0, max: 5_000_000 }),
  topic: fc.constantFrom('/m/seedtopic', '/m/othertopic'),
})

function buildTrack(entry: {
  artist: string
  song: string
  duration: number
  views: number
  topic: string
}, index: number): Track {
  return makeTrack({
    videoId: `prop${String(index).padStart(8, '0')}`,
    title: `${entry.artist} - ${entry.song}`,
    artist: entry.artist,
    channelTitle: `${entry.artist} - Topic`,
    durationSec: entry.duration,
    viewCount: entry.views,
    topicId: entry.topic,
  })
}

describe('scoreCandidate', () => {
  it('is deterministic for a fixed input', () => {
    fc.assert(
      fc.property(
        trackArbitrary,
        fc.array(sourcePool, { maxLength: 3 }),
        fc.integer({ min: 0, max: 100 }),
        (entry, sources, breadth) => {
          const options = makeOptions({ breadth })
          const candidate = buildTrack(entry, 0)

          const first = scoreCandidate(seed, candidate, sources, options)
          const second = scoreCandidate(seed, candidate, sources, options)

          expect(second.score).toBe(first.score)
          expect(second.reasons).toEqual(first.reasons)
        },
      ),
      RUNS,
    )
  })

  it('never returns a score that is not a number', () => {
    fc.assert(
      fc.property(trackArbitrary, (entry) => {
        const { score } = scoreCandidate(seed, buildTrack(entry, 0), ['related'], makeOptions())

        expect(Number.isFinite(score)).toBe(true)
      }),
      RUNS,
    )
  })
})

describe('selectPlaylist', () => {
  it('never selects more tracks per artist than the cap allows', () => {
    fc.assert(
      fc.property(
        fc.array(trackArbitrary, { minLength: 0, maxLength: 20 }),
        fc.integer({ min: 1, max: 3 }),
        (entries, maxPerArtist) => {
          const options = makeOptions({ maxPerArtist })
          const candidates = entries.map((entry, index) =>
            makeCandidate(buildTrack(entry, index), seed, options),
          )

          const selected = selectPlaylist(candidates, options)

          const perArtist = new Map<string, number>()
          for (const candidate of selected) {
            const key = artistKey(canonicalArtistFor(candidate))
            perArtist.set(key, (perArtist.get(key) ?? 0) + 1)
          }

          for (const count of perArtist.values()) {
            expect(count).toBeLessThanOrEqual(maxPerArtist)
          }
        },
      ),
      RUNS,
    )
  })

  it('never selects the same track twice', () => {
    fc.assert(
      fc.property(fc.array(trackArbitrary, { minLength: 0, maxLength: 20 }), (entries) => {
        const options = makeOptions({ maxPerArtist: 5 })
        const candidates = entries.map((entry, index) =>
          makeCandidate(buildTrack(entry, index), seed, options),
        )

        const selected = selectPlaylist(candidates, options)
        const keys = selected.map((candidate) => candidate.trackKey ?? '')

        expect(new Set(keys).size).toBe(keys.length)
      }),
      RUNS,
    )
  })

  it('never returns more tracks than the requested count', () => {
    fc.assert(
      fc.property(
        fc.array(trackArbitrary, { minLength: 0, maxLength: 20 }),
        fc.integer({ min: 5, max: 20 }),
        (entries, count) => {
          const options = makeOptions({ count, maxPerArtist: 5 })
          const candidates = entries.map((entry, index) =>
            makeCandidate(buildTrack(entry, index), seed, options),
          )

          expect(selectPlaylist(candidates, options).length).toBeLessThanOrEqual(count)
        },
      ),
      RUNS,
    )
  })

  it('never returns the seed itself', () => {
    fc.assert(
      fc.property(fc.array(trackArbitrary, { maxLength: 20 }), (entries) => {
        const options = makeOptions()
        const candidates = entries.map((entry, index) =>
          makeCandidate(buildTrack(entry, index), seed, options),
        )

        const selected = selectPlaylist(candidates, options, { seedVideoIds: [seed.videoId] })

        expect(selected.some((candidate) => candidate.videoId === seed.videoId)).toBe(false)
      }),
      RUNS,
    )
  })
})
