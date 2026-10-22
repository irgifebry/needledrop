import { z } from 'zod'

import { getCached } from '@/lib/cache'
import { readJson, withRoute } from '@/lib/http/handler'
import { fail, ok } from '@/lib/http/respond'
import { estimatePlaylistUnits } from '@/lib/quota'
import { budgetStatus } from '@/lib/quota-ledger'
import { hasLiveApi } from '@/lib/youtube/client'
import {
  discoveryCacheKey,
  discoveryRequestSchema,
  estimatePlan,
  sessionIdFromRequest,
} from '@/lib/youtube/discover'
import { normalizeDiscoveryOptions } from '@/lib/youtube/options'
import type { Candidate } from '@/lib/youtube/types'

/**
 * `POST /api/plan` — the dry run (PLAN §13.7).
 *
 * "Returns the estimated cost + the top-N preview *without* calling the
 * expensive endpoints." Nothing here spends quota: the estimate comes from
 * the planned call counts, and the preview can only come from the cache.
 */

const PlanRequest = discoveryRequestSchema.extend({
  topN: z.number().int().min(1).max(50).optional(),
})

export const POST = withRoute(
  async ({ request, meter }) => {
    const parsed = PlanRequest.safeParse(await readJson(request))
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
    const demo = !hasLiveApi()

    // The plan mirrors the pipeline: same sources, same order, same batches.
    const estimate = estimatePlan(parsed.data.seed, options, { depth: options.depth })
    const playlistEstimate = {
      units: estimatePlaylistUnits(options.count),
      tracks: options.count,
    }

    // A preview is only possible from the cache — never from a live call.
    const cached = await getCached<Candidate[]>(
      discoveryCacheKey(parsed.data.seed, options),
    )
    const topN = parsed.data.topN ?? 10
    const preview = cached ? cached.slice(0, topN) : null

    const note = preview
      ? 'Estimate only — this request spent no quota. The preview comes from the cache; a fresh run would cost roughly the estimate above.'
      : 'Estimate only — this request spent no quota. There is no cached result for this seed yet, so the preview stays empty until the first run.'

    return ok(
      {
        estimate,
        playlistEstimate,
        preview,
        note,
        budget: budgetStatus(sessionId),
        demo,
      },
      {
        unitsSpent: meter.units,
        calls: meter.calls,
      },
    )
  },
  { scope: 'plan', limit: 30 },
)
