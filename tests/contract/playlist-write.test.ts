import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createMeter, YouTubeError } from '@/lib/youtube/client'
import { createPlaylist } from '@/lib/youtube/playlists'
import { updatePlaylist } from '@/lib/youtube/playlist-lifecycle'

/**
 * Contract tests for the playlist *write* path (PLAN §13.4).
 *
 * The route handler and the job worker both reach the account through
 * `createPlaylist`, so this is the one function every write goes through. It
 * is also the one function that had no test at all: the OAuth grant it needs
 * is a sensitive scope, so the flow could not be exercised against the real
 * API, and the unit suites never touched the write branch either.
 *
 * That left the feature that the whole product is about — writing a playlist
 * into the user's own account — unverified in every sense. These tests
 * assert the shape of every upstream call, so the path is known-good before
 * a token ever reaches it.
 *
 * No request leaves the process: `global.fetch` is stubbed.
 */

/* ── fixtures ───────────────────────────────────────────────────────────── */

const TRACKS = ['vid00000001', 'vid00000002', 'vid00000003']

const INPUT = {
  videoIds: TRACKS,
  title: 'Late Night Drive',
  description: 'for the long way home',
  privacy: 'private' as const,
}

const ACCESS_TOKEN = 'ya29.test-access-token'

/* ── harness ────────────────────────────────────────────────────────────── */

type Recorded = {
  url: string
  path: string
  method: string
  body: unknown
  headers: Record<string, string>
}

let recorded: Recorded[] = []

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * The default upstream: a playlist id for the insert, an item id for every
 * track, and the positions the playlist ends up with.
 */
function defaultUpstream(url: URL): Response {
  if (url.pathname.endsWith('/playlists')) {
    return jsonResponse({ id: 'PL_TEST_0001', snippet: { title: INPUT.title } })
  }
  if (url.pathname.endsWith('/playlistItems')) {
    if (url.searchParams.get('playlistId')) {
      return jsonResponse({
        items: TRACKS.map((_, index) => ({ id: `ITEM_${index}`, snippet: { position: index } })),
      })
    }
    return jsonResponse({ id: 'ITEM_0', snippet: { position: 0 } })
  }
  return jsonResponse({ error: { message: 'unexpected operation', errors: [{ reason: 'unknown' }] } })
}

function installFetch(handler: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init: RequestInit = {}) => {
      const url = new URL(String(input))
      const body =
        typeof init.body === 'string' && init.body.length > 0
          ? (JSON.parse(init.body) as unknown)
          : undefined
      recorded.push({
        url: String(input),
        path: url.pathname,
        method: init.method ?? 'GET',
        body,
        headers: (init.headers ?? {}) as Record<string, string>,
      })
      return handler(url, init)
    }),
  )
}

/** The paths, in the order they were called. */
function paths(): string[] {
  return recorded.map((entry) => entry.path)
}

/**
 * Whether the request carries the caller's own token.
 *
 * The transport is not the point — a user-scoped write must never fall back
 * to the shared project key — so the check accepts either the query
 * parameter or an Authorization header.
 */
function carriesCallerToken(entry: Recorded): boolean {
  const authorization = entry.headers['Authorization'] ?? entry.headers['authorization']
  if (authorization) return authorization.includes(ACCESS_TOKEN)
  return entry.url.includes(ACCESS_TOKEN)
}

