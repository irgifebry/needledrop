import { describe, expect, it } from 'vitest'

import { filterTracks, isTrack, trackShape, TRACK_MAX_SEC, TRACK_MIN_SEC } from '@/lib/youtube/music'

import { makeTrack } from '@/tests/helpers/fixtures'

describe('trackShape', () => {
  it('calls a recording inside the window a track', () => {
    expect(trackShape(makeTrack({ durationSec: 200 }))).toBe('track')
  })

  it('calls a live broadcast a live broadcast', () => {
    expect(trackShape(makeTrack({ liveBroadcastContent: 'live' }))).toBe('live')
  })

  it('calls an upcoming broadcast a live broadcast', () => {
    expect(trackShape(makeTrack({ liveBroadcastContent: 'upcoming' }))).toBe('live')
  })

  it('calls a live broadcast live even when it reports no duration', () => {
    const track = makeTrack({ durationSec: 0, liveBroadcastContent: 'live' })

    expect(trackShape(track)).toBe('live')
  })

  it('calls a missing duration a livestream', () => {
    expect(trackShape(makeTrack({ durationSec: 0 }))).toBe('noDuration')
  })

  it('calls a broken duration a livestream', () => {
    expect(trackShape(makeTrack({ durationSec: Number.NaN }))).toBe('noDuration')
  })

  it('calls an absent duration a livestream', () => {
    const track = makeTrack({ durationSec: undefined })

    expect(trackShape(track)).toBe('noDuration')
  })

  it('calls a clip shorter than the minimum too short', () => {
    expect(trackShape(makeTrack({ durationSec: TRACK_MIN_SEC - 1 }))).toBe('tooShort')
  })

  it('calls a mix longer than the maximum too long', () => {
    expect(trackShape(makeTrack({ durationSec: TRACK_MAX_SEC + 1 }))).toBe('tooLong')
  })

  it('accepts the minimum duration itself', () => {
    expect(trackShape(makeTrack({ durationSec: TRACK_MIN_SEC }))).toBe('track')
  })

  it('accepts the maximum duration itself', () => {
    expect(trackShape(makeTrack({ durationSec: TRACK_MAX_SEC }))).toBe('track')
  })

  it('keeps the bounds where the plan puts them', () => {
    expect(TRACK_MIN_SEC).toBe(45)
    expect(TRACK_MAX_SEC).toBe(12 * 60)
  })
})

describe('isTrack', () => {
  it('is true for a real recording', () => {
    expect(isTrack(makeTrack({ durationSec: 200 }))).toBe(true)
  })

  it('is false for a live broadcast', () => {
    expect(isTrack(makeTrack({ liveBroadcastContent: 'live' }))).toBe(false)
  })

  it('is false for a livestream without a duration', () => {
    expect(isTrack(makeTrack({ durationSec: 0 }))).toBe(false)
  })

  it('is false for a clip and for a mix', () => {
    expect(isTrack(makeTrack({ durationSec: TRACK_MIN_SEC - 1 }))).toBe(false)
    expect(isTrack(makeTrack({ durationSec: TRACK_MAX_SEC + 1 }))).toBe(false)
  })

  it.each([
    'Song Name (Official Music Video)',
    'Song Name - Music Video',
    'Song Name (Lyric Video)',
    'Song Name - Lyrics',
    'Artist - Song (M/V)',
    'Artist - Song [Official MV]',
  ])('excludes video-marked title: %s', (title) => {
    expect(isTrack(makeTrack({ title, durationSec: 200 }))).toBe(false)
  })

  it('retains official audio and Topic-channel recordings', () => {
    expect(
      isTrack(
        makeTrack({
          title: 'Song Name (Official Audio)',
          channelTitle: 'Artist - Topic',
          durationSec: 200,
        }),
      ),
    ).toBe(true)
  })
})

describe('filterTracks', () => {
  it('keeps only the real recordings', () => {
    const tracks = [
      makeTrack({ videoId: 'keep', durationSec: 200 }),
      makeTrack({ videoId: 'clip', durationSec: 30 }),
      makeTrack({ videoId: 'stream', durationSec: 0 }),
      makeTrack({ videoId: 'live', liveBroadcastContent: 'live' }),
      makeTrack({ videoId: 'mix', durationSec: 3600 }),
      makeTrack({ videoId: 'keep2', durationSec: TRACK_MAX_SEC }),
    ]

    expect(filterTracks(tracks).map((track) => track.videoId)).toEqual(['keep', 'keep2'])
  })

  it('preserves the order of the input', () => {
    const tracks = [
      makeTrack({ videoId: 'third', durationSec: 300 }),
      makeTrack({ videoId: 'first', durationSec: 100 }),
      makeTrack({ videoId: 'second', durationSec: 200 }),
    ]

    expect(filterTracks(tracks).map((track) => track.videoId)).toEqual(['third', 'first', 'second'])
  })

  it('keeps the very same objects, not copies', () => {
    const first = makeTrack({ videoId: 'first', durationSec: 200 })
    const second = makeTrack({ videoId: 'second', durationSec: 300 })

    const filtered = filterTracks([first, second])

    expect(filtered[0]).toBe(first)
    expect(filtered[1]).toBe(second)
  })

  it('returns nothing when no candidate is a recording', () => {
    const tracks = [
      makeTrack({ durationSec: 10 }),
      makeTrack({ durationSec: 4000 }),
      makeTrack({ liveBroadcastContent: 'upcoming' }),
    ]

    expect(filterTracks(tracks)).toEqual([])
  })

  it('returns an empty list for an empty input', () => {
    expect(filterTracks([])).toEqual([])
  })
})
