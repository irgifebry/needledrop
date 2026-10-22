import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { checkLocalRateLimit, checkRateLimit, clientKey } from '@/lib/http/rate-limit'

describe('checkLocalRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows exactly the number of requests the limit names', () => {
    const key = 'rate:allows'

    expect(checkLocalRateLimit(key, 2, 60_000).ok).toBe(true)
    expect(checkLocalRateLimit(key, 2, 60_000).ok).toBe(true)
  })

  it('refuses the request after the limit', () => {
    const key = 'rate:refuses'

    checkLocalRateLimit(key, 2, 60_000)
    checkLocalRateLimit(key, 2, 60_000)

    expect(checkLocalRateLimit(key, 2, 60_000).ok).toBe(false)
  })

  it('counts the remaining allowance down', () => {
    const key = 'rate:remaining'

    expect(checkLocalRateLimit(key, 3, 60_000).remaining).toBe(2)
    expect(checkLocalRateLimit(key, 3, 60_000).remaining).toBe(1)
    expect(checkLocalRateLimit(key, 3, 60_000).remaining).toBe(0)
  })

  it('starts a fresh window once the old one has passed', () => {
    const key = 'rate:window'
    const first = checkLocalRateLimit(key, 1, 60_000)
    expect(checkLocalRateLimit(key, 1, 60_000).ok).toBe(false)

    vi.advanceTimersByTime(60_001)

    const afterWindow = checkLocalRateLimit(key, 1, 60_000)
    expect(afterWindow.ok).toBe(true)
    expect(afterWindow.resetAt).toBeGreaterThan(first.resetAt)
  })

  it('keeps two keys apart', () => {
    expect(checkLocalRateLimit('rate:one', 1, 60_000).ok).toBe(true)
    expect(checkLocalRateLimit('rate:one', 1, 60_000).ok).toBe(false)
    expect(checkLocalRateLimit('rate:two', 1, 60_000).ok).toBe(true)
  })
})

describe('checkRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('disables the check when the limit is zero', async () => {
    const result = await checkRateLimit('rate:disabled', 0, 60_000)

    expect(result.ok).toBe(true)
    expect(result.scope).toBe('disabled')
  })

  it('never refuses a request while the limit is zero', async () => {
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const result = await checkRateLimit('rate:disabled-many', 0, 60_000)
      expect(result.ok).toBe(true)
    }
  })

  it('refuses once the limit is reached', async () => {
    expect((await checkRateLimit('rate:async', 1, 60_000)).ok).toBe(true)
    expect((await checkRateLimit('rate:async', 1, 60_000)).ok).toBe(false)
  })
})

describe('clientKey', () => {
  it('scopes the client address by the route scope', () => {
    const request = new Request('https://needledrop.app/api/search', {
      headers: { 'x-forwarded-for': '203.0.113.7, 70.41.3.18' },
    })

    expect(clientKey(request, 'search')).toBe('search:203.0.113.7')
  })

  it('falls back to the real-ip header', () => {
    const request = new Request('https://needledrop.app/api/search', {
      headers: { 'x-real-ip': '203.0.113.9' },
    })

    expect(clientKey(request, 'search')).toBe('search:203.0.113.9')
  })

  it('does not trust a forwarded address that is not a list', () => {
    const request = new Request('https://needledrop.app/api/search')

    expect(clientKey(request, 'search')).toBe('search:unknown')
  })
})
