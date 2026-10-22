import { describe, expect, it } from 'vitest'

import { orderCandidates, scoreCandidate, selectPlaylist } from '@/lib/youtube/similar'
import { artistKey } from '@/lib/youtube/artist'
import type { Candidate } from '@/lib/youtube/types'

import { makeCandidate, makeOptions, makeTrack, videoIds } from '@/tests/helpers/fixtures'

const seed = makeTrack({
  videoId: 'seed0000001',
  title: 'Seed Artist - Seed Song',
  artist: 'Seed Artist',
  channelTitle: 'Seed Artist - Topic',
  topicId: '/m/seedtopic',
  topicName: 'Synth-pop',
  durationSec: 200,
})

const options = makeOptions()

describe('scoreCandidate', () => {
  it('is deterministic for a fixed input', () => {
    const options = makeOptions()
    const candidate = makeTrack({ videoId: 'cand0000001', title: 'Other Artist - Other Song' })

    const first = scoreCandidate(seed, candidate, ['related'], options)
    const second = scoreCandidate(seed, candidate, ['related'], options)

    expect(second).toEqual(first)
  })

  it('explains a shared Wikipedia topic with the topic name', () => {
    const options = makeOptions()
    const candidate = makeTrack({
      videoId: 'cand0000002',
      title: 'Other Artist - Other Song',
      channelTitle: 'Other Artist',
      topicId: '/m/seedtopic',
      topicName: 'Synth-pop',
    })

    const { reasons } = scoreCandidate(seed, candidate, ['related'], options)
    const labels = reasons.map((reason) => reason.label)

    expect(labels).toContain('Same Wikipedia topic (Synth-pop)')
  })

  it('explains an official artist channel', () => {
    const options = makeOptions()
    const candidate = makeTrack({
      videoId: 'cand0000003',
      title: 'Other Artist - Other Song',
      channelTitle: 'Other ArtistVEVO',
      topicId: '/m/othertopic',
    })

    const { reasons } = scoreCandidate(seed, candidate, ['related'], options)
    const labels = reasons.map((reason) => reason.label)

    expect(labels).toContain('Official artist channel')
  })

  it('explains a popular track with its view count', () => {
    const options = makeOptions({ includePopularity: true })
    const candidate = makeTrack({
      videoId: 'cand0000004',
      title: 'Other Artist - Other Song',
      channelTitle: 'Other Artist',
      topicId: '/m/othertopic',
      viewCount: 1_200_000,
    })

    const { reasons } = scoreCandidate(seed, candidate, ['related'], options)
    const labels = reasons.map((reason) => reason.label)

    expect(labels).toContain('Popular (1.2M views)')
  })

  it('gives every reason a machine-readable kind', () => {
    const options = makeOptions({ includePopularity: true })
    const candidate = makeTrack({
      videoId: 'cand0000005',
      title: 'Other Artist - Other Song',
      channelTitle: 'Other ArtistVEVO',
      topicId: '/m/seedtopic',
      topicName: 'Synth-pop',
    })

    const { reasons } = scoreCandidate(seed, candidate, ['related'], options)

    expect(reasons.length).toBeGreaterThan(0)
    for (const reason of reasons) {
      expect(typeof reason.kind).toBe('string')
      expect(reason.label.length).toBeGreaterThan(0)
    }
  })

  it('scores a candidate that shares nothing with the seed below one that shares the topic', () => {
    const options = makeOptions()
    const onTopic = makeTrack({
      videoId: 'cand0000006',
      title: 'Other Artist - On Topic',
      channelTitle: 'Other Artist',
      topicId: '/m/seedtopic',
    })
    const offTopic = makeTrack({
      videoId: 'cand0000007',
      title: 'Third Artist - Off Topic',
      channelTitle: 'Third Artist',
      topicId: '/m/othertopic',
    })

    expect(scoreCandidate(seed, onTopic, ['related'], options).score).toBeGreaterThan(
      scoreCandidate(seed, offTopic, ['related'], options).score,
    )
  })
})

