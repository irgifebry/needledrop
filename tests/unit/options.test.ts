import { describe, expect, it } from 'vitest'

import { DEFAULT_OPTIONS } from '@/lib/youtube/types'
import { normalizeDiscoveryOptions, versionsFromLegacy } from '@/lib/youtube/options'

describe('normalizeDiscoveryOptions', () => {
  it('accepts the v1 shape the existing client sends', () => {
    const options = normalizeDiscoveryOptions({
      count: 12,
      breadth: 30,
      includeLive: true,
      includeRemix: false,
      includeAcoustic: false,
      includePopularity: true,
    })

    expect(options.count).toBe(12)
    expect(options.breadth).toBe(30)
    expect(options.includeLive).toBe(true)
    expect(options.includeRemix).toBe(false)
    expect(options.includeAcoustic).toBe(false)
    expect(options.includePopularity).toBe(true)
  })

  it('accepts the v2 shape', () => {
    const options = normalizeDiscoveryOptions({
      count: 30,
      breadth: 80,
      depth: 2,
      includeVersions: ['live', 'remix'],
      durationSec: { min: 90, max: 300 },
      order: 'shuffle',
      shuffleSeed: 7,
      regionSafeOnly: true,
      familyMode: true,
    })

    expect(options.depth).toBe(2)
    expect(options.includeVersions).toEqual(['live', 'remix'])
    expect(options.durationSec).toEqual({ min: 90, max: 300 })
    expect(options.order).toBe('shuffle')
    expect(options.shuffleSeed).toBe(7)
    expect(options.regionSafeOnly).toBe(true)
    expect(options.familyMode).toBe(true)
  })

  it('fills every field so no caller has to guess a default', () => {
    const options = normalizeDiscoveryOptions({})

    expect(options.count).toBe(DEFAULT_OPTIONS.count)
    expect(options.breadth).toBe(DEFAULT_OPTIONS.breadth)
    expect(options.maxPerArtist).toBe(DEFAULT_OPTIONS.maxPerArtist)
    expect(options.depth).toBe(DEFAULT_OPTIONS.depth)
    expect(options.order).toBe(DEFAULT_OPTIONS.order)
    expect(options.includeVersions).toEqual([])
    expect(options.blockedArtists).toEqual([])
    expect(options.blockedKeywords).toEqual([])
    expect(options.languages).toEqual([])
  })

  it('folds the legacy booleans into the version allow-list', () => {
    const options = normalizeDiscoveryOptions({
      includeLive: true,
      includeRemix: false,
      includeAcoustic: true,
    })

    expect(options.includeVersions).toContain('live')
    expect(options.includeVersions).toContain('acoustic')
    expect(options.includeVersions).not.toContain('remix')
  })

  it('lets an explicit allow-list win over the legacy booleans', () => {
    const options = normalizeDiscoveryOptions({
      includeLive: true,
      includeRemix: true,
      includeVersions: ['remix'],
    })

    expect(options.includeVersions).toEqual(['remix'])
    expect(options.includeVersions).not.toContain('live')
  })

  it('mirrors the allow-list back into the legacy booleans', () => {
    const options = normalizeDiscoveryOptions({ includeVersions: ['live', 'acoustic'] })

    expect(options.includeLive).toBe(true)
    expect(options.includeAcoustic).toBe(true)
    expect(options.includeRemix).toBe(false)
  })

  it('falls back to the defaults for a count outside the 5..50 range', () => {
    expect(normalizeDiscoveryOptions({ count: 3 }).count).toBe(DEFAULT_OPTIONS.count)
    expect(normalizeDiscoveryOptions({ count: 100 }).count).toBe(DEFAULT_OPTIONS.count)
  })

  it('falls back to the defaults for a breadth outside the 0..100 range', () => {
    expect(normalizeDiscoveryOptions({ breadth: -1 }).breadth).toBe(DEFAULT_OPTIONS.breadth)
    expect(normalizeDiscoveryOptions({ breadth: 101 }).breadth).toBe(DEFAULT_OPTIONS.breadth)
  })

  it('accepts a count at the edge of the range', () => {
    expect(normalizeDiscoveryOptions({ count: 5 }).count).toBe(5)
    expect(normalizeDiscoveryOptions({ count: 50 }).count).toBe(50)
  })

  it('ignores unknown keys instead of failing', () => {
    const options = normalizeDiscoveryOptions({
      count: 10,
      somethingTheClientInvented: true,
      nested: { anything: [1, 2, 3] },
    })

    expect(options.count).toBe(10)
  })

  it('normalises a duration window whose bounds are swapped', () => {
    const options = normalizeDiscoveryOptions({ durationSec: { min: 300, max: 90 } })

    expect(options.durationSec).toEqual({ min: 90, max: 300 })
  })

  it('survives a missing input entirely', () => {
    expect(normalizeDiscoveryOptions(undefined).count).toBe(DEFAULT_OPTIONS.count)
    expect(normalizeDiscoveryOptions(null).count).toBe(DEFAULT_OPTIONS.count)
  })
})

describe('versionsFromLegacy', () => {
  it('lists the versions the legacy booleans allow', () => {
    expect(versionsFromLegacy({ includeLive: true, includeRemix: true, includeAcoustic: false })).toEqual([
      'live',
      'remix',
    ])
  })

  it('lists nothing when no legacy boolean is set', () => {
    expect(versionsFromLegacy({})).toEqual([])
  })
})
