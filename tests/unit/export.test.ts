import { describe, expect, it } from 'vitest'

import {
  parseTracksInput,
  renderExport,
  slugifyFilename,
  toCsv,
  toJson,
  toM3u,
} from '@/lib/export'

import { makeTrack } from '@/tests/helpers/fixtures'

const first = makeTrack({
  videoId: 'vid00000001',
  title: 'Song Alpha',
  artist: 'Artist One',
  channelTitle: 'Artist One - Topic',
  durationSec: 200,
  publishedAt: '2020-01-01T00:00:00Z',
})

const second = makeTrack({
  videoId: 'vid00000002',
  title: 'Song Beta',
  artist: 'Artist Two',
  channelTitle: 'Artist Two - Topic',
  durationSec: 185,
  publishedAt: '2021-06-15T00:00:00Z',
})

describe('toM3u', () => {
  it('starts the playlist with the M3U directive', () => {
    expect(toM3u([first]).split('\n')[0]).toBe('#EXTM3U')
  })

  it('writes one EXTINF directive per track', () => {
    const lines = toM3u([first, second]).split('\n')

    expect(lines.filter((line) => line.startsWith('#EXTINF')).length).toBe(2)
  })

  it('writes one URL per track', () => {
    const lines = toM3u([first, second]).split('\n')

    expect(
      lines.filter((line) => line.startsWith('https://music.youtube.com/watch?v=')).length,
    ).toBe(2)
  })

  it('carries the duration and the track name in the directive', () => {
    expect(toM3u([first])).toContain('#EXTINF:200,Artist One - Song Alpha')
  })
  it('points every URL at the video it belongs to', () => {
    expect(toM3u([first, second])).toContain('https://music.youtube.com/watch?v=vid00000001')
    expect(toM3u([first, second])).toContain('https://music.youtube.com/watch?v=vid00000002')
  })

  it('keeps a newline inside a title from breaking the file', () => {
    const broken = makeTrack({ videoId: 'vid00000003', title: 'Artist\nSong Gamma' })
    const lines = toM3u([broken]).split('\n')

    expect(lines.filter((line) => line.startsWith('#EXTINF')).length).toBe(1)
    expect(lines.filter((line) => line.startsWith('https://')).length).toBe(1)
  })
})

describe('toCsv', () => {
  it('writes the documented header row', () => {
    expect(toCsv([first]).split('\r\n')[0]).toBe(
      'position,videoId,title,artist,channelTitle,durationSec,year,url',
    )
  })

  it('writes one row per track', () => {
    const rows = toCsv([first, second]).trim().split('\r\n')

    expect(rows).toHaveLength(3)
  })

  it('writes eight columns per row', () => {
    const row = toCsv([first]).trim().split('\r\n')[1]

    expect(row.split(',')).toHaveLength(8)
  })

  it('quotes every field of a data row', () => {
    const row = toCsv([first]).trim().split('\r\n')[1]

    expect(row).toBe(
      '"1","vid00000001","Song Alpha","Artist One","Artist One - Topic","200","2020","https://music.youtube.com/watch?v=vid00000001"',
    )
  })

  it('escapes a comma inside a title without adding a column', () => {
    const comma = makeTrack({ videoId: 'vid00000004', title: 'Love, Actually' })
    const row = toCsv([comma]).trim().split('\r\n')[1]

    expect(row).toContain('"Love, Actually"')
    expect(row.split(',')).toHaveLength(9)
  })

  it('doubles an inner quote so the field stays one field', () => {
    const quoted = makeTrack({ videoId: 'vid00000005', title: 'Say "Hello"' })
    const row = toCsv([quoted]).trim().split('\r\n')[1]

    expect(row).toContain('"Say ""Hello"""')
  })

  it('leaves the year empty when the release date is unknown', () => {
    const undated = makeTrack({ videoId: 'vid00000006', publishedAt: '' })
    const row = toCsv([undated]).trim().split('\r\n')[1]

    expect(row).toContain('""')
    expect(row).not.toContain('NaN')
  })

  it('can leave out the header row', () => {
    expect(toCsv([first], { includeHeader: false }).startsWith('"1"')).toBe(true)
  })
})

