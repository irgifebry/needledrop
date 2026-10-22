import { z } from 'zod'

import { readJson, withRoute } from '@/lib/http/handler'
import { fail, ok } from '@/lib/http/respond'
import { hasLiveApi } from '@/lib/youtube/client'
import { resolveSeed } from '@/lib/youtube/resolve'
import { seedProfileToJson } from '@/lib/youtube/types'

/**
 * `POST /api/resolve` — parse a seed into candidates + a centroid (PLAN §15).
 *
 * The route is deliberately thin: it validates the body, hands the raw input
 * to the resolver and reports what the resolution cost. Resolving needs no
 * authentication, but it does spend quota, so it is rate limited.
 */

const Body = z.object({
  input: z.string().min(1).max(2000),
})

export const POST = withRoute(
  async ({ request, meter }) => {
    const parsed = Body.safeParse(await readJson(request))
    if (!parsed.success) {
      return fail(
        'invalid_request',
        parsed.error.issues[0]?.message ?? 'A seed input is required.',
        400,
        { unitsSpent: meter.units },
      )
    }

    const resolution = await resolveSeed(parsed.data.input, meter)
    const meta = {
      unitsSpent: meter.units,
      calls: meter.calls,
      demo: !hasLiveApi(),
    }

    if (resolution.candidates.length === 0) {
      return fail(
        'no_results',
        'Nothing matched that seed. Try a different title, artist or link.',
        404,
        meta,
      )
    }

    return ok(
      {
        kind: resolution.kind,
        label: resolution.label,
        source: resolution.source,
        centroid: resolution.centroid ? seedProfileToJson(resolution.centroid) : null,
        candidates: resolution.candidates,
      },
      meta,
    )
  },
  { scope: 'resolve', limit: 20 },
)