beforeEach(() => {
  recorded = []
  installFetch((url) => defaultUpstream(url))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/* ── the write path ─────────────────────────────────────────────────────── */

describe('createPlaylist', () => {
  it('creates the playlist before it adds any track', async () => {
    await createPlaylist(ACCESS_TOKEN, INPUT, createMeter())

    expect(paths()[0]).toBe('/youtube/v3/playlists')
    expect(recorded[0].method).toBe('POST')
    expect(paths().filter((path) => path === '/youtube/v3/playlists')).toHaveLength(1)
  })

  it('sends the title, description and visibility the caller asked for', async () => {
    await createPlaylist(ACCESS_TOKEN, INPUT, createMeter())

    const body = recorded[0].body as {
      snippet: { title: string; description: string; tags: string[] }
      status: { privacyStatus: string }
    }

    expect(body.snippet.title).toBe('Late Night Drive')
    expect(body.snippet.description).toBe('for the long way home')
    expect(body.status.privacyStatus).toBe('private')
  })

  it('tags the playlist so a later run can recognise its own work', async () => {
    await createPlaylist(ACCESS_TOKEN, INPUT, createMeter())

    const body = recorded[0].body as { snippet: { tags: string[] } }

    expect(body.snippet.tags).toContain('needledrop')
    expect(body.snippet.tags).toContain('generated-playlist')
  })

  it('adds every track, in the order it was picked', async () => {
    await createPlaylist(ACCESS_TOKEN, INPUT, createMeter())

    // The verifying read is a GET on the same path, so the inserts are
    // selected by method as well.
    const inserts = recorded.filter(
      (entry) => entry.path === '/youtube/v3/playlistItems' && entry.method === 'POST',
    )
    expect(inserts).toHaveLength(TRACKS.length)

    inserts.forEach((entry, index) => {
      const body = entry.body as {
        snippet: {
          playlistId: string
          resourceId: { videoId: string; kind: string }
          position: number
        }
      }
      expect(body.snippet.playlistId).toBe('PL_TEST_0001')
      expect(body.snippet.resourceId.videoId).toBe(TRACKS[index])
      expect(body.snippet.resourceId.kind).toBe('youtube#video')
      expect(body.snippet.position).toBe(index)
    })
  })

  it('never falls back to the shared project key for a user-scoped write', async () => {
    process.env.YOUTUBE_API_KEY = 'shared-project-key-should-not-appear'

    try {
      await createPlaylist(ACCESS_TOKEN, INPUT, createMeter())

      for (const entry of recorded) {
        expect(entry.url).not.toContain('shared-project-key-should-not-appear')
        expect(entry.url).not.toContain('key=')
        expect(carriesCallerToken(entry)).toBe(true)
      }
    } finally {
      delete process.env.YOUTUBE_API_KEY
    }
  })

  it('reads the playlist back to check the order it ended up in', async () => {
    const result = await createPlaylist(ACCESS_TOKEN, INPUT, createMeter())

    const last = recorded[recorded.length - 1]
    expect(last.path).toBe('/youtube/v3/playlistItems')
    expect(last.method).toBe('GET')
    expect(last.url).toContain('playlistId=PL_TEST_0001')
    expect(result.ordered).toBe(true)
    expect(result.note).toBeUndefined()
  })

  it('reports the playlist it made, and where it lives', async () => {
    const result = await createPlaylist(ACCESS_TOKEN, INPUT, createMeter())

    expect(result.playlistId).toBe('PL_TEST_0001')
    expect(result.playlistUrl).toBe('https://music.youtube.com/playlist?list=PL_TEST_0001')
  })

  it('says so when the order could not be fully verified', async () => {
    installFetch((url) => {
      if (url.pathname.endsWith('/playlistItems') && url.searchParams.get('playlistId')) {
        return jsonResponse({
          items: [{ snippet: { position: 0 } }, { snippet: { position: 2 } }, { snippet: { position: 1 } }],
        })
      }
      return defaultUpstream(url)
    })

    const result = await createPlaylist(ACCESS_TOKEN, INPUT, createMeter())

    expect(result.ordered).toBe(false)
    expect(result.note).toContain('could not be fully verified')
  })

  it('charges the upstream what the Data API charges for', async () => {
    const meter = createMeter()

    await createPlaylist(ACCESS_TOKEN, INPUT, meter)

    // playlists.insert (50) + one playlistItems.insert per track (50 each)
    // + the playlistItems.list that verifies the order (1).
    expect(meter.units).toBe(50 + 50 * TRACKS.length + 1)
    expect(meter.calls).toBe(TRACKS.length + 2)
  })

  it('retries an insert that fails on the way, and still finishes', async () => {
    let failures = 0
    let inserts = 0
    installFetch((url) => {
      if (url.pathname.endsWith('/playlistItems') && !url.searchParams.get('playlistId')) {
        inserts += 1
        if (inserts === 1) {
          failures += 1
          throw new TypeError('fetch failed')
        }
      }
      return defaultUpstream(url)
    })

    const result = await createPlaylist(ACCESS_TOKEN, INPUT, createMeter())

    // One insert failed and was retried; the other two went through, so
    // four insert calls reached the upstream in total.
    expect(failures).toBe(1)
    expect(inserts).toBe(TRACKS.length + 1)
    expect(result.playlistId).toBe('PL_TEST_0001')
  })

  it('surfaces a refused write instead of pretending it worked', async () => {
    installFetch((url) => {
      if (url.pathname.endsWith('/playlists')) {
        return jsonResponse(
          { error: { message: 'Access Not Configured', errors: [{ reason: 'forbidden' }] } },
          403,
        )
      }
      return defaultUpstream(url)
    })

    // The retry backoff is real time, and a refused write is retried, so
    // the timers are advanced rather than waited out. The rejection is
    // captured by hand: attaching the handler after the fact would let
    // vitest see it as unhandled.
    vi.useFakeTimers()
    try {
      const settled = createPlaylist(ACCESS_TOKEN, INPUT, createMeter()).then(
        () => null,
        (error: unknown) => error,
      )
      await vi.runAllTimersAsync()
      const error = await settled
      expect(error).toBeInstanceOf(YouTubeError)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports progress through every step', async () => {
    const steps: string[] = []

    await createPlaylist(ACCESS_TOKEN, INPUT, createMeter(), (progress) => {
      steps.push(progress.step)
    })

    expect(steps[0]).toBe('creating')
    expect(steps).toContain('inserting')
    expect(steps).toContain('verifying')
    expect(steps[steps.length - 1]).toBe('done')
  })
})

describe('updatePlaylist', () => {
  it('preserves existing tags when only the title is changed', async () => {
    installFetch((url) => {
      if (url.pathname.endsWith('/playlists') && url.searchParams.get('id')) {
        return jsonResponse({
          items: [{
            id: 'PL_EXISTING',
            snippet: { title: 'Before', description: 'Existing description', tags: ['keep-me', 'also-keep'] },
            contentDetails: { itemCount: 2 },
            status: { privacyStatus: 'private' },
          }],
        })
      }
      if (url.pathname.endsWith('/playlists')) {
        return jsonResponse({ id: 'PL_EXISTING', snippet: { title: 'After' }, status: { privacyStatus: 'private' } })
      }
      return defaultUpstream(url)
    })

    await updatePlaylist(ACCESS_TOKEN, 'PL_EXISTING', { title: 'After' }, createMeter())

    const update = recorded.find((entry) => entry.path === '/youtube/v3/playlists' && entry.method === 'PUT')
    expect((update?.body as { snippet?: { tags?: string[] } }).snippet?.tags).toEqual(['keep-me', 'also-keep'])
  })
})
