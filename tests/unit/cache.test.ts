import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  cacheStats,
  cachedFetch,
  deleteCached,
  getCached,
  resetCache,
  setCached,
  withCache,
} from '@/lib/cache'
import { createMeter } from '@/lib/youtube/client'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('withCache', () => {
  beforeEach(() => {
    resetCache()
  })

  it('runs the loader once and serves the second call from the cache', async () => {
    let loads = 0
    const loader = async (): Promise<string> => {
      loads += 1
      return 'value'
    }

    const first = await withCache('key:once', 60, loader)
    const second = await withCache('key:once', 60, loader)

    expect(loads).toBe(1)
    expect(first.hit).toBe(false)
    expect(second.hit).toBe(true)
    expect(second.value).toBe('value')
  })

  it('runs the loader once for a burst of concurrent misses', async () => {
    let loads = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const loader = async (): Promise<string> => {
      loads += 1
      await gate
      return 'shared'
    }

    const pending = [
      withCache('key:stampede', 60, loader),
      withCache('key:stampede', 60, loader),
      withCache('key:stampede', 60, loader),
    ]
    release()
    const results = await Promise.all(pending)

    expect(loads).toBe(1)
    for (const result of results) {
      expect(result.value).toBe('shared')
    }
  })

  it('serves an expired answer straight away and refreshes it in the background', async () => {
    let loads = 0
    const loader = async (): Promise<string> => {
      loads += 1
      return `value-${loads}`
    }

    const first = await withCache('key:stale', 0, loader)
    const second = await withCache('key:stale', 0, loader)

    expect(first.stale).toBe(false)
    expect(second.hit).toBe(true)
    expect(second.stale).toBe(true)
    expect(second.value).toBe('value-1')
  })

  it('does not cache a null answer', async () => {
    await setCached('key:null', null)

    expect(await getCached('key:null')).toBeNull()
  })
})

describe('getCached / setCached', () => {
  beforeEach(() => {
    resetCache()
  })

  it('reads back what it wrote', async () => {
    await setCached('key:read', { hello: 'world' }, 60)

    expect(await getCached('key:read')).toEqual({ hello: 'world' })
  })

  it('returns null for a key it never wrote', async () => {
    expect(await getCached('key:absent')).toBeNull()
  })

  it('forgets a key it deleted', async () => {
    await setCached('key:delete', 'value', 60)
    await deleteCached('key:delete')

    expect(await getCached('key:delete')).toBeNull()
  })
})

describe('the in-process store', () => {
  beforeEach(() => {
    resetCache()
  })

  it('evicts the oldest entries once it is full', async () => {
    for (let index = 0; index < 520; index += 1) {
      await setCached(`evict:${index}`, index, 60)
    }

    const stats = cacheStats()

    expect(stats.entries).toBeLessThanOrEqual(500)
    expect(stats.evictions).toBeGreaterThan(0)
  })

  it('keeps the entry that was written last', async () => {
    await setCached('evict:newest', 'kept', 60)

    expect(await getCached('evict:newest')).toBe('kept')
  })
})

describe('cachedFetch', () => {
  beforeEach(() => {
    resetCache()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('charges the meter for the first call and nothing for the cached one', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ items: [{ id: 'vid00000001' }] }))
    vi.stubGlobal('fetch', fetchMock)

    const meter = createMeter()
    await cachedFetch('videos.list', { id: 'vid00000001', part: 'snippet' }, meter)
    const unitsAfterFirst = meter.units
    await cachedFetch('videos.list', { id: 'vid00000001', part: 'snippet' }, meter)

    expect(unitsAfterFirst).toBe(1)
    expect(meter.units).toBe(unitsAfterFirst)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('serves the cached answer to the second caller', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ items: [{ id: 'vid00000001' }] }))
    vi.stubGlobal('fetch', fetchMock)

    const meter = createMeter()
    const first = await cachedFetch('videos.list', { id: 'vid00000002', part: 'snippet' }, meter)
    const second = await cachedFetch('videos.list', { id: 'vid00000002', part: 'snippet' }, meter)

    expect(second).toEqual(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('never calls the network for a cached answer', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ items: [] }))
    vi.stubGlobal('fetch', fetchMock)

    const meter = createMeter()
    await cachedFetch('search.list', { q: 'test query', type: 'video' }, meter)
    await cachedFetch('search.list', { q: 'test query', type: 'video' }, meter)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(meter.units).toBe(100)
  })
})
