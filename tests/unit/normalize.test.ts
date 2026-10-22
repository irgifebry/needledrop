import { describe, expect, it } from 'vitest'

import { parseIsoDuration } from '@/lib/youtube/client'
import {
  extractVersionTags,
  isOfficialChannel,
  isVersionAllowed,
  normalizeTitle,
  parseArtistTitle,
  trackKeyOf,
  versionKeyOf,
} from '@/lib/youtube/normalize'

describe('parseIsoDuration', () => {
  it('reads a minutes-and-seconds duration as seconds', () => {
    expect(parseIsoDuration('PT3M33S')).toBe(213)
  })

  it('reads a full hours-minutes-seconds duration', () => {
    expect(parseIsoDuration('PT1H2M3S')).toBe(3723)
  })

  it('reads a live item with no duration as zero seconds', () => {
    expect(parseIsoDuration('PT0S')).toBe(0)
  })

  it('reads a days-and-hours duration', () => {
    expect(parseIsoDuration('P1DT2H')).toBe(93_600)
  })

  it('treats a missing duration as zero seconds', () => {
    expect(parseIsoDuration(undefined)).toBe(0)
  })

  it('treats an unparseable duration as zero seconds rather than guessing', () => {
    expect(parseIsoDuration('banana')).toBe(0)
    expect(parseIsoDuration('213')).toBe(0)
    expect(parseIsoDuration('')).toBe(0)
  })
})

describe('normalizeTitle', () => {
  it('strips bracketed groups from the clean title', () => {
    expect(normalizeTitle('Song Alpha (Live)').clean).toBe('song alpha')
  })

  it('remembers a bracketed group as a version tag', () => {
    expect(normalizeTitle('Song Alpha (Live)').versionTags.has('live')).toBe(true)
    expect(normalizeTitle('Song Alpha (Remastered 2011)').versionTags.has('remaster')).toBe(true)
  })

  it('unifies en and em dashes into a plain hyphen', () => {
    expect(normalizeTitle('Artist – Song').clean).toBe('artist - song')
    expect(normalizeTitle('Artist — Song').clean).toBe('artist - song')
  })

  it('removes a feat. suffix from the clean title', () => {
    expect(normalizeTitle('Song Alpha feat. Drake').clean).toBe('song alpha')
  })

  it('captures a feat. suffix as the featured artist', () => {
    expect(normalizeTitle('Song Alpha feat. Drake').featureArtist).toBe('Drake')
    expect(normalizeTitle('Song Alpha ft. Drake').featureArtist).toBe('Drake')
    expect(normalizeTitle('Song Alpha featuring Drake').featureArtist).toBe('Drake')
  })

  it('does not mistake "With Me" for a featured artist', () => {
    expect(normalizeTitle('Dance With Me').featureArtist).toBeNull()
  })

  it('folds diacritics away', () => {
    expect(normalizeTitle('Beyoncé').clean).toBe('beyonce')
    expect(normalizeTitle('Déjà Vu').clean).toBe('deja vu')
  })

  it('never returns an empty clean title for a title made only of metadata', () => {
    expect(normalizeTitle('(Live)').clean).not.toBe('')
  })
})

describe('extractVersionTags', () => {
  it('does not tag a title that merely contains the word Live', () => {
    expect(extractVersionTags('Live Your Life')).not.toContain('live')
  })

  it('tags a bracketed live suffix as a live version', () => {
    expect(extractVersionTags('Song Alpha (Live)')).toContain('live')
  })

  it('recognises the derivative version vocabulary', () => {
    expect(extractVersionTags('Song (Remix)')).toContain('remix')
    expect(extractVersionTags('Song (Acoustic)')).toContain('acoustic')
    expect(extractVersionTags('Song (Instrumental)')).toContain('instrumental')
    expect(extractVersionTags('Song (Karaoke)')).toContain('karaoke')
    expect(extractVersionTags('Song (Cover)')).toContain('cover')
    expect(extractVersionTags('Song (Sped Up)')).toContain('spedUp')
    expect(extractVersionTags('Song (Nightcore)')).toContain('nightcore')
  })

  it('recognises the metadata version vocabulary', () => {
    expect(extractVersionTags('Song (Remastered 2011)')).toContain('remaster')
    expect(extractVersionTags('Song (Official Video)')).toContain('official')
    expect(extractVersionTags('Song (Official Video)')).toContain('video')
    expect(extractVersionTags('Song (Explicit)')).toContain('explicit')
    expect(extractVersionTags('Song (4K)')).toContain('4k')
  })

  it('tags every marker a bracketed group carries, not just the first', () => {
    const tags = extractVersionTags('Song (Nightcore Remix)')
    expect(tags).toContain('nightcore')
    expect(tags).toContain('remix')
  })

  it('returns no tags for a plain song title', () => {
    expect(extractVersionTags('Ordinary Song Title')).toEqual([])
  })
})

