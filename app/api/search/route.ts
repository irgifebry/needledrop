import { z } from 'zod'

import { withRoute } from '@/lib/http/handler'
import { fail, ok } from '@/lib/http/respond'
import { canReachLiveApi } from '@/lib/youtube/client'
import { sessionIdFromRequest } from '@/lib/youtube/discover'
import { searchSeeds } from '@/lib/youtube/search'

/**
 * `POST { query }` → seed candidates.
 *
 * The legacy entry point the existing client uses. It stays exactly as it
 * was — same body, same response shape — and simply gains the shared
 * request id, rate limiting and error mapping.
 */
const Body = z.object({
  query: z.string().min(1).max(200),
})

export const POST = withRoute(
  async ({ request, meter, apiKey }) => {
    const parsed = Body.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return fail('invalid_request', 'A search query is required.', 400, {
        unitsSpent: meter.units,
        calls: meter.calls,
      })
    }

    // The session id attributes the spend in the quota ledger: a search
    // costs 100 units, and a budget that cannot see it cannot cap it.
    // A visitor's own key moves the spend onto their own quota.
    const seeds = await searchSeeds(parsed.data.query, meter, {
      sessionId: sessionIdFromRequest(request),
      apiKeyOverride: apiKey ?? undefined,
    })
    return ok(
      { seeds },
      {
        unitsSpent: meter.units,
        calls: meter.calls,
        demo: !canReachLiveApi(apiKey),
      },
    )
  },
  { scope: 'search', limit: 20 },
)
