import type { SourceKind, Track } from './types'

/**
 * Demo dataset.
 *
 * Every entry is a real, public YouTube video — the id, the thumbnail URL and
 * the title are genuine, verified against the YouTube oEmbed endpoint. The
 * topic ids are demo-scoped (`demo:<genre>`) rather than real Wikipedia topic
 * ids, because a fabricated `/m/xxxx` would point at the wrong entity.
 *
 * The app uses this whenever no `YOUTUBE_API_KEY` is configured, so the whole
 * flow — search, discover, score, create — is usable without credentials.
 * The demo therefore has to behave like the live engine: the same fields are
 * filled, and the same filters apply.
 */

const THUMB = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`

type Seed = Omit<Track, 'thumbnail' | 'topicId' | 'categoryId'> & {
  topic: string
  categoryId?: string
}

/**
 * A synthetic channel id for a demo track.
 *
 * The demo catalogue carries no real channel ids, so a stable slug of the
 * channel name stands in. The scheme matches the demo channel ids in
 * `lib/youtube/search.ts`, so a demo seed and a demo track agree on which
 * "channel" they belong to — that is what lets the artist-radio source work
 * in demo mode too.
 */
export function demoChannelId(channelTitle: string): string {
  return `demo:${channelTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`
}

const RAW: Seed[] = [
  // ── Synth-pop / electro-pop ─────────────────────────────────────────────
  {
    videoId: '4NRXx6U8ABQ',
    title: 'Blinding Lights',
    artist: 'The Weeknd',
    channelTitle: 'TheWeekndVEVO',
    durationSec: 200,
    topic: 'Synth-pop',
    topicName: 'Synth-pop',
    viewCount: 1_900_000_000,
    publishedAt: '2019-11-29T00:00:00Z',
  },
  {
    videoId: 'CevxZvSJLk8',
    title: 'Roar',
    artist: 'Katy Perry',
    channelTitle: 'KatyPerryVEVO',
    durationSec: 221,
    topic: 'Pop',
    topicName: 'Pop',
    viewCount: 1_400_000_000,
    publishedAt: '2013-08-27T00:00:00Z',
  },
  {
    videoId: 'AJtDXIazrMo',
    title: 'Love Me Like You Do',
    artist: 'Ellie Goulding',
    channelTitle: 'EllieGouldingVEVO',
    durationSec: 214,
    topic: 'Electropop',
    topicName: 'Electropop',
    viewCount: 1_100_000_000,
    publishedAt: '2015-02-06T00:00:00Z',
  },
  {
    videoId: '60ItHLz5WEA',
    title: 'Faded',
    artist: 'Alan Walker',
    channelTitle: 'Alan Walker',
    durationSec: 212,
    topic: 'Electro house',
    topicName: 'Electro house',
    viewCount: 3_600_000_000,
    publishedAt: '2015-12-17T00:00:00Z',
  },
  {
    videoId: '5NV6Rdv1a3I',
    title: 'Get Lucky',
    artist: 'Daft Punk',
    channelTitle: 'DaftPunkVEVO',
    durationSec: 369,
    topic: 'Electro house',
    topicName: 'Electro house',
    viewCount: 900_000_000,
    publishedAt: '2013-05-17T00:00:00Z',
  },

  // ── Pop ─────────────────────────────────────────────────────────────────
  {
    videoId: 'JGwWNGJdvx8',
    title: 'Shape of You',
    artist: 'Ed Sheeran',
    channelTitle: 'Ed Sheeran',
    durationSec: 234,
    topic: 'Pop',
    topicName: 'Pop',
    viewCount: 3_800_000_000,
    publishedAt: '2017-03-30T00:00:00Z',
  },
  {
    videoId: '2Vv-BfVoq4g',
    title: 'Perfect',
    artist: 'Ed Sheeran',
    channelTitle: 'Ed Sheeran',
    durationSec: 263,
    topic: 'Pop',
    topicName: 'Pop',
    viewCount: 1_900_000_000,
    publishedAt: '2017-11-03T00:00:00Z',
  },
  {
    videoId: 'QcIy9NiNbmo',
    title: 'Bad Blood',
    artist: 'Taylor Swift',
    channelTitle: 'Taylor Swift',
    durationSec: 219,
    topic: 'Pop',
    topicName: 'Pop',
    viewCount: 1_600_000_000,
    publishedAt: '2014-10-22T00:00:00Z',
  },
  {
    videoId: 'e-ORhEE9VVg',
    title: 'Blank Space',
    artist: 'Taylor Swift',
    channelTitle: 'Taylor Swift',
    durationSec: 231,
    topic: 'Pop',
    topicName: 'Pop',
    viewCount: 1_500_000_000,
    publishedAt: '2014-11-27T00:00:00Z',
  },
  {
    videoId: '0KSOMA3QBU0',
    title: 'Dark Horse',
    artist: 'Katy Perry',
    channelTitle: 'KatyPerryVEVO',
    durationSec: 215,
    topic: 'Pop',
    topicName: 'Pop',
    viewCount: 1_100_000_000,
    publishedAt: '2013-10-27T00:00:00Z',
  },
  {
    videoId: '450p7goxZqg',
    title: 'All of Me',
    artist: 'John Legend',
    channelTitle: 'johnlegendVEVO',
    durationSec: 269,
    topic: 'Contemporary R&B',
    topicName: 'Contemporary R&B',
    viewCount: 1_500_000_000,
    publishedAt: '2013-12-13T00:00:00Z',
  },
  {
    videoId: 'YQHsXMglC9A',
    title: 'Hello',
    artist: 'Adele',
    channelTitle: 'Adele',
    durationSec: 295,
    topic: 'Contemporary R&B',
    topicName: 'Contemporary R&B',
    viewCount: 2_600_000_000,
    publishedAt: '2015-10-23T00:00:00Z',
  },

  // ── Rock / alternative ──────────────────────────────────────────────────
  {
    videoId: 'hTWKbfoikeg',
    title: 'Smells Like Teen Spirit',
    artist: 'Nirvana',
    channelTitle: 'NirvanaVEVO',
    durationSec: 302,
    topic: 'Grunge',
    topicName: 'Grunge',
    viewCount: 1_400_000_000,
    publishedAt: '1991-09-02T00:00:00Z',
  },
  {
    videoId: 'kXYiU_JCYtU',
    title: 'Numb',
    artist: 'Linkin Park',
    channelTitle: 'Linkin Park',
    durationSec: 209,
    topic: 'Nu metal',
    topicName: 'Nu metal',
    viewCount: 1_600_000_000,
    publishedAt: '2002-11-20T00:00:00Z',
  },
  {
    videoId: '7wtfhZwyrcc',
    title: 'Believer',
    artist: 'Imagine Dragons',
    channelTitle: 'ImagineDragonsVEVO',
    durationSec: 204,
    topic: 'Alternative rock',
    topicName: 'Alternative rock',
    viewCount: 1_700_000_000,
    publishedAt: '2017-03-24T00:00:00Z',
  },
  {
    videoId: 'fJ9rUzIMcZQ',
    title: 'Bohemian Rhapsody',
    artist: 'Queen',
    channelTitle: 'Queen Official',
    durationSec: 354,
    topic: 'Rock',
    topicName: 'Rock',
    viewCount: 1_500_000_000,
    publishedAt: '1975-10-31T00:00:00Z',
  },
  {
    videoId: '8UVNT4wvIGY',
    title: 'Somebody That I Used To Know',
    artist: 'Gotye',
    channelTitle: 'Gotye',
    durationSec: 258,
    topic: 'Indie pop',
    topicName: 'Indie pop',
    viewCount: 800_000_000,
    publishedAt: '2011-12-20T00:00:00Z',
  },

  // ── Hip hop / funk / dance ──────────────────────────────────────────────
  {
    videoId: 'kJQP7kiw5Fk',
    title: 'Despacito',
    artist: 'Luis Fonsi',
    channelTitle: 'LuisFonsiVEVO',
    durationSec: 229,
    topic: 'Latin pop',
    topicName: 'Latin pop',
    viewCount: 3_100_000_000,
    publishedAt: '2017-04-24T00:00:00Z',
  },
  {
    videoId: '9bZkp7q19f0',
    title: 'Gangnam Style',
    artist: 'PSY',
    channelTitle: 'officialpsy',
    durationSec: 219,
    topic: 'K-pop',
    topicName: 'K-pop',
    viewCount: 3_600_000_000,
    publishedAt: '2012-07-15T00:00:00Z',
  },
  {
    videoId: 'OPf0YbXqDm0',
    title: 'Uptown Funk',
    artist: 'Mark Ronson',
    channelTitle: 'MarkRonsonVEVO',
    durationSec: 343,
    topic: 'Funk',
    topicName: 'Funk',
    viewCount: 2_100_000_000,
    publishedAt: '2014-11-10T00:00:00Z',
  },
  {
    videoId: 'ZbZSe6N_BXs',
    title: 'Happy',
    artist: 'Pharrell Williams',
    channelTitle: 'PharrellWilliamsVEVO',
    durationSec: 225,
    topic: 'Funk',
    topicName: 'Funk',
    viewCount: 1_800_000_000,
    publishedAt: '2013-11-21T00:00:00Z',
  },
  {
    videoId: 'RgKAFK5djSk',
    title: 'See You Again',
    artist: 'Wiz Khalifa',
    channelTitle: 'Wiz Khalifa Music',
    durationSec: 229,
    topic: 'Hip hop',
    topicName: 'Hip hop',
    viewCount: 4_200_000_000,
    publishedAt: '2015-06-17T00:00:00Z',
  },
  {
    videoId: 'dQw4w9WgXcQ',
    title: 'Never Gonna Give You Up',
    artist: 'Rick Astley',
    channelTitle: 'Rick Astley',
    durationSec: 213,
    topic: 'Dance-pop',
    topicName: 'Dance-pop',
    viewCount: 1_600_000_000,
    publishedAt: '1987-07-27T00:00:00Z',
    // Synthetic demo restriction. The live API reports real
    // `contentDetails.regionRestriction` values; the demo marks one entry so
    // the region-safety filter is visible without an API key. It is demo
    // data, not a claim about the real video.
    regionRestriction: { blocked: ['ID'] },
  },

  // ── Electronic ──────────────────────────────────────────────────────────
  {
    videoId: 'y6120QOlsfU',
    title: 'Sandstorm',
    artist: 'Darude',
    channelTitle: 'Darude',
    durationSec: 166,
    topic: 'Trance',
    topicName: 'Trance',
    viewCount: 1_100_000_000,
    publishedAt: '2009-12-15T00:00:00Z',
  },
  {
    videoId: '5qap5aO4i9A',
    title: 'lofi hip hop radio — beats to relax/study to',
    artist: 'Lofi Girl',
    channelTitle: 'Lofi Girl',
    durationSec: 0,
    topic: 'Lo-fi',
    topicName: 'Lo-fi',
    viewCount: 9_800_000_000,
    publishedAt: '2017-08-10T00:00:00Z',
  },

  // ── Deliberately not music: proves the category filter works ───────────
  {
    videoId: '3JZ_D3ELwOQ',
    title: 'Flexin On Ya',
    artist: 'Ray William Johnson',
    channelTitle: 'Ray William Johnson',
    durationSec: 196,
    topic: 'Comedy',
    topicName: 'Comedy',
    viewCount: 60_000_000,
    publishedAt: '2014-05-19T00:00:00Z',
    categoryId: '1',
  },
]

/**
 * The built-in catalogue.
 *
 * It is the app's answer to "no API key yet": a fixed set of real,
 * publicly available music videos that carry the same fields a hydrated
 * track carries, so the engine scores them exactly as it scores live data.
 */
export const DEMO_TRACKS: Track[] = RAW.map((entry) => ({
  videoId: entry.videoId,
  title: entry.title,
  artist: entry.artist,
  channelTitle: entry.channelTitle,
  durationSec: entry.durationSec,
  thumbnail: THUMB(entry.videoId),
  topicId: `demo:${entry.topic.toLowerCase().replace(/\s+/g, '-')}`,
  topicName: entry.topicName,
  viewCount: entry.viewCount,
  publishedAt: entry.publishedAt,
  categoryId: entry.categoryId ?? '10',
  // The same fields the live hydrator fills, so the demo runs through the
  // same engine and the same filters.
  channelId: demoChannelId(entry.channelTitle),
  topicCategories: [entry.topicName],
  topicCategoryNames: [entry.topicName],
  liveBroadcastContent: 'none',
  regionRestriction: entry.regionRestriction,
}))

/**
 * Which source surfaces a track — mirrors how the live engine attributes them.
 *
 * The live pipeline learns this from the actual sources it queried; the demo
 * infers it from the catalogue, using the same source vocabulary so the
 * cross-source bonus means the same thing in both modes.
 */
export function demoSources(track: Track, seed: Track): SourceKind[] {
  const sources = new Set<SourceKind>()

  const sameChannel = Boolean(track.channelId) && track.channelId === seed.channelId
  if (sameChannel || track.artist === seed.artist) sources.add('artistRadio')

  if (track.topicId && seed.topicId && track.topicId === seed.topicId) sources.add('topic')
  if (track.viewCount > 1_500_000_000) sources.add('trending')
  if (sources.size === 0) sources.add('related')

  return [...sources]
}
