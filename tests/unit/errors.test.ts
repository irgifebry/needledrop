import { describe, expect, it } from 'vitest'

import { AppError, ERROR_CODES, isAppError, statusForCode } from '@/lib/http/errors'

describe('ERROR_CODES', () => {
  it('holds every code the API surface promises', () => {
    for (const code of [
      'invalid_request',
      'unauthorized',
      'auth_required',
      'auth_expired',
      'forbidden',
      'not_found',
      'rate_limited',
      'quota_exceeded',
      'upstream_error',
      'upstream_unavailable',
      'network',
      'no_results',
      'private_video',
      'deleted_video',
      'region_blocked',
      'conflict',
      'playlist_failed',
      'unsupported_media',
      'demo_mode',
      'internal_error',
    ]) {
      expect(ERROR_CODES).toContain(code)
    }
  })

  it('never repeats a code', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length)
  })
})

describe('AppError', () => {
  it('carries the code, the message and the status', () => {
    const error = new AppError('not_found', 'No such playlist.', 404)

    expect(error.code).toBe('not_found')
    expect(error.message).toBe('No such playlist.')
    expect(error.status).toBe(404)
    expect(error.name).toBe('AppError')
  })

  it('is recognised by the type guard', () => {
    expect(isAppError(new AppError('conflict', 'Already there.'))).toBe(true)
    expect(isAppError(new Error('plain'))).toBe(false)
    expect(isAppError('not an error')).toBe(false)
    expect(isAppError(null)).toBe(false)
  })
})

describe('statusForCode', () => {
  it('maps a bad request to 400', () => {
    expect(statusForCode('invalid_request')).toBe(400)
  })

  it('maps an authentication failure to 401', () => {
    expect(statusForCode('unauthorized')).toBe(401)
    expect(statusForCode('auth_required')).toBe(401)
    expect(statusForCode('auth_expired')).toBe(401)
  })

  it('maps a missing resource to 404', () => {
    expect(statusForCode('not_found')).toBe(404)
  })

  it('maps a quota or rate limit failure to 429', () => {
    expect(statusForCode('rate_limited')).toBe(429)
    expect(statusForCode('quota_exceeded')).toBe(429)
  })

  it('maps a network failure to 503', () => {
    expect(statusForCode('network')).toBe(503)
    expect(statusForCode('upstream_unavailable')).toBe(503)
  })

  it('maps an upstream failure to 502', () => {
    expect(statusForCode('upstream_error')).toBe(502)
    expect(statusForCode('internal_error')).toBe(502)
  })
})
