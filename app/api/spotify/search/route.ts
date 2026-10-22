import { z } from 'zod'

import { withRoute } from '@/lib/http/handler'
import { fail, ok } from '@/lib/http/respond'
import { searchTracks } from '@/lib/spotify/search'

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

    const tracks = await searchTracks(parsed.data.query, 20)
    return ok({ tracks }, { unitsSpent: meter.units, calls: meter.calls })
  },
  { scope: 'spotify-search', limit: 20 },
)
