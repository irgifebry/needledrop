import { describe, expect, it } from 'vitest'

import {
  artistKey,
  channelArtistName,
  isLikelyArtistName,
  officialSignalStrength,
  parseChannelName,
} from '@/lib/youtube/artist'
import { tidyChannel } from '@/lib/youtube/normalize'

describe('parseChannelName', () => {
  it('reads an auto-generated topic channel as the artist entity', () => {
    expect(parseChannelName('Beyoncé - Topic')).toEqual({ artist: 'Beyoncé', kind: 'topic' })
  })

  it('reads a VEVO channel as the artist label', () => {
    expect(parseChannelName('RickAstleyVEVO')).toEqual({ artist: 'Rick Astley', kind: 'vevo' })
  })

  it('reads a self-declared official channel as official', () => {
    expect(parseChannelName('Artist One Official')).toEqual({ artist: 'Artist One', kind: 'official' })
  })

  it('reads a record label channel as a label', () => {
    expect(parseChannelName('Artist One Records')).toEqual({ artist: 'Artist One', kind: 'label' })
  })

  it('reads an ordinary upload channel as a user channel', () => {
    expect(parseChannelName('Some Random Channel')).toEqual({
      artist: 'Some Random Channel',
      kind: 'user',
    })
  })
})

describe('officialSignalStrength', () => {
  it('gives the strongest signal to the channels YouTube creates', () => {
    expect(officialSignalStrength('Beyoncé - Topic')).toBe(1)
    expect(officialSignalStrength('RickAstleyVEVO')).toBe(1)
  })

  it('gives a weaker signal to a record label', () => {
    expect(officialSignalStrength('Artist One Records')).toBe(0.6)
  })

  it('gives an ordinary upload channel only a token signal', () => {
    expect(officialSignalStrength('Some Random Channel')).toBe(0.2)
  })

  it('never exceeds the unit interval', () => {
    for (const channel of ['Beyoncé - Topic', 'Artist One Records', 'Some Random Channel']) {
      const strength = officialSignalStrength(channel)
      expect(strength).toBeGreaterThanOrEqual(0)
      expect(strength).toBeLessThanOrEqual(1)
    }
  })
})

describe('artistKey', () => {
  it('collapses case, spacing and a leading article onto one artist', () => {
    expect(artistKey('The Weeknd')).toBe(artistKey('Weeknd'))
    expect(artistKey('The Weeknd')).toBe(artistKey('weeknd'))
  })

  it('collapses diacritics onto one artist', () => {
    expect(artistKey('Beyoncé')).toBe(artistKey('Beyonce'))
  })

  it('keeps two different artists apart', () => {
    expect(artistKey('Alpha')).not.toBe(artistKey('Beta'))
  })
})

describe('channelArtistName / tidyChannel', () => {
  it('removes the upload decorations from a channel name', () => {
    expect(tidyChannel('The Weeknd - Topic')).toBe('The Weeknd')
    expect(tidyChannel('RickAstleyVEVO')).toBe('RickAstley')
    expect(tidyChannel('Artist One Official')).toBe('Artist One')
    expect(tidyChannel('Artist One Records')).toBe('Artist One')
    expect(tidyChannel('Artist One Music')).toBe('Artist One')
  })

  it('recovers the spaces in a run-together channel name', () => {
    expect(channelArtistName('RickAstleyVEVO')).toBe('Rick Astley')
  })
})

describe('isLikelyArtistName', () => {
  it('accepts an ordinary artist name', () => {
    expect(isLikelyArtistName('Beyoncé')).toBe(true)
    expect(isLikelyArtistName('The Weeknd')).toBe(true)
  })

  it('rejects a description rather than a name', () => {
    expect(isLikelyArtistName('Song (Live)')).toBe(false)
    expect(isLikelyArtistName('Official Audio')).toBe(false)
    expect(isLikelyArtistName('Nightcore')).toBe(false)
  })

  it('rejects a string that carries a separator or a number', () => {
    expect(isLikelyArtistName('Artist - Song')).toBe(false)
    expect(isLikelyArtistName('Artist 1234')).toBe(false)
  })

  it('rejects an empty string', () => {
    expect(isLikelyArtistName('   ')).toBe(false)
  })
})
