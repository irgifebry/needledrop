import { z } from 'zod'

import { withRoute, readJson } from '@/lib/http/handler'
import { fail, ok } from '@/lib/http/respond'
import { normalizeDiscoveryOptions } from '@/lib/youtube/options'
import { discover, seedSchema, sessionIdFromRequest } from '@/lib/youtube/discover'
import { canReachLiveApi } from '@/lib/youtube/client'

/**
 * `POST { seed, options }` → the scored candidate pool.
 *
 * The legacy entry point the current client calls. It is now a thin wrapper
 * over the same pipeline that `/api/discover` uses, so both routes see
 * exactly the same engine, the same filters and the same quota accounting.
 */
const Body = z.object({
  seed: seedSchema,
  options: z.unknown().optional(),
})

export const POST = withRoute(
  async ({ request, meter, region, apiKey }) => {
    const parsed = Body.safeParse(await readJson(request))
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const field = issue?.path.join('.')
      return fail(
        'invalid_request',
        field ? `${field}: ${issue?.message ?? 'is invalid'}` : 'A seed track and options are required.',
        400,
        { unitsSpent: meter.units, calls: meter.calls },
      )
    }

    // Accepts the v1 option shape and the v2 one, and always returns a
    // complete set of options.
    const options = normalizeDiscoveryOptions(parsed.data.options)

    // The session id must come from the request. Without it every anonymous
    // caller shared the literal 'anonymous' budget, so the per-session cap
    // could never trip and the second hop always ran.
    const candidates = await discover(parsed.data.seed, options, meter, {
      region,
      depth: options.depth,
      sessionId: sessionIdFromRequest(request),
      // A visitor's own key moves the whole run onto their own quota.
      apiKeyOverride: apiKey ?? undefined,
    })

    return ok(
      { candidates },
      {
        unitsSpent: meter.units,
        calls: meter.calls,
        demo: !canReachLiveApi(apiKey),
      },
    )
  },
  { scope: 'similar', limit: 30 },
)
