import { z } from 'zod'

import { withRoute } from '@/lib/http/handler'
import { fail, ok } from '@/lib/http/respond'
import { hasLiveApi } from '@/lib/youtube/client'
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
  async ({ request, meter }) => {
    const parsed = Body.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return fail('invalid_request', 'A search query is required.', 400, {
        unitsSpent: meter.units,
        calls: meter.calls,
      })
    }

    const seeds = await searchSeeds(parsed.data.query, meter)
    return ok(
      { seeds },
      {
        unitsSpent: meter.units,
        calls: meter.calls,
        demo: !hasLiveApi(),
      },
    )
  },
  { scope: 'search', limit: 20 },
)