describe('trackKeyOf / versionKeyOf', () => {
  it('gives the same key to the same song uploaded by two different channels', () => {
    const first = parseArtistTitle('Artist One - Song Alpha', 'Channel One')
    const second = parseArtistTitle('Artist One - Song Alpha', 'Channel Two')
    expect(trackKeyOf(first.artist, first.title)).toBe(trackKeyOf(second.artist, second.title))
  })

  it('gives the same key to the same song written with different casing and diacritics', () => {
    expect(trackKeyOf('Beyoncé', 'Déjà Vu')).toBe(trackKeyOf('beyonce', 'deja vu'))
  })

  it('gives a different key to a different song', () => {
    expect(trackKeyOf('Artist One', 'Song Alpha')).not.toBe(trackKeyOf('Artist One', 'Song Beta'))
  })

  it('gives a live take a different version key than the studio version', () => {
    const studio = versionKeyOf('Artist One', 'Song Alpha', [])
    const live = versionKeyOf('Artist One', 'Song Alpha', ['live'])
    expect(live).not.toBe(studio)
  })

  it('keeps the canonical track key as the prefix of a version key', () => {
    expect(versionKeyOf('Artist One', 'Song Alpha', ['live'])).toMatch(
      new RegExp(`^${trackKeyOf('Artist One', 'Song Alpha')}::`),
    )
  })

  it('gives the same version key to a live take regardless of the tag order', () => {
    expect(versionKeyOf('Artist One', 'Song Alpha', ['live', 'remix'])).toBe(
      versionKeyOf('Artist One', 'Song Alpha', ['remix', 'live']),
    )
  })
})

describe('isVersionAllowed', () => {
  it('drops a version that is not on the allow-list', () => {
    expect(isVersionAllowed(['live'], { includeVersions: [] })).toBe(false)
    expect(isVersionAllowed(['live'], { includeVersions: ['remix'] })).toBe(false)
  })

  it('keeps a version that is on the allow-list', () => {
    expect(isVersionAllowed(['live'], { includeVersions: ['live'] })).toBe(true)
  })

  it('keeps a track with no derivative version whatever the allow-list says', () => {
    expect(isVersionAllowed(['official', 'video'], { includeVersions: [] })).toBe(true)
  })

  it('still honours the legacy includeLive boolean', () => {
    const policy = { includeLive: false, includeRemix: true, includeAcoustic: true }
    expect(isVersionAllowed(['live'], policy)).toBe(false)
    expect(isVersionAllowed(['remix'], policy)).toBe(true)
  })

  it('keeps a live take when the legacy includeLive boolean allows it', () => {
    const policy = { includeLive: true, includeRemix: false, includeAcoustic: false }
    expect(isVersionAllowed(['live'], policy)).toBe(true)
  })
})

describe('parseArtistTitle', () => {
  it('splits "Artist - Title"', () => {
    expect(parseArtistTitle('Artist One - Song Alpha', 'Some Channel')).toEqual({
      artist: 'Artist One',
      title: 'Song Alpha',
    })
  })

  it('splits "Artist | Title"', () => {
    expect(parseArtistTitle('Artist One | Song Alpha', 'Some Channel')).toEqual({
      artist: 'Artist One',
      title: 'Song Alpha',
    })
  })

  it('splits "Title by Artist"', () => {
    expect(parseArtistTitle('Song Alpha by Artist One', 'Some Channel')).toEqual({
      artist: 'Artist One',
      title: 'Song Alpha',
    })
  })

  it('ignores a trailing metadata group when splitting', () => {
    expect(parseArtistTitle('Artist One - Song Alpha (Official Video)', 'Some Channel')).toEqual({
      artist: 'Artist One',
      title: 'Song Alpha',
    })
  })

  it('falls back to the channel name when the title names no artist', () => {
    expect(parseArtistTitle('Song Alpha', 'Artist One - Topic')).toEqual({
      artist: 'Artist One',
      title: 'Song Alpha',
    })
  })

  it('strips the topic decoration from the channel fallback', () => {
    expect(parseArtistTitle('Song Alpha', 'The Weeknd - Topic').artist).toBe('The Weeknd')
  })
})

describe('isOfficialChannel', () => {
  it('recognises the channels YouTube creates for an artist', () => {
    expect(isOfficialChannel('Beyoncé - Topic')).toBe(true)
    expect(isOfficialChannel('ArtistVEVO')).toBe(true)
  })

  it('recognises the self-declared official decorations', () => {
    expect(isOfficialChannel('Artist One Official')).toBe(true)
    expect(isOfficialChannel('Artist One Records')).toBe(true)
    expect(isOfficialChannel('Artist One Music')).toBe(true)
  })

  it('does not call an ordinary upload channel official', () => {
    expect(isOfficialChannel('Some Random Channel')).toBe(false)
  })
})
