import { cacheStats } from '@/lib/cache'
import { flagSnapshot } from '@/features/flags'
import { withRoute } from '@/lib/http/handler'
import { ok } from '@/lib/http/respond'
import { estimateDiscoveryUnits, estimatePlaylistUnits } from '@/lib/quota'
import { budgetStatus } from '@/lib/quota-ledger'
import { hasLiveApi } from '@/lib/youtube/client'
import { sessionIdFromRequest } from '@/lib/youtube/discover'

/**
 * `GET /api/quota` — the budget snapshot (PLAN §15, §13.7).
 *
 * The existing client reads `demo` from this route, so that field stays.
 * The rest grew from two bare numbers into the full picture: what discovery
 * and a playlist cost, how much of the budget is left, how well the cache is
 * doing and which feature flags are on.
 */

/**
 * The headline discovery cost.
 *
 * These are the plan's own figures (four searches and two video calls) and
 * they are what makes the "~1,450 units ≈ one 20-track playlist" rule of
 * thumb add up. `/api/plan` gives the precise, source-by-source estimate of
 * the pipeline that actually runs.
 */
const DISCOVERY_SEARCH_CALLS = 4
const DISCOVERY_VIDEO_CALLS = 2

/** The playlist size the headline figure is quoted for. */
const HEADLINE_TRACK_COUNT = 20

export const GET = withRoute(
  async ({ request, meter }) => {
    const sessionId = sessionIdFromRequest(request)
    const budget = budgetStatus(sessionId)

    const discoveryUnits = estimateDiscoveryUnits(
      DISCOVERY_SEARCH_CALLS,
      DISCOVERY_VIDEO_CALLS,
    )

    return ok(
      {
        dailyQuota: budget.dailyQuota,
        globalCap: budget.globalCap,
        sessionBudget: budget.sessionBudget,
        demo: !hasLiveApi(),
        discovery: {
          units: discoveryUnits,
          calls: DISCOVERY_SEARCH_CALLS + DISCOVERY_VIDEO_CALLS,
        },
        playlist: {
          units: estimatePlaylistUnits(HEADLINE_TRACK_COUNT),
          tracks: HEADLINE_TRACK_COUNT,
        },
        budget,
        cache: cacheStats(),
        flags: flagSnapshot(),
      },
      {
        unitsSpent: meter.units,
        calls: meter.calls,
      },
    )
  },
  { scope: 'quota' },
)
