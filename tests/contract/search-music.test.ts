import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createMeter } from '@/lib/youtube/client'
import { searchSeeds } from '@/lib/youtube/search'

/**
 * The search must answer the question that was asked.
 *
 * Two things were wrong. The Music category holds hour-long radio streams
 * and DJ mixes next to the recordings, and nothing told them apart — a
 * search for "jazz" came back with one real track out of twenty-five, the
 * rest being 60-minute radio shows. And the hits were returned in YouTube's
 * own order, with no regard for whether they belonged to the artist or the
 * genre that was typed.
 *
 * No request leaves the process: `global.fetch` is stubbed.
 */

/* ── harness ────────────────────────────────────────────────────────────── */

type Requested = { url: string; method: string; body: unknown }

let requested: Requested[] = []

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** A search hit, as `search.list` returns it. */
function hit(videoId: string): unknown {
  return { id: { kind: 'youtube#video', videoId } }
}

/** A video, as `videos.list` returns it. */
function video(
  videoId: string,
  options: {
    title?: string
    channelTitle?: string
    duration?: string
    live?: string
    categories?: string[]
  } = {},
): unknown {
  return {
    kind: 'youtube#video',
    id: videoId,
    snippet: {
      title: options.title ?? 'A Song',
      channelTitle: options.channelTitle ?? 'Some Channel',
      channelId: 'UC_channel',
      categoryId: '10',
      liveBroadcastContent: options.live ?? 'none',
    },
    contentDetails: { duration: options.duration ?? 'PT3M30S' },
    topicDetails: {
      topicCategories:
        options.categories?.map((name) => `https://en.wikipedia.org/wiki/Category:${name}`) ?? [],
    },
    statistics: { viewCount: '1000000' },
  }
}

function installFetch(handler: (url: URL, init: RequestInit) => Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init: RequestInit = {}) => {
      const url = new URL(String(input))
      requested.push({
        url: String(input),
        method: init.method ?? 'GET',
        body: typeof init.body === 'string' && init.body ? JSON.parse(init.body) : undefined,
      })
      return handler(url, init)
    }),
  )
}

function searchUrl(): URL {
  const found = requested.find((entry) => entry.url.includes('/youtube/v3/search'))
  if (!found) throw new Error('the search was never called')
  return new URL(found.url)
}

beforeEach(() => {
  requested = []
  // The search path checks for a key before it touches the network, and
  // falls back to the offline catalogue when there is none.
  process.env.YOUTUBE_API_KEY = 'test-key-for-the-search-contract-suite'
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.YOUTUBE_API_KEY
})

/* ── the server-side filter ─────────────────────────────────────────────── */

describe('the search asks the upstream for music, not for uploads', () => {
  it('asks for the music category', async () => {
    installFetch((url) =>
      url.pathname.endsWith('/search') ? jsonResponse({ items: [hit('vid1')] }) : jsonResponse({ items: [video('vid1')] }),
    )

    await searchSeeds('jazz', createMeter())

    expect(searchUrl().searchParams.get('videoCategoryId')).toBe('10')
    expect(searchUrl().searchParams.get('type')).toBe('video')
  })

  it('asks the server to leave out the long ones', async () => {
    installFetch((url) =>
      url.pathname.endsWith('/search') ? jsonResponse({ items: [hit('vid1')] }) : jsonResponse({ items: [video('vid1')] }),
    )

    await searchSeeds('jazz', createMeter())

    // A search is charged per request, not per result, so the server-side
    // length filter is free.
    expect(searchUrl().searchParams.get('videoDuration')).toBe('medium')
  })

  it('asks for enough results to survive the filter', async () => {
    installFetch((url) =>
      url.pathname.endsWith('/search') ? jsonResponse({ items: [hit('vid1')] }) : jsonResponse({ items: [video('vid1')] }),
    )

    await searchSeeds('jazz', createMeter())

    expect(Number(searchUrl().searchParams.get('maxResults'))).toBeGreaterThan(8)
  })
})

/* ── the client-side filter ─────────────────────────────────────────────── */

describe('the search keeps the recordings and drops everything else', () => {
  it('drops a mix, a live broadcast and a stream', async () => {
    installFetch((url) => {
      if (url.pathname.endsWith('/search')) {
        return jsonResponse({
          items: [hit('real'), hit('mix'), hit('live'), hit('stream')],
        })
      }
      return jsonResponse({
        items: [
          video('real', { duration: 'PT3M30S' }),
          video('mix', { duration: 'PT2H14M15S' }),
          video('live', { live: 'live', duration: 'PT0S' }),
          video('stream', { duration: 'PT0S' }),
        ],
      })
    })

    const tracks = await searchSeeds('jazz', createMeter())

    expect(tracks.map((track) => track.videoId)).toEqual(['real'])
  })

  it('keeps a recording at the edge of the window', async () => {
    installFetch((url) => {
      if (url.pathname.endsWith('/search')) return jsonResponse({ items: [hit('edge')] })
      return jsonResponse({ items: [video('edge', { duration: 'PT12M0S' })] })
    })

    const tracks = await searchSeeds('jazz', createMeter())

    expect(tracks).toHaveLength(1)
  })
})

/* ── the ranking ────────────────────────────────────────────────────────── */

describe('the search answers what was asked', () => {
  it('puts the artist the query named first', async () => {
    installFetch((url) => {
      if (url.pathname.endsWith('/search')) {
        return jsonResponse({ items: [hit('other'), hit('theartist')] })
      }
      return jsonResponse({
        items: [
          video('other', {
            title: 'Something Else',
            channelTitle: 'A Different Channel',
            duration: 'PT3M30S',
            categories: ['Pop_music'],
          }),
          video('theartist', {
            title: 'The Song',
            channelTitle: 'The Artist - Topic',
            duration: 'PT3M30S',
            categories: ['Pop_music'],
          }),
        ],
      })
    })

    const tracks = await searchSeeds('the artist', createMeter())

    expect(tracks[0].videoId).toBe('theartist')
  })

  it('puts the genre the query named above the ones that match nothing', async () => {
    installFetch((url) => {
      if (url.pathname.endsWith('/search')) {
        return jsonResponse({ items: [hit('nogenre'), hit('jazztrack')] })
      }
      return jsonResponse({
        items: [
          video('nogenre', {
            title: 'Something Else',
            channelTitle: 'A Different Channel',
            duration: 'PT3M30S',
            categories: ['Heavy_metal'],
          }),
          video('jazztrack', {
            title: 'Blue Train',
            channelTitle: 'A Different Channel',
            duration: 'PT3M30S',
            categories: ['Jazz'],
          }),
        ],
      })
    })

    const tracks = await searchSeeds('jazz', createMeter())

    expect(tracks[0].videoId).toBe('jazztrack')
  })

  it('still returns something when nothing matches the genre at all', async () => {
    // "lofi" is filed under "Electronic music", so a strict genre filter
    // would come back empty.
    installFetch((url) => {
      if (url.pathname.endsWith('/search')) return jsonResponse({ items: [hit('lofi')] })
      return jsonResponse({
        items: [
          video('lofi', {
            title: 'A Lo-fi Beat',
            channelTitle: 'A Radio Channel',
            duration: 'PT3M30S',
            categories: ['Electronic_music'],
          }),
        ],
      })
    })

    const tracks = await searchSeeds('lofi', createMeter())

    expect(tracks).toHaveLength(1)
  })
})
