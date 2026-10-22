import { NextResponse, type NextRequest } from 'next/server'

import { checkRateLimit, clientKey } from '@/lib/http/rate-limit'
import { newRequestId } from '@/lib/observability/logger'

/**
 * Edge guard (PLAN §13.11).
 *
 * The two endpoints that burn 100 quota units a call get a coarse, per-IP
 * limit here — before the route handler runs — so a runaway client cannot
 * drain the shared project quota. The per-route limiter in `withRoute` stays
 * the precise one; this is the cheap outer fence.
 *
 * Next 16 renamed middleware to *proxy*, and the proxy runtime is Node-only.
 * The state is per-instance, which is fine: the limit here is deliberately
 * loose and exists to stop a single misbehaving client, not to be an
 * accurate global quota.
 */

const COARSE_LIMITS: Record<string, { limit: number; windowMs: number }> = {
  '/api/search': { limit: 15, windowMs: 60_000 },
  '/api/resolve': { limit: 15, windowMs: 60_000 },
  '/api/discover': { limit: 20, windowMs: 60_000 },
  // The route the shipped UI actually calls for discovery. It spends the same
  // 500 units as `/api/discover`, so it needs the same fence — without it,
  // the coarsest limit on the most expensive path was 30/min.
  '/api/similar': { limit: 20, windowMs: 60_000 },
  '/api/plan': { limit: 30, windowMs: 60_000 },
  '/api/export': { limit: 30, windowMs: 60_000 },
}

export async function proxy(request: NextRequest) {
  const requestId = request.headers.get('x-request-id') ?? newRequestId()
  const rule = COARSE_LIMITS[request.nextUrl.pathname]

  if (rule) {
    const key = clientKey(request, `proxy:${request.nextUrl.pathname}`)
    const result = await checkRateLimit(key, rule.limit, rule.windowMs)

    if (!result.ok) {
      return NextResponse.json(
        {
          code: 'rate_limited',
          message: 'Too many requests. Give it a minute and try again.',
          requestId,
        },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))) },
        },
      )
    }
  }

  const response = NextResponse.next()
  response.headers.set('x-request-id', requestId)
  return response
}

export const config = {
  matcher: ['/api/:path*'],
}
