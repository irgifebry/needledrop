import { describe, expect, it } from 'vitest'

import { isRegionSafe, languageMatches, regionLabel } from '@/lib/youtube/regions'
import { selectPlaylist } from '@/lib/youtube/similar'

import { makeCandidate, makeOptions, makeTrack } from '@/tests/helpers/fixtures'

describe('regionLabel', () => {
  it('says that no restriction was reported when the API said nothing', () => {
    expect(regionLabel([])).toBe('No region restriction reported')
    expect(regionLabel(undefined)).toBe('No region restriction reported')
    expect(regionLabel(null)).toBe('No region restriction reported')
  })

  it('does not claim the track is available everywhere', () => {
    expect(regionLabel([])).not.toMatch(/everywhere/i)
    expect(regionLabel([])).not.toMatch(/available in all/i)
  })

  it('counts the countries the API reported', () => {
    expect(regionLabel(['ID'])).toBe('Available in 1 country')
    expect(regionLabel(['ID', 'SG'])).toBe('Available in 2 countries')
  })
})

describe('isRegionSafe', () => {
  it('keeps a track with no restriction reported', () => {
    expect(isRegionSafe({}, 'ID')).toBe(true)
  })

  it('keeps a track whose restriction does not mention the visitor region', () => {
    expect(isRegionSafe({ regionRestriction: { blocked: ['DE'] } }, 'ID')).toBe(true)
  })

  it('drops a track blocked in the visitor region', () => {
    expect(isRegionSafe({ regionRestriction: { blocked: ['ID'] } }, 'ID')).toBe(false)
  })

  it('keeps a track whose allow-list contains the visitor region', () => {
    expect(isRegionSafe({ regionRestriction: { allowed: ['ID', 'SG'] } }, 'ID')).toBe(true)
  })

  it('drops a track whose allow-list does not contain the visitor region', () => {
    expect(isRegionSafe({ regionRestriction: { allowed: ['US'] } }, 'ID')).toBe(false)
  })

  it('compares the country codes case-insensitively', () => {
    expect(isRegionSafe({ regionRestriction: { blocked: ['id'] } }, 'ID')).toBe(false)
  })

  it('does not filter at all when the visitor region is unknown', () => {
    expect(isRegionSafe({ regionRestriction: { blocked: ['ID'] } }, null)).toBe(true)
    expect(isRegionSafe({ regionRestriction: { blocked: ['ID'] } }, '')).toBe(true)
  })
})

describe('region-safe mode in the selection', () => {
  const seed = makeTrack({ videoId: 'seed0000001', title: 'Seed Artist - Seed Song' })

  it('drops a track blocked in the visitor region', () => {
    const options = makeOptions({ regionSafeOnly: true })
    const blocked = makeCandidate(
      makeTrack({
        videoId: 'cand0000001',
        title: 'Alpha - Blocked',
        regionRestriction: { blocked: ['ID'] },
      }),
      seed,
      options,
    )

    expect(selectPlaylist([blocked], options, { userRegion: 'ID' })).toHaveLength(0)
  })

  it('keeps a track that is not blocked in the visitor region', () => {
    const options = makeOptions({ regionSafeOnly: true })
    const allowed = makeCandidate(
      makeTrack({
        videoId: 'cand0000002',
        title: 'Beta - Allowed',
        regionRestriction: { blocked: ['DE'] },
      }),
      seed,
      options,
    )

    expect(selectPlaylist([allowed], options, { userRegion: 'ID' })).toHaveLength(1)
  })

  it('keeps a track with no restriction reported', () => {
    const options = makeOptions({ regionSafeOnly: true })
    const unreported = makeCandidate(
      makeTrack({ videoId: 'cand0000003', title: 'Gamma - Unreported' }),
      seed,
      options,
    )

    expect(selectPlaylist([unreported], options, { userRegion: 'ID' })).toHaveLength(1)
  })
})

describe('languageMatches', () => {
  it('keeps a track whose language is unknown', () => {
    expect(languageMatches({}, ['en'])).toBe(true)
  })

  it('keeps a track when no language was asked for', () => {
    expect(languageMatches({ language: 'ja' }, [])).toBe(true)
    expect(languageMatches({ language: 'ja' }, undefined)).toBe(true)
  })

  it('keeps a track whose language was asked for', () => {
    expect(languageMatches({ language: 'en' }, ['en', 'id'])).toBe(true)
  })

  it('drops a track whose language was not asked for', () => {
    expect(languageMatches({ language: 'ja' }, ['en', 'id'])).toBe(false)
  })
})
