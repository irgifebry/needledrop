import { describe, expect, it } from 'vitest'

import {
  explainScore,
  formatViewCount,
  popularityPrior,
  recencyPrior,
} from '@/lib/scoring/explain'

import { makeOptions, makeTrack } from '@/tests/helpers/fixtures'

const NOW = Date.parse('2025-01-01T00:00:00Z')

describe('formatViewCount', () => {
  it('formats a million-scale view count', () => {
    expect(formatViewCount(1_200_000)).toBe('1.2M')
  })

  it('formats a thousand-scale view count', () => {
    expect(formatViewCount(340_000)).toBe('340K')
  })

  it('formats a billion-scale view count', () => {
    expect(formatViewCount(1_900_000_000)).toBe('1.9B')
  })

  it('leaves a small view count alone', () => {
    expect(formatViewCount(999)).toBe('999')
    expect(formatViewCount(0)).toBe('0')
  })
})

describe('popularityPrior', () => {
  it('returns zero for a track with no views', () => {
    expect(popularityPrior(0)).toBe(0)
    expect(popularityPrior(-5)).toBe(0)
  })

  it('grows with the view count', () => {
    expect(popularityPrior(1_000)).toBeLessThan(popularityPrior(100_000))
    expect(popularityPrior(100_000)).toBeLessThan(popularityPrior(10_000_000))
  })

  it('never leaves the unit interval', () => {
    for (const views of [0, 1, 1_000, 1_000_000, 1_000_000_000]) {
      const prior = popularityPrior(views)
      expect(prior).toBeGreaterThanOrEqual(0)
      expect(prior).toBeLessThanOrEqual(1)
    }
  })

  it('saturates rather than growing without bound', () => {
    expect(popularityPrior(1_000_000_000)).toBe(1)
  })
})

describe('recencyPrior', () => {
  it('scores a track published today as brand new', () => {
    expect(recencyPrior('2025-01-01T00:00:00Z', NOW)).toBe(1)
  })

  it('scores a track from five years ago as no longer recent', () => {
    expect(recencyPrior('2019-06-01T00:00:00Z', NOW)).toBe(0)
  })

  it('scores an unparseable date as not recent', () => {
    expect(recencyPrior('not a date', NOW)).toBe(0)
  })

  it('stays inside the unit interval for a release from last year', () => {
    const prior = recencyPrior('2024-01-01T00:00:00Z', NOW)
    expect(prior).toBeGreaterThan(0)
    expect(prior).toBeLessThan(1)
  })
})

describe('explainScore', () => {
  const seed = makeTrack({
    videoId: 'seed0000001',
    title: 'Seed Artist - Seed Song',
    artist: 'Seed Artist',
    channelTitle: 'Seed Artist - Topic',
    topicId: '/m/seedtopic',
    topicName: 'Synth-pop',
    durationSec: 200,
  })

  it('lists a reason for every signal that fired', () => {
    const options = makeOptions({ includePopularity: true, includeNewReleases: true })
    const candidate = makeTrack({
      videoId: 'cand0000001',
      title: 'Other Artist - Other Song',
      channelTitle: 'Other ArtistVEVO',
      topicId: '/m/seedtopic',
      topicName: 'Synth-pop',
      viewCount: 1_200_000,
      publishedAt: '2024-06-01T00:00:00Z',
    })

    const reasons = explainScore(seed, candidate, ['related', 'topic'], options)
    const labels = reasons.map((reason) => reason.label)

    expect(labels).toContain('Same Wikipedia topic (Synth-pop)')
    expect(labels).toContain('Official artist channel')
    expect(labels).toContain('Popular (1.2M views)')
    expect(labels).toContain('Found by 2 independent sources')
  })

  it('gives no popularity reason while the popularity toggle is off', () => {
    const options = makeOptions({ includePopularity: false })
    const candidate = makeTrack({
      videoId: 'cand0000002',
      title: 'Other Artist - Other Song',
      channelTitle: 'Other Artist',
      topicId: '/m/othertopic',
      viewCount: 1_200_000,
    })

    const labels = explainScore(seed, candidate, ['related'], options).map((reason) => reason.label)

    expect(labels.some((label) => label.startsWith('Popular'))).toBe(false)
  })

  it('orders the reasons from the largest contribution to the smallest', () => {
    const options = makeOptions({ includePopularity: true })
    const candidate = makeTrack({
      videoId: 'cand0000003',
      title: 'Other Artist - Other Song',
      channelTitle: 'Other ArtistVEVO',
      topicId: '/m/seedtopic',
      topicName: 'Synth-pop',
      viewCount: 1_200_000,
    })

    const points = explainScore(seed, candidate, ['related', 'topic'], options).map(
      (reason) => reason.points,
    )

    expect([...points].sort((left, right) => right - left)).toEqual(points)
  })

  it('is deterministic for a fixed input', () => {
    const options = makeOptions()
    const candidate = makeTrack({ videoId: 'cand0000004', title: 'Other Artist - Other Song' })

    expect(explainScore(seed, candidate, ['related'], options)).toEqual(
      explainScore(seed, candidate, ['related'], options),
    )
  })
})
