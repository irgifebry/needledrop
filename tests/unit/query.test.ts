import { describe, expect, it } from 'vitest'

import {
  artistMatch,
  genreMatch,
  queryTokens,
  rankByRelevance,
  relevanceScore,
} from '@/lib/youtube/query'
import type { Track } from '@/lib/youtube/types'

import { makeTrack } from '@/tests/helpers/fixtures'

describe('queryTokens', () => {
  it('lower-cases the words of the query', () => {
    expect(queryTokens('City Pop')).toEqual(['city', 'pop'])
  })

  it('drops the stop words', () => {
    expect(queryTokens('the best of jazz')).toEqual(['best', 'jazz'])
  })

  it('drops the tokens shorter than two characters', () => {
    expect(queryTokens('a b cd')).toEqual(['cd'])
  })

  it('splits the query on punctuation', () => {
    expect(queryTokens('pink-floyd! rocks?')).toEqual(['pink', 'floyd', 'rocks'])
  })

  it('returns nothing for a query that carries no signal', () => {
    expect(queryTokens('the of and it')).toEqual([])
  })
})

describe('artistMatch', () => {
  it('matches the artist of a VEVO channel exactly', () => {
    expect(artistMatch(makeTrack({ channelTitle: 'RickAstleyVEVO' }), 'rick astley')).toBe(1)
  })

  it('matches the artist of a topic channel exactly', () => {
    expect(artistMatch(makeTrack({ channelTitle: 'PINK FLOYD - Topic' }), 'pink floyd')).toBe(1)
  })

  it('does not match a channel that merely contains the genre', () => {
    expect(artistMatch(makeTrack({ channelTitle: 'Chill City Pop' }), 'city pop')).toBe(0)
  })

  it('does not match a radio channel that happens to start with the genre', () => {
    const score = artistMatch(makeTrack({ channelTitle: 'JAZZ HUJAN' }), 'jazz')

    expect(score).not.toBe(1)
    expect(score).toBe(0)
  })

  it('scores a partial overlap strictly between zero and one', () => {
    const score = artistMatch(makeTrack({ channelTitle: 'PINK FLOYD - Topic' }), 'pink')

    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(1)
  })

  it('scores a query that says more than the channel names', () => {
    const score = artistMatch(makeTrack({ channelTitle: 'PINK FLOYD - Topic' }), 'pink floyd live')

    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(1)
  })
})

describe('genreMatch', () => {
  it('matches a genre that prefixes the category', () => {
    const track = makeTrack({ topicCategoryNames: ['Independent music'] })

    expect(genreMatch(track, queryTokens('indie'))).toBe(1)
  })

  it('matches a genre made of several words', () => {
    const track = makeTrack({ topicCategoryNames: ['Hip hop music'] })

    expect(genreMatch(track, ['hip hop'])).toBe(1)
    expect(genreMatch(track, queryTokens('hip hop'))).toBe(1)
  })

  it('matches a category of the raw category list', () => {
    const track = makeTrack({ topicCategories: ['Pop_music'] })

    expect(genreMatch(track, queryTokens('pop'))).toBe(1)
  })

  it('prefers the category names over the raw categories', () => {
    const track = makeTrack({ topicCategories: ['Jazz'], topicCategoryNames: ['Pop music'] })

    expect(genreMatch(track, queryTokens('jazz'))).toBe(0)
  })

  it('counts a token that two categories cover only once', () => {
    const track = makeTrack({ topicCategoryNames: ['Pop music', 'Pop genres'] })

    expect(genreMatch(track, queryTokens('pop'))).toBe(1)
  })

  it('does not match an unrelated category', () => {
    const track = makeTrack({ topicCategoryNames: ['Electronic music', 'Music'] })

    expect(genreMatch(track, queryTokens('jazz'))).toBe(0)
  })

  it('matches a genre that one of several categories covers', () => {
    const track = makeTrack({ topicCategoryNames: ['Pop music', 'Music of Asia'] })

    expect(genreMatch(track, queryTokens('pop'))).toBe(1)
  })
})

