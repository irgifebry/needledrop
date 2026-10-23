import { afterEach, beforeEach, describe, expect, it, test, vi } from 'vitest'

import { resetCache } from '@/lib/cache'
import { resetEnv } from '@/lib/env'
import { createMeter } from '@/lib/youtube/client'
import { isRegionSafe, regionLabel } from '@/lib/youtube/regions'
import { searchSeeds, trackFromVideo } from '@/lib/youtube/search'

/**
 * Contract tests for the Data API boundary (PLAN §4 stages 1–2, PLAN-ADDENDUM
 * §34).
 *
 * The fixtures below are hand-written to look exactly like a real
 * `videos.list` and `search.list` response, so a rename in the API — the
 * field-name drift the addendum warns about — shows up here first.
 *
 * No request leaves the process: `global.fetch` is stubbed and every call is
 * asserted, so a test can never spend a unit of the real quota.
 */

/* ── fixtures ───────────────────────────────────────────────────────────── */

/** One `videos.list` item, shaped like the real API. */
const VIDEO_ITEM = {
  kind: 'youtube#video',
  etag: 'ETag/"vz0"',
  id: 'dQw4w9WgXcQ',
  snippet: {
    publishedAt: '2009-10-25T06:57:33Z',
    channelId: 'UCuAXFkgsw1L7xaCfnd5JJOw',
    title: 'Rick Astley - Never Gonna Give You Up (Official Music Video)',
    description: 'The official video for "Never Gonna Give You Up".',
    thumbnails: {
      default: { url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/default.jpg' },
      high: { url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' },
    },
    channelTitle: 'RickAstleyVEVO',
    tags: ['rick astley', 'never gonna give you up'],
    categoryId: '10',
    liveBroadcastContent: 'none',
    defaultLanguage: 'en',
  },
  contentDetails: {
    duration: 'PT3M33S',
    dimension: '2d',
    definition: 'high',
    caption: 'false',
    regionRestriction: { blocked: ['DE', 'FR'] },
    contentRating: {},
  },
  statistics: { viewCount: '1400000000', likeCount: '16000000' },
  topicDetails: {
    topicId: '/m/0dqgn',
    topicCategories: ['https://en.wikipedia.org/wiki/Category:New_wave_music'],
    topicCategoryLinks: [
      {
        url: 'https://en.wikipedia.org/wiki/Category:New_wave_music',
        title: 'New wave music',
      },
    ],
  },
}

/**
 * A second item with no restriction at all.
 *
 * The fictional `snippet.availableCountries` is included on purpose: the
 * Data API v3 does not return it, so a hydrator that trusted it would be
 * reading a field that does not exist (PLAN-ADDENDUM §34 correction 1).
 */
const UNRESTRICTED_VIDEO_ITEM = {
  ...VIDEO_ITEM,
  id: '9bZkp7q19f0',
  snippet: {
    ...VIDEO_ITEM.snippet,
    channelId: 'UCuAXFkgsw1L7xaCfnd5JJOw',
    title: 'Gangnam Style',
    channelTitle: 'PsyVEVO',
    availableCountries: ['ID', 'SG'],
    liveBroadcastContent: 'none',
  },
  contentDetails: {
    duration: 'PT4M13S',
    dimension: '2d',
    definition: 'high',
    caption: 'false',
    contentRating: {},
  },
  statistics: { viewCount: '4700000000', likeCount: '24000000' },
  topicDetails: {
    topicId: '/m/07j7r',
    topicCategories: ['https://en.wikipedia.org/wiki/Category:Eurodance'],
  },
}

const VIDEOS_LIST_FIXTURE = {
  kind: 'youtube#videoListResponse',
  etag: 'ETag/"vy"',
  pageInfo: { totalResults: 2, resultsPerPage: 2 },
  items: [VIDEO_ITEM, UNRESTRICTED_VIDEO_ITEM],
}

const SEARCH_LIST_FIXTURE = {
  kind: 'youtube#searchListResponse',
  etag: 'ETag/"sy"',
  regionCode: 'ID',
  pageInfo: { totalResults: 2, resultsPerPage: 2 },
  items: [
    {
      kind: 'youtube#searchResult',
      id: { kind: 'youtube#video', videoId: 'dQw4w9WgXcQ' },
      snippet: {
        publishedAt: '2009-10-25T06:57:33Z',
        channelId: 'UCuAXFkgsw1L7xaCfnd5JJOw',
        title: 'Rick Astley - Never Gonna Give You Up (Official Music Video)',
        channelTitle: 'RickAstleyVEVO',
        categoryId: '10',
        liveBroadcastContent: 'none',
      },
    },
    {
      kind: 'youtube#searchResult',
      id: { kind: 'youtube#video', videoId: '9bZkp7q19f0' },
      snippet: {
        publishedAt: '2012-07-15T00:00:00Z',
        channelId: 'UCuAXFkgsw1L7xaCfnd5JJOw',
        title: 'Gangnam Style',
        channelTitle: 'PsyVEVO',
        categoryId: '10',
        liveBroadcastContent: 'none',
      },
    },
  ],
}

/* ── harness ────────────────────────────────────────────────────────────── */

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

let requestedUrls: string[] = []

/** The path of a requested URL, without the query string. */
function pathOf(url: string): string {
  return new URL(url).pathname
}

beforeEach(() => {
  requestedUrls = []
  process.env.YOUTUBE_API_KEY = 'test-key-for-the-contract-suite'
  resetEnv()
  // The search is cached and the cache is a process-wide singleton, so a
  // stale entry from the previous test would answer the next one without
  // touching the network. Each test here asserts on the request that was
  // made, so each one needs a cold cache.
  resetCache()

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input)
      requestedUrls.push(url)

      if (pathOf(url) === '/youtube/v3/search') return jsonResponse(SEARCH_LIST_FIXTURE)
      if (pathOf(url) === '/youtube/v3/videos') return jsonResponse(VIDEOS_LIST_FIXTURE)

      return jsonResponse({ error: { message: 'unexpected operation', errors: [{ reason: 'unknown' }] } })
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.YOUTUBE_API_KEY
  resetEnv()
})

/* ── the mapping ────────────────────────────────────────────────────────── */

describe('the videos.list mapping', () => {
  it('maps the video id onto the track', () => {
    const track = trackFromVideo(VIDEO_ITEM)

    expect(track?.videoId).toBe('dQw4w9WgXcQ')
  })

  it('maps the snippet onto the track', () => {
    const track = trackFromVideo(VIDEO_ITEM)

    expect(track?.title).toBe('Rick Astley - Never Gonna Give You Up (Official Music Video)')
    expect(track?.channelTitle).toBe('RickAstleyVEVO')
    expect(track?.artist).toBe('RickAstleyVEVO')
    expect(track?.publishedAt).toBe('2009-10-25T06:57:33Z')
    expect(track?.categoryId).toBe('10')
  })

  it('turns the ISO-8601 duration into seconds', () => {
    expect(trackFromVideo(VIDEO_ITEM)?.durationSec).toBe(213)
    expect(trackFromVideo(UNRESTRICTED_VIDEO_ITEM)?.durationSec).toBe(253)
  })

  it('maps the topic id onto the track', () => {
    expect(trackFromVideo(VIDEO_ITEM)?.topicId).toBe('/m/0dqgn')
  })

  it('maps the topic category onto a readable topic name', () => {
    const track = trackFromVideo(VIDEO_ITEM)

    expect(track?.topicName).toContain('New Wave Music')
  })

  it('turns the string view count into a number', () => {
    expect(trackFromVideo(VIDEO_ITEM)?.viewCount).toBe(1_400_000_000)
  })

  it('builds the thumbnail url from the video id', () => {
    expect(trackFromVideo(VIDEO_ITEM)?.thumbnail).toContain('dQw4w9WgXcQ')
  })

  it('returns nothing for an item without an id', () => {
    expect(trackFromVideo({ ...VIDEO_ITEM, id: undefined })).toBeNull()
  })

  it('reports no region restriction when the API reported none', () => {
    const track = trackFromVideo(UNRESTRICTED_VIDEO_ITEM)

    expect(track?.regionRestriction).toBeUndefined()
  })

  it('never invents a restriction out of the fictional availableCountries field', () => {
    const track = trackFromVideo(UNRESTRICTED_VIDEO_ITEM)

    expect(isRegionSafe(track ?? {}, 'ID')).toBe(true)
    expect(regionLabel(track?.availableCountries)).toBe('No region restriction reported')
  })
})

/* ── the pipeline ───────────────────────────────────────────────────────── */

describe('the search-to-track pipeline', () => {
  it('hydrates every search hit into a track', async () => {
    const meter = createMeter()

    const tracks = await searchSeeds('rick astley', meter)

    // The Rick Astley hit is an "Official Music Video" on a VEVO channel,
    // so the music-only filter drops it; only the Gangnam Style recording
    // survives.
    expect(tracks).toHaveLength(1)
    expect(tracks[0].videoId).toBe('9bZkp7q19f0')
    expect(tracks[0].durationSec).toBe(253)
  })

  it('asks the search for the music category only', async () => {
    const meter = createMeter()

    await searchSeeds('rick astley', meter)

    const searchUrl = requestedUrls.find((url) => pathOf(url) === '/youtube/v3/search')
    expect(searchUrl).toBeDefined()
    expect(searchUrl).toContain('videoCategoryId=10')
    expect(searchUrl).toContain('type=video')
  })

  it('asks the video list for the parts that carry the metadata', async () => {
    const meter = createMeter()

    await searchSeeds('rick astley', meter)

    const videosUrl = requestedUrls.find((url) => pathOf(url) === '/youtube/v3/videos')
    expect(videosUrl).toBeDefined()
    expect(videosUrl).toContain('topicDetails')
    expect(videosUrl).toContain('contentDetails')
    expect(videosUrl).toContain('statistics')
  })

  it('charges the documented quota for one search and one video list', async () => {
    const meter = createMeter()

    await searchSeeds('rick astley', meter)

    expect(meter.calls).toBe(2)
    expect(meter.units).toBe(101)
    expect(meter.operations.map((operation) => operation.operation)).toEqual([
      'search.list',
      'videos.list',
    ])
  })

  it('never leaves the process', async () => {
    const meter = createMeter()

    await searchSeeds('rick astley', meter)

    for (const url of requestedUrls) {
      expect(url.startsWith('https://www.googleapis.com/youtube/v3/')).toBe(true)
    }
  })

  /**
   * The Data API exposes plain resource paths — `youtube/v3/search` — while
   * the operation names are the dotted method names from the discovery
   * document (`search.list`). Sending the dotted name verbatim reaches a 404
   * from Google with an HTML body, so every upstream call would fail with
   * "the API rejected the request" no matter how correct the API key was.
   *
   * This is the tripwire for that: no requested path may carry a dotted
   * method suffix.
   */
  it('calls the plain resource paths, not the dotted method names', async () => {
    const meter = createMeter()

    await searchSeeds('rick astley', meter)

    expect(requestedUrls.length).toBeGreaterThan(0)
    for (const url of requestedUrls) {
      const path = pathOf(url)
      expect(path.split('/').pop()).not.toMatch(/\./)
    }
  })
})

/* ── the enrichment the plan asks for ───────────────────────────────────── */

/**
 * PLAN-ADDENDUM §34 corrections 1, 2 and 13 ask the hydrator to carry the
 * region restriction, the live-broadcast flag, the channel id and the full
 * category list on the track. The assertions below state that contract.
 *
 * They were written as `test.fails` while the hydrator in
 * `lib/youtube/search.ts` did not map those fields. The mapping landed, so
 * they are ordinary assertions now — and they are the tripwire that catches
 * the day somebody drops a field again.
 */
describe('the v2 enrichment of a hydrated track', () => {
  test('carries the region restriction of the video onto the track', () => {
    const track = trackFromVideo(VIDEO_ITEM)

    expect(track?.regionRestriction).toEqual({ blocked: ['DE', 'FR'] })
  })

  test('carries the live-broadcast flag onto the track', () => {
    const track = trackFromVideo(VIDEO_ITEM)

    expect(track?.liveBroadcastContent).toBe('none')
  })

  test('carries the channel id onto the track', () => {
    const track = trackFromVideo(VIDEO_ITEM)

    expect(track?.channelId).toBe('UCuAXFkgsw1L7xaCfnd5JJOw')
  })

  test('carries every topic category onto the track', () => {
    const track = trackFromVideo(VIDEO_ITEM)

    expect(track?.topicCategories).toEqual(['New wave music'])
  })
})
