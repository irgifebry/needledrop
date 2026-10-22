import { readJson, withRoute } from '@/lib/http/handler'
import { fail, ok } from '@/lib/http/respond'
import { hasLiveApi } from '@/lib/youtube/client'
import {
  discover,
  discoveryRequestSchema,
  sessionIdFromRequest,
} from '@/lib/youtube/discover'
import { normalizeDiscoveryOptions } from '@/lib/youtube/options'

/**
 * `POST /api/discover` — the full discovery pipeline (PLAN §15).
 *
 * The route is deliberately thin: it validates the body, normalises the
 * options (v1 shape *or* v2 shape) and hands everything to `discover`. The
 * pipeline owns the quota spend; the route only reports it.
 *
 * The response keeps the legacy `{ candidates, unitsSpent, calls }` shape so
 * the existing client can adopt it without a rewrite, and adds `demo` and
 * `cached` on top.
 */
export const POST = withRoute(
  async ({ request, meter, region }) => {
    const parsed = discoveryRequestSchema.safeParse(await readJson(request))
    if (!parsed.success) {
      return fail(
        'invalid_request',
        parsed.error.issues[0]?.message ?? 'A seed track is required.',
        400,
        { unitsSpent: meter.units, calls: meter.calls },
      )
    }

    const options = normalizeDiscoveryOptions(parsed.data.options)
    const sessionId = sessionIdFromRequest(request)

    const candidates = await discover(parsed.data.seed, options, meter, {
      region,
      depth: options.depth,
      sessionId,
      // The library keys are not loaded here: the library is behind the
      // lifecycle agent's authenticated routes, and an anonymous visitor has
      // no library to compare against. The pipeline supports it the moment a
      // caller has keys to hand.
    })

    const demo = !hasLiveApi()

    return ok(
      { candidates },
      {
        unitsSpent: meter.units,
        calls: meter.calls,
        demo,
        // `true` when the whole run was answered from the cache: no upstream
        // call was made, so nothing was spent.
        cached: !demo && meter.calls === 0,
      },
    )
  },
  { scope: 'discover', limit: 20 },
)
