import { NextResponse } from 'next/server'
import { ZodError } from 'zod'

import { env } from '@/lib/env'
import { increment, observeDuration } from '@/lib/observability/metrics'
import { logger, newRequestId } from '@/lib/observability/logger'
import { withSpan } from '@/lib/observability/tracing'
import { readUserApiKey } from '@/lib/session'
import { createMeter, isQuotaError, YouTubeError, type QuotaMeter } from '@/lib/youtube/client'
import { SpotifyError } from '@/lib/spotify/client'

import { AppError, type ErrorCode } from './errors'
import { checkRateLimit, clientKey } from './rate-limit'
import { regionCookie, userRegion } from './region'
import { fail } from './respond'

export type ApiContext = {
  request: Request
  url: URL
  requestId: string
  meter: QuotaMeter
  /** The visitor's two-letter country code, when the platform tells us. */
  region: string | null
  /**
   * The visitor's own YouTube API key, when they supplied one.
   *
   * `null` means "use the shared project key". A key here moves the
   * request onto the visitor's own quota, which is the escape hatch the
   * shared budget needs at any scale.
   */
  apiKey: string | null
}

export type RouteOptions = {
  /** Rate-limit bucket name. Also used in log lines. */
  scope: string
  /** Requests allowed per window. `0` disables the limit. */
  limit?: number
  windowMs?: number
}

/**
 * Wraps a route handler with the cross-cutting concerns every API route
 * needs: a request id, quota metering, rate limiting, structured logging and
 * a single place where upstream errors become stable error codes.
 */
export function withRoute(
  handler: (ctx: ApiContext) => Promise<NextResponse>,
  options: RouteOptions,
): (request: Request) => Promise<NextResponse> {
  return async function route(request: Request): Promise<NextResponse> {
    const requestId = newRequestId()
    const startedAt = Date.now()
    const meter = createMeter()
    const url = new URL(request.url)
    const region = userRegion(request)
    // The visitor's own key, if they set one. Read once per request and
    // passed down, so no route has to reach into the cookie store itself.
    const apiKey = await readUserApiKey()

    const limit = options.limit ?? env().RATE_LIMIT_PER_MINUTE
    const windowMs = options.windowMs ?? 60_000

    const gate = await checkRateLimit(clientKey(request, options.scope), limit, windowMs)
    if (!gate.ok) {
      logger.warn('rate limit hit', { requestId, scope: options.scope })
      return fail('rate_limited', 'Too many requests. Give it a minute and try again.', 429, {
        requestId,
        retryAfterMs: Math.max(0, gate.resetAt - Date.now()),
      })
    }

    try {
      const response = await withSpan('http.request', { scope: options.scope, method: request.method }, async (span) => {
        const result = await handler({ request, url, requestId, meter, region, apiKey })
        span.setAttribute('status', result.status)
        span.setAttribute('units', meter.units)
        return result
      })
      increment('apiRequest')
      observeDuration(`route:${options.scope}`, Date.now() - startedAt)
      logger.info('request', {
        requestId,
        scope: options.scope,
        method: request.method,
        path: url.pathname,
        status: response.status,
        units: meter.units,
        calls: meter.calls,
        durationMs: Date.now() - startedAt,
      })
      // Remember the inferred region so the next request can filter
      // region-blocked tracks without a geo header.
      const cookie = regionCookie(region)
      if (cookie) response.headers.append('Set-Cookie', cookie)
      return response
    } catch (error) {
      const mapped = mapError(error)
      increment('apiError')
      observeDuration(`route:${options.scope}`, Date.now() - startedAt)
      logger.error('request failed', {
        requestId,
        scope: options.scope,
        method: request.method,
        path: url.pathname,
        status: mapped.status,
        units: meter.units,
        durationMs: Date.now() - startedAt,
        error,
      })
      return fail(mapped.code, mapped.message, mapped.status, {
        requestId,
        unitsSpent: meter.units,
        calls: meter.calls,
      })
    }
  }
}

type Mapped = { code: ErrorCode; message: string; status: number }

/**
 * Turns any failure into one of the app's stable error codes.
 *
 * Exported so the mapping can be tested directly: the quota case in
 * particular is the one that used to be wrong, and it was wrong because
 * nothing tested it.
 */
export function mapError(error: unknown): Mapped {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message, status: error.status }
  }

  if (error instanceof ZodError) {
    const first = error.issues[0]
    const field = first?.path?.join('.')
    return {
      code: 'invalid_request',
      message: field
        ? `${field}: ${first?.message ?? 'is invalid'}`
        : (first?.message ?? 'The request body is invalid.'),
      status: 400,
    }
  }

  if (error instanceof YouTubeError) {
    if (isQuotaError(error)) {
      return {
        code: 'quota_exceeded',
        message: error.message,
        status: 429,
      }
    }
    // A throttle is a limit too, but a different one: it clears on its own,
    // so it must not be reported as a spent daily budget.
    if (error.status === 429) {
      return { code: 'rate_limited', message: error.message, status: 429 }
    }
    if (error.status === 403) {
      return { code: 'forbidden', message: error.message, status: 403 }
    }
    if (error.status === 404) {
      return { code: 'not_found', message: error.message, status: 404 }
    }
    return { code: 'upstream_error', message: error.message, status: 502 }
  }

  if (error instanceof SpotifyError) {
    return { code: 'upstream_error', message: error.message, status: 502 }
  }

  if (error instanceof TypeError) {
    return {
      code: 'network',
      message: 'The network request failed. Check your connection and try again.',
      status: 502,
    }
  }

  const message = error instanceof Error ? error.message : 'Something went wrong.'
  return { code: 'internal_error', message, status: 500 }
}

/** Parse a JSON body without throwing on malformed input. */
export async function readJson(request: Request): Promise<unknown> {
  return request.json().catch(() => null)
}
