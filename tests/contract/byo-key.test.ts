import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetCache } from '@/lib/cache'
import { discover } from '@/lib/youtube/discover'
import { normalizeDiscoveryOptions } from '@/lib/youtube/options'
import { createMeter } from '@/lib/youtube/client'
import { searchSeeds } from '@/lib/youtube/search'
import type { Track } from '@/lib/youtube/types'

/**
 * The visitor's own API key must be used by *every* call.
 *
 * The pipeline has seven upstream call sites — the trending chart, the
 * artist radio, the curated playlists, the searches, the hydration — and
 * each one passes its own credentials. A call site that forgets the
 * visitor's key is invisible until the shared project's quota is gone and
 * the visitor is told to wait until midnight, for a search their own
 * project already paid for.
 *
 * So this suite asserts on the URL of every request that goes out.
 */

const SHARED_KEY = 'AIzaSharedProjectKey00000000000000000000'
const OWN_KEY = 'AIzaVisitorOwnKey0000000000000000000000'

const SEED: Track = {
  videoId: 'dQw4w9WgXcQ',
  title: 'Never Gonna Give You Up',
  artist: 'Rick Astley',
  channelTitle: 'RickAstleyVEVO',
  durationSec: 213,
  thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
  topicId: '',
  topicName: '',
  viewCount: 1,
  publishedAt: '2020-01-01T00:00:00Z',
  categoryId: '10',
}

let requested: string[] = []

/** A response that satisfies any of the calls the pipeline makes. */
function emptyResponse(): Response {
  return new Response(JSON.stringify({ items: [] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  requested = []
  process.env.YOUTUBE_API_KEY = SHARED_KEY
  resetCache()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      requested.push(String(input))
      return emptyResponse()
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.YOUTUBE_API_KEY
  resetCache()
})

/** The key every request went out with. */
function keysUsed(): string[] {
  return requested.map((url) => new URL(url).searchParams.get('key') ?? '')
}

describe('a visitor with their own key', () => {
  it('pays for the seed search with that key', async () => {
    await searchSeeds('jazz', createMeter(), { apiKeyOverride: OWN_KEY })

    expect(keysUsed().length).toBeGreaterThan(0)
    for (const key of keysUsed()) {
      expect(key).toBe(OWN_KEY)
    }
    expect(keysUsed()).not.toContain(SHARED_KEY)
  })

  it('pays for every call in a discovery run with that key', async () => {
    const options = normalizeDiscoveryOptions({ count: 10, depth: 1 })

    await discover(SEED, options, createMeter(), { apiKeyOverride: OWN_KEY })

    // The trending chart, the artist radio, the searches and the hydration
    // all go out — and all of them must carry the visitor's key.
    expect(requested.length).toBeGreaterThan(1)
    for (const key of keysUsed()) {
      expect(key).toBe(OWN_KEY)
    }
  })

  it('is what makes the discovery searches use it', async () => {
    const options = normalizeDiscoveryOptions({ count: 10, depth: 2 })

    await discover(SEED, options, createMeter(), { apiKeyOverride: OWN_KEY })

    // The searches are the expensive ones — 100 units each — so they are
    // the ones a missing credential would silently misroute.
    const searches = requested.filter((url) => url.includes('/youtube/v3/search'))
    expect(searches.length).toBeGreaterThan(0)
    for (const url of searches) {
      expect(new URL(url).searchParams.get('key')).toBe(OWN_KEY)
    }
  })

  it('leaves the shared key in charge when there is no visitor key', async () => {
    const options = normalizeDiscoveryOptions({ count: 10, depth: 1 })

    await discover(SEED, options, createMeter())

    for (const key of keysUsed()) {
      expect(key).toBe(SHARED_KEY)
    }
  })
})