describe('relevanceScore', () => {
  it('ranks an artist match above a genre match', () => {
    const artistTrack = makeTrack({ channelTitle: 'RickAstleyVEVO', title: 'Never Gonna Give You Up' })
    const genreTrack = makeTrack({
      channelTitle: 'Jazz Channel',
      title: 'Blue Train',
      topicCategoryNames: ['Jazz'],
    })

    expect(relevanceScore(artistTrack, 'rick astley')).toBeGreaterThan(
      relevanceScore(genreTrack, 'rick astley'),
    )
  })

  it('ranks a genre match above a track that matches neither', () => {
    const genreTrack = makeTrack({
      channelTitle: 'Jazz Channel',
      title: 'Blue Train',
      topicCategoryNames: ['Jazz'],
    })
    const otherTrack = makeTrack({ channelTitle: 'Other Channel', title: 'Unrelated Song' })

    expect(relevanceScore(genreTrack, 'jazz')).toBeGreaterThan(
      relevanceScore(otherTrack, 'jazz'),
    )
  })

  it('ranks a genre match above a title that only repeats the query', () => {
    const genreTrack = makeTrack({
      channelTitle: 'Retro Channel',
      title: 'Tokyo Sunset',
      topicCategoryNames: ['City pop music'],
    })
    const titleOnly = makeTrack({ channelTitle: 'City Pop Radio', title: 'Best of City Pop 2024' })

    expect(relevanceScore(genreTrack, 'city pop')).toBeGreaterThan(
      relevanceScore(titleOnly, 'city pop'),
    )
  })

  it('keeps a track that matches neither above zero', () => {
    const otherTrack = makeTrack({ channelTitle: 'Other Channel', title: 'Unrelated Song' })

    expect(relevanceScore(otherTrack, 'jazz')).toBeGreaterThan(0)
  })

  it('ranks the official channel above the upload channel', () => {
    const official = makeTrack({ channelTitle: 'Some Channel - Topic', title: 'Song Alpha' })
    const upload = makeTrack({ channelTitle: 'Some Channel', title: 'Song Alpha' })

    expect(relevanceScore(official, 'jazz')).toBeGreaterThan(relevanceScore(upload, 'jazz'))
  })
})

describe('rankByRelevance', () => {
  const genreTrack = makeTrack({
    videoId: 'vid-genre',
    channelTitle: 'Jazz Channel',
    title: 'Blue Train',
    topicCategoryNames: ['Jazz'],
  })
  const artistTrack = makeTrack({
    videoId: 'vid-artist',
    channelTitle: 'RickAstleyVEVO',
    title: 'Never Gonna Give You Up',
  })
  const otherTrack = makeTrack({
    videoId: 'vid-other',
    channelTitle: 'Other Channel',
    title: 'Unrelated Song',
  })

  it('reorders the tracks by how well they answer the query', () => {
    const ranked = rankByRelevance([otherTrack, genreTrack, artistTrack], 'jazz')

    expect(ranked.map((track) => track.videoId)).toEqual([
      'vid-genre',
      'vid-artist',
      'vid-other',
    ])
  })

  it('keeps the order of tracks that score the same', () => {
    const first = makeTrack({ videoId: 'first', channelTitle: 'Other Channel', title: 'Unrelated Song' })
    const second = makeTrack({
      videoId: 'second',
      channelTitle: 'Another Channel',
      title: 'Different Song',
    })

    const ranked = rankByRelevance([first, second], 'jazz')

    expect(ranked.map((track) => track.videoId)).toEqual(['first', 'second'])
  })

  it('leaves the input untouched', () => {
    const input = [otherTrack, genreTrack]

    rankByRelevance(input, 'jazz')

    expect(input.map((track) => track.videoId)).toEqual(['vid-other', 'vid-genre'])
  })

  it('preserves the element type', () => {
    const tracks: Array<Track & { marker: string }> = [
      { ...makeTrack({ videoId: 'kept' }), marker: 'kept' },
    ]

    const ranked = rankByRelevance(tracks, 'jazz')

    expect(ranked[0]?.marker).toBe('kept')
  })
})
