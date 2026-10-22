import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetCache } from '@/lib/cache'
import { mapError } from '@/lib/http/handler'
import { createMeter, YouTubeError, youtubeFetch } from '@/lib/youtube/client'
import { searchSeeds } from '@/lib/youtube/search'

/**
 * What happens when the project's daily quota is gone.
 *
 * This is the failure that broke the app in production: the search bucket
 * ran out, the API answered 429 with the reason `rateLimitExceeded`, and
 * every check in the codebase asked for `quotaExceeded` — so none of them
 * matched. The error fell through to `upstream_error` / 502 and carried a
 * raw Google sentence to the browser.
 *
 * The upstream wording is not what the app must key on. These tests pin the
 * behaviour to the reason the API actually sends.
 */

function errorResponse(status: number, reason: string, message: string): Response {
  return new Response(
    JSON.stringify({ error: { code: status, message, errors: [{ reason, domain: 'global' }] } }),
    { status, headers: { 'Content-Type': 'application/json' } },
  )
}

/** The 429 the search bucket sends when the day's budget is spent. */
const DAILY_QUOTA_BODY = {
  status: 429,
  reason: 'rateLimitExceeded',
  message:
    "Quota exceeded for quota metric 'Search Queries' and limit 'Search Queries per day' of service 'youtube.googleapis.com' for consumer 'project_number:247187332561'.",
}

beforeEach(() => {
  process.env.YOUTUBE_API_KEY = 'test-key-for-the-quota-contract-suite'
  resetCache()
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.YOUTUBE_API_KEY
  resetCache()
})

describe('the quota error the API actually sends', () => {
  it('reports a spent search bucket as a quota problem, not as a server fault', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => errorResponse(DAILY_QUOTA_BODY.status, DAILY_QUOTA_BODY.reason, DAILY_QUOTA_BODY.message)),
    )

    const error = await youtubeFetch('search.list', { q: 'jazz' }, createMeter()).catch((caught) => caught)

    expect(error).toBeInstanceOf(YouTubeError)
    // The reason the API sends is `rateLimitExceeded`, not `quotaExceeded`.
    expect((error as YouTubeError).upstreamReason).toBe('rateLimitExceeded')

    const mapped = mapError(error)
    expect(mapped.code).toBe('quota_exceeded')
    expect(mapped.status).toBe(429)
    // The user must not read Google's raw sentence.
    expect(mapped.message).not.toContain('project_number')
    expect(mapped.message).toContain('midnight Pacific Time')
  })

  it('tells a per-minute throttle apart from a spent daily budget', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        errorResponse(429, 'rateLimitExceeded', 'Quota exceeded for quota metric per minute.'),
      ),
    )

    const error = await youtubeFetch('search.list', { q: 'jazz' }, createMeter()).catch((caught) => caught)

    const mapped = mapError(error)
    expect(mapped.code).toBe('rate_limited')
    expect(mapped.status).toBe(429)
  })

  it('still recognises the reasons the quota calculator documents', async () => {
    for (const reason of ['quotaExceeded', 'dailyLimitExceeded']) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => errorResponse(403, reason, 'The daily limit has been reached.')),
      )

      const error = await youtubeFetch('search.list', { q: 'jazz' }, createMeter()).catch((caught) => caught)

      const mapped = mapError(error)
      expect(mapped.code).toBe('quota_exceeded')
      expect(mapped.status).toBe(429)
    }
  })

  it('surfaces the quota failure of a route as a 429 the UI can explain', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => errorResponse(DAILY_QUOTA_BODY.status, DAILY_QUOTA_BODY.reason, DAILY_QUOTA_BODY.message)),
    )

    await expect(searchSeeds('jazz', createMeter())).rejects.toThrow(/midnight Pacific Time/)
  })
})

describe('the search the quota is spent on', () => {
  it('is paid for once and served from the cache afterwards', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.includes('/youtube/v3/search')) {
        return new Response(
          JSON.stringify({
            items: [{ id: { kind: 'youtube#video', videoId: 'vid1' }, snippet: { title: 'Jazz' } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response(
        JSON.stringify({
          items: [
            {
              id: 'vid1',
              snippet: {
                publishedAt: '2020-01-01T00:00:00Z',
                channelId: 'UCtest',
                title: 'Jazz Standard',
                channelTitle: 'Artist - Topic',
                categoryId: '10',
                liveBroadcastContent: 'none',
              },
              contentDetails: { duration: 'PT3M30S' },
              statistics: { viewCount: '100' },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const first = createMeter()
    const tracks = await searchSeeds('jazz', first)
    expect(tracks).toHaveLength(1)
    expect(first.units).toBe(101)

    const second = createMeter()
    await searchSeeds('jazz', second)

    // The second identical search must not go out again: a search costs 100
    // units, and the day's budget is a hundred of them.
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(second.units).toBe(0)
  })
})
