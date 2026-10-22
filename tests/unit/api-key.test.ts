import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetCache } from '@/lib/cache'
import { createMeter } from '@/lib/youtube/client'
import { isWellFormedApiKey, verifyApiKey } from '@/lib/youtube/api-key'

/**
 * The visitor's own API key (PLAN §13.7).
 *
 * The shared project key pays for every search, and the project's daily
 * budget is a hundred searches. A key from the visitor's own Google Cloud
 * project moves their traffic onto their own quota — so the key has to be
 * checked properly, and a bad key has to be refused with a reason rather
 * than silently ignored.
 */

/** A well-formed but fictional key. */
const WELL_FORMED = 'AIzaSyA1234567890abcdefghijklmnopqrstuv'

beforeEach(() => {
  resetCache()
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetCache()
})

describe('the shape of a Google API key', () => {
  it('is "AIza" plus 35 URL-safe characters', () => {
    expect(isWellFormedApiKey(WELL_FORMED)).toBe(true)
    expect(isWellFormedApiKey(`  ${WELL_FORMED}  `)).toBe(true)
  })

  it('refuses anything else without calling the API', () => {
    for (const bad of ['', 'nope', 'AIza', 'AIzaShort', WELL_FORMED.slice(0, 38), `${WELL_FORMED}x`]) {
      expect(isWellFormedApiKey(bad)).toBe(false)
    }
  })
})

describe('verifying a key', () => {
  it('accepts a key the API answers for', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ items: [{ id: 'dQw4w9WgXcQ' }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    )

    const check = await verifyApiKey(WELL_FORMED, createMeter())

    expect(check.ok).toBe(true)
  })

  it('probes with a one-unit call rather than a search', async () => {
    const fetchMock = vi.fn(
      async (_input: unknown) =>
        new Response(JSON.stringify({ items: [{ id: 'dQw4w9WgXcQ' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const meter = createMeter()
    await verifyApiKey(WELL_FORMED, meter)

    // A search costs 100 units and the day's budget is a hundred of them.
    // A key check must never spend one.
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/youtube/v3/videos')
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('/youtube/v3/search')
    expect(meter.units).toBe(1)
  })

  it('refuses a malformed key without touching the network', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const check = await verifyApiKey('not-a-key', createMeter())

    expect(check.ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports a rejected key separately from a malformed one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: { code: 400, message: 'API key not valid.', errors: [{ reason: 'keyInvalid' }] },
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    )

    const check = await verifyApiKey(WELL_FORMED, createMeter())

    expect(check.ok).toBe(false)
    if (!check.ok) {
      expect(check.reason).toBe('rejected')
      expect(check.message).toContain('YouTube Data API v3')
    }
  })

  it('tells the visitor when the key itself has no quota left', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                code: 429,
                message:
                  "Quota exceeded for quota metric 'Search Queries' and limit 'Search Queries per day' of service 'youtube.googleapis.com'.",
                errors: [{ reason: 'rateLimitExceeded' }],
              },
            }),
            { status: 429, headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    )

    const check = await verifyApiKey(WELL_FORMED, createMeter())

    expect(check.ok).toBe(false)
    if (!check.ok) {
      expect(check.reason).toBe('quota')
      expect(check.message).toContain('its own daily quota')
    }
  })
})