describe('selectPlaylist', () => {
  it('drops the seed track itself', () => {
    const candidate = makeCandidate(seed, seed, options)

    const selected = selectPlaylist([candidate], options, { seedVideoIds: [seed.videoId] })

    expect(selected).toHaveLength(0)
  })

  it('drops a track that is not in the music category', () => {
    const candidate = makeCandidate(
      makeTrack({ videoId: 'cand0000010', title: 'A - Song', categoryId: '1' }),
      seed,
      options,
    )

    const selected = selectPlaylist([candidate], options)

    expect(selected).toHaveLength(0)
  })

  it('drops a track that is shorter than the duration window', () => {
    const candidate = makeCandidate(
      makeTrack({ videoId: 'cand0000011', title: 'A - Short', durationSec: 10 }),
      seed,
      options,
    )

    expect(selectPlaylist([candidate], options)).toHaveLength(0)
  })

  it('drops a track that is longer than the duration window', () => {
    const candidate = makeCandidate(
      makeTrack({ videoId: 'cand0000012', title: 'A - Long', durationSec: 1_500 }),
      seed,
      options,
    )

    expect(selectPlaylist([candidate], options)).toHaveLength(0)
  })

  it('drops a live version that is not on the allow-list', () => {
    const candidate = makeCandidate(
      makeTrack({ videoId: 'cand0000013', title: 'A - Live Song (Live)' }),
      seed,
      options,
    )

    expect(selectPlaylist([candidate], options)).toHaveLength(0)
  })

  it('keeps a live version that is on the allow-list', () => {
    const liveOptions = makeOptions({ includeVersions: ['live'] })
    const candidate = makeCandidate(
      makeTrack({ videoId: 'cand0000014', title: 'A - Live Song (Live)' }),
      seed,
      liveOptions,
    )

    expect(selectPlaylist([candidate], liveOptions)).toHaveLength(1)
  })

  it('never selects more tracks per artist than the cap allows', () => {
    const capped = makeOptions({ maxPerArtist: 1 })
    const candidates = [
      makeCandidate(makeTrack({ videoId: 'cand0000015', title: 'Alpha - One' }), seed, capped),
      makeCandidate(makeTrack({ videoId: 'cand0000016', title: 'Alpha - Two' }), seed, capped),
      makeCandidate(makeTrack({ videoId: 'cand0000017', title: 'Alpha - Three' }), seed, capped),
    ]

    const selected = selectPlaylist(candidates, capped)

    expect(selected).toHaveLength(1)
  })

  it('never selects the same track twice', () => {
    const duplicate = makeOptions()
    const candidates = [
      makeCandidate(makeTrack({ videoId: 'cand0000018', title: 'Alpha - Same Song' }), seed, duplicate),
      makeCandidate(makeTrack({ videoId: 'cand0000019', title: 'Alpha - Same Song' }), seed, duplicate),
    ]

    const selected = selectPlaylist(candidates, duplicate)

    expect(selected).toHaveLength(1)
  })

  it('truncates the playlist to the requested count', () => {
    const small = makeOptions({ count: 2, maxPerArtist: 5 })
    const candidates = [
      makeCandidate(makeTrack({ videoId: 'cand0000020', title: 'Alpha - One' }), seed, small),
      makeCandidate(makeTrack({ videoId: 'cand0000021', title: 'Beta - Two' }), seed, small),
      makeCandidate(makeTrack({ videoId: 'cand0000022', title: 'Gamma - Three' }), seed, small),
    ]

    expect(selectPlaylist(candidates, small)).toHaveLength(2)
  })

  it('keeps a track the seed artist made when the seed artist is not hidden', () => {
    const candidates = [
      makeCandidate(makeTrack({ videoId: 'cand0000023', title: 'Seed Artist - Same' }), seed, options),
    ]

    expect(selectPlaylist(candidates, options)).toHaveLength(1)
  })
})

describe('orderCandidates', () => {
  const candidates: Candidate[] = [
    makeCandidate(makeTrack({ videoId: 'ord0000001', title: 'Alpha - One' }), seed, options),
    makeCandidate(makeTrack({ videoId: 'ord0000002', title: 'Beta - Two' }), seed, options),
    makeCandidate(makeTrack({ videoId: 'ord0000003', title: 'Gamma - Three' }), seed, options),
    makeCandidate(makeTrack({ videoId: 'ord0000004', title: 'Delta - Four' }), seed, options),
    makeCandidate(makeTrack({ videoId: 'ord0000005', title: 'Epsilon - Five' }), seed, options),
    makeCandidate(makeTrack({ videoId: 'ord0000006', title: 'Zeta - Six' }), seed, options),
    makeCandidate(makeTrack({ videoId: 'ord0000007', title: 'Eta - Seven' }), seed, options),
    makeCandidate(makeTrack({ videoId: 'ord0000008', title: 'Theta - Eight' }), seed, options),
  ]

  it('produces the same order for the same shuffle seed', () => {
    const shuffled = makeOptions({ order: 'shuffle', shuffleSeed: 42 })

    const first = videoIds(orderCandidates(candidates, shuffled))
    const second = videoIds(orderCandidates(candidates, shuffled))

    expect(second).toEqual(first)
  })

  it('produces a different order for a different shuffle seed', () => {
    const first = videoIds(orderCandidates(candidates, makeOptions({ order: 'shuffle', shuffleSeed: 42 })))
    const second = videoIds(orderCandidates(candidates, makeOptions({ order: 'shuffle', shuffleSeed: 7 })))

    expect(second).not.toEqual(first)
  })

  it('keeps every candidate exactly once when shuffling', () => {
    const shuffled = makeOptions({ order: 'shuffle', shuffleSeed: 42 })

    const ordered = videoIds(orderCandidates(candidates, shuffled))

    expect(ordered).toHaveLength(candidates.length)
    expect([...ordered].sort()).toEqual(videoIds(candidates).sort())
  })

  it('orders by artist when asked to', () => {
    const ordered = orderCandidates(candidates, makeOptions({ order: 'artist' }))

    const artists = ordered.map((candidate) => artistKey(candidate.artist))
    expect([...artists].sort()).toEqual(artists)
  })

  it('does not mutate the list it was given', () => {
    const before = videoIds(candidates)

    orderCandidates(candidates, makeOptions({ order: 'artist' }))

    expect(videoIds(candidates)).toEqual(before)
  })
})