describe('toJson', () => {
  it('parses as JSON', () => {
    expect(() => JSON.parse(toJson([first], { generatedAt: '2025-01-01T00:00:00.000Z' }))).not.toThrow()
  })

  it('holds every track', () => {
    const payload = JSON.parse(toJson([first, second], { generatedAt: '2025-01-01T00:00:00.000Z' }))

    expect(payload.tracks).toHaveLength(2)
    expect(payload.tracks[0].videoId).toBe('vid00000001')
    expect(payload.tracks[1].videoId).toBe('vid00000002')
  })

  it('carries the canonical metadata a rebuild needs', () => {
    const payload = JSON.parse(toJson([first], { generatedAt: '2025-01-01T00:00:00.000Z' }))

    expect(payload.tracks[0].url).toBe('https://music.youtube.com/watch?v=vid00000001')
    expect(payload.tracks[0].durationSec).toBe(200)
    expect(payload.tracks[0].artist).toBe('Artist One')
    expect(payload.tracks[0].topicName).toBe('Synth-pop')
  })

  it('stamps the manifest with the time it was asked for', () => {
    const payload = JSON.parse(toJson([first], { generatedAt: '2025-01-01T00:00:00.000Z' }))

    expect(payload.generatedAt).toBe('2025-01-01T00:00:00.000Z')
  })

  it('names the export after the playlist', () => {
    const payload = JSON.parse(toJson([first], { title: 'My mix' }))

    expect(payload.title).toBe('My mix')
  })
})

describe('parseTracksInput', () => {
  it('accepts a bare list of video ids', () => {
    const tracks = parseTracksInput(['vid00000001', 'vid00000002'])

    expect(tracks).toHaveLength(2)
    expect(tracks[0].videoId).toBe('vid00000001')
  })

  it('accepts a list of full track objects', () => {
    const tracks = parseTracksInput([
      { videoId: 'vid00000001', title: 'Song Alpha', artist: 'Artist One', durationSec: 200 },
    ])

    expect(tracks[0].title).toBe('Song Alpha')
    expect(tracks[0].artist).toBe('Artist One')
    expect(tracks[0].durationSec).toBe(200)
  })

  it('unwraps a payload that carries the tracks under a key', () => {
    const tracks = parseTracksInput({ tracks: [{ videoId: 'vid00000001' }] })

    expect(tracks).toHaveLength(1)
  })

  it('drops an entry that carries no usable id', () => {
    expect(parseTracksInput([{ title: 'No id here' }])).toHaveLength(0)
    expect(parseTracksInput([{}])).toHaveLength(0)
  })

  it('rejects junk', () => {
    expect(parseTracksInput([42, null, undefined, {}, [], true])).toHaveLength(0)
    expect(parseTracksInput(null)).toHaveLength(0)
    expect(parseTracksInput(42)).toHaveLength(0)
  })

  it('reads a bare string as a single video id', () => {
    const tracks = parseTracksInput('vid00000001')

    expect(tracks).toHaveLength(1)
    expect(tracks[0].videoId).toBe('vid00000001')
  })

  it('drops a blank id rather than rendering a broken line', () => {
    expect(parseTracksInput(['   '])).toHaveLength(0)
  })

  it('gives a bare id a complete track to render', () => {
    const tracks = parseTracksInput(['vid00000001'])

    expect(tracks[0].title).toBe('Unknown title')
    expect(tracks[0].artist).toBe('Unknown artist')
  })
})

describe('renderExport', () => {
  it('names the file after the playlist and the track count', () => {
    const rendered = renderExport('csv', [first, second], { title: 'My mix' })

    expect(rendered.filename).toBe('my-mix-2-tracks.csv')
    expect(rendered.contentType).toContain('text/csv')
  })

  it('never lets a file name escape the download folder', () => {
    expect(slugifyFilename('../../etc/passwd')).toBe('etc-passwd')
  })

  it('falls back to a plain name for a title with nothing usable', () => {
    expect(slugifyFilename('!!!')).toBe('playlist')
  })

  /**
   * The client-side export button renders the candidates it already holds,
   * so the list that reaches a renderer is a `Candidate` — a `Track` plus
   * the scoring fields. The extra fields have to be harmless: the client
   * never has to strip them before rendering.
   */
  it('renders a candidate list without being told to strip the scoring fields', () => {
    const candidate = {
      ...first,
      sources: ['related', 'topic'] as const,
      score: 42,
      reasons: [{ label: 'Same topic', points: 21 }],
      versionTags: ['official'] as const,
      official: true,
    }

    const rendered = renderExport('m3u', [candidate], { title: 'My mix' })

    expect(rendered.filename).toBe('my-mix-1-tracks.m3u')
    expect(rendered.body).toContain('#EXTINF:200,Artist One - Song Alpha')
    expect(rendered.body).toContain('https://music.youtube.com/watch?v=vid00000001')
  })

  it('names a download after the playlist the user typed, not the seed', () => {
    const rendered = renderExport('json', [first, second], { title: 'Late Night Drive' })

    expect(rendered.filename).toBe('late-night-drive-2-tracks.json')
  })

  it('falls back to a plain file name when the user has not typed a title', () => {
    const rendered = renderExport('text', [first], {})

    expect(rendered.filename).toBe('playlist-1-tracks.txt')
  })
})
