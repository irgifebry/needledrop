import { describe, expect, it } from 'vitest'

import {
  DAILY_QUOTA,
  UNIT_COST,
  estimateDiscoveryUnits,
  estimatePlaylistUnits,
  formatUnits,
  quotaTone,
} from '@/lib/quota'

describe('estimatePlaylistUnits', () => {
  it('charges the playlist insert plus the cost of every item', () => {
    expect(estimatePlaylistUnits(20)).toBe(1_050)
  })

  it('charges more for a longer playlist', () => {
    expect(estimatePlaylistUnits(50)).toBe(2_550)
    expect(estimatePlaylistUnits(50)).toBeGreaterThan(estimatePlaylistUnits(20))
  })
})

describe('estimateDiscoveryUnits', () => {
  it('charges every search at the search price and every video list at one unit', () => {
    expect(estimateDiscoveryUnits(4, 2)).toBe(402)
  })

  it('charges nothing for a run that makes no call', () => {
    expect(estimateDiscoveryUnits(0, 0)).toBe(0)
  })
})

describe('quotaTone', () => {
  it('calls an untouched quota safe', () => {
    expect(quotaTone(0)).toBe('safe')
    expect(quotaTone(2_999)).toBe('safe')
  })

  it('warns once a third of the quota is gone', () => {
    expect(quotaTone(3_000)).toBe('warn')
    expect(quotaTone(6_999)).toBe('warn')
  })

  it('shouts once the quota is nearly gone', () => {
    expect(quotaTone(7_000)).toBe('danger')
    expect(quotaTone(10_000)).toBe('danger')
  })
})

describe('UNIT_COST', () => {
  it('charges the Data API prices the plan pins down', () => {
    expect(UNIT_COST.search).toBe(100)
    expect(UNIT_COST.videosList).toBe(1)
    expect(UNIT_COST.playlistItemsList).toBe(1)
    expect(UNIT_COST.playlistsInsert).toBe(50)
    expect(UNIT_COST.playlistItemsInsert).toBe(50)
  })

  it('makes a search ten times as expensive as a video list', () => {
    expect(UNIT_COST.search).toBe(UNIT_COST.videosList * 100)
  })
})

describe('the daily quota', () => {
  it('is the 10,000 units the plan pins down', () => {
    expect(DAILY_QUOTA).toBe(10_000)
  })

  it('fits a handful of full playlists per day', () => {
    expect(Math.floor(DAILY_QUOTA / estimatePlaylistUnits(20))).toBe(9)
  })
})

describe('formatUnits', () => {
  it('groups the digits so the number is readable', () => {
    expect(formatUnits(1_450)).toBe('1,450')
  })
})
