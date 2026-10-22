import { describe, expect, it } from 'vitest'

import { blendSeedProfiles, buildSeedProfile } from '@/lib/seed/centroid'

import { makeTrack } from '@/tests/helpers/fixtures'

describe('buildSeedProfile', () => {
  const alphaOne = makeTrack({
    videoId: 'vid00000001',
    title: 'Alpha - One',
    artist: 'Alpha',
    channelTitle: 'Alpha - Topic',
    topicId: '/m/alpha',
    topicCategories: ['Indonesian pop'],
    durationSec: 200,
  })
  const alphaTwo = makeTrack({
    videoId: 'vid00000002',
    title: 'Alpha - Two',
    artist: 'Alpha',
    channelTitle: 'Alpha - Topic',
    topicId: '/m/alpha',
    topicCategories: ['Synth-pop'],
    durationSec: 240,
  })
  const beta = makeTrack({
    videoId: 'vid00000003',
    title: 'Beta - Three',
    artist: 'Beta',
    channelTitle: 'Beta - Topic',
    topicId: '/m/beta',
    topicCategories: ['Indonesian pop'],
    durationSec: 160,
  })

  it('counts the seed tracks per canonical artist', () => {
    const profile = buildSeedProfile([alphaOne, alphaTwo, beta], 'playlist', 'My mix')

    expect(profile.artistWeights.get('alpha')).toBe(2)
    expect(profile.artistWeights.get('beta')).toBe(1)
  })

  it('collects the topic ids of the seed tracks', () => {
    const profile = buildSeedProfile([alphaOne, alphaTwo, beta], 'playlist', 'My mix')

    expect([...profile.topicIds].sort()).toEqual(['/m/alpha', '/m/beta'])
  })

  it('collects the topic categories of the seed tracks', () => {
    const profile = buildSeedProfile([alphaOne, alphaTwo, beta], 'playlist', 'My mix')

    expect([...profile.topicCategories].sort()).toEqual(['indonesian pop', 'synth-pop'])
  })

  it('averages the duration of the seed tracks', () => {
    const profile = buildSeedProfile([alphaOne, alphaTwo, beta], 'playlist', 'My mix')

    expect(profile.meanDurationSec).toBeCloseTo(200, 10)
  })

  it('keeps the seed video ids without duplicates', () => {
    const profile = buildSeedProfile([alphaOne, alphaOne, beta], 'playlist', 'My mix')

    expect(profile.videoIds).toEqual(['vid00000001', 'vid00000003'])
  })

  it('remembers the label and the kind of the seed', () => {
    const profile = buildSeedProfile([alphaOne], 'video', 'Alpha - One')

    expect(profile.label).toBe('Alpha - One')
    expect(profile.kind).toBe('video')
  })

  it('builds a valid profile from a single track', () => {
    const profile = buildSeedProfile([alphaOne], 'video', 'Alpha - One')

    expect(profile.tracks).toHaveLength(1)
    expect(profile.artistWeights.get('alpha')).toBe(1)
    expect(profile.meanDurationSec).toBe(200)
    expect(profile.topicIds.has('/m/alpha')).toBe(true)
  })

  it('builds an empty profile from no tracks at all', () => {
    const profile = buildSeedProfile([], 'playlist', 'Empty')

    expect(profile.tracks).toHaveLength(0)
    expect(profile.artistWeights.size).toBe(0)
    expect(profile.meanDurationSec).toBe(0)
  })
})

describe('blendSeedProfiles', () => {
  const alpha = buildSeedProfile(
    [makeTrack({ videoId: 'vid00000001', title: 'Alpha - One', artist: 'Alpha', durationSec: 200 })],
    'playlist',
    'Alpha mix',
  )
  const beta = buildSeedProfile(
    [makeTrack({ videoId: 'vid00000002', title: 'Beta - Two', artist: 'Beta', durationSec: 300 })],
    'playlist',
    'Beta mix',
  )

  it('weighs the artist weights by the blend ratio', () => {
    const blend = blendSeedProfiles([
      { profile: alpha, weight: 0.7 },
      { profile: beta, weight: 0.3 },
    ])

    expect(blend.artistWeights.get('alpha')).toBeCloseTo(0.7, 10)
    expect(blend.artistWeights.get('beta')).toBeCloseTo(0.3, 10)
  })

  it('normalises the weights, so 7:3 and 0.7:0.3 are the same blend', () => {
    const scaled = blendSeedProfiles([
      { profile: alpha, weight: 7 },
      { profile: beta, weight: 3 },
    ])
    const fractional = blendSeedProfiles([
      { profile: alpha, weight: 0.7 },
      { profile: beta, weight: 0.3 },
    ])

    expect(scaled.artistWeights.get('alpha')).toBeCloseTo(fractional.artistWeights.get('alpha') ?? 0, 10)
    expect(scaled.artistWeights.get('beta')).toBeCloseTo(fractional.artistWeights.get('beta') ?? 0, 10)
  })

  it('keeps the tracks of both profiles without duplicating a shared one', () => {
    const shared = buildSeedProfile(
      [makeTrack({ videoId: 'vid00000003', title: 'Gamma - Three', artist: 'Gamma' })],
      'playlist',
      'Gamma mix',
    )

    const blend = blendSeedProfiles([
      { profile: alpha, weight: 0.5 },
      { profile: shared, weight: 0.5 },
    ])

    expect(blend.tracks.map((track) => track.videoId)).toEqual(['vid00000001', 'vid00000003'])
  })

  it('unions the topic ids of the blended profiles', () => {
    const withTopic = buildSeedProfile(
      [makeTrack({ videoId: 'vid00000004', title: 'Delta - Four', artist: 'Delta', topicId: '/m/delta' })],
      'playlist',
      'Delta mix',
    )

    const blend = blendSeedProfiles([
      { profile: alpha, weight: 0.5 },
      { profile: withTopic, weight: 0.5 },
    ])

    expect(blend.topicIds.has('/m/delta')).toBe(true)
  })

  it('names the blend after the profiles it mixed', () => {
    const blend = blendSeedProfiles([
      { profile: alpha, weight: 0.7 },
      { profile: beta, weight: 0.3 },
    ])

    expect(blend.label).toContain('Alpha mix')
    expect(blend.label).toContain('Beta mix')
    expect(blend.kind).toBe('profile')
  })

  it('ignores a profile with no weight', () => {
    const blend = blendSeedProfiles([
      { profile: alpha, weight: 1 },
      { profile: beta, weight: 0 },
    ])

    expect(blend.artistWeights.has('beta')).toBe(false)
    expect(blend.artistWeights.get('alpha')).toBeCloseTo(1, 10)
  })
})
