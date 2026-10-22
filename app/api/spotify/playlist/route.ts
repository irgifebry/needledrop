import { z } from 'zod'

import { withRoute } from '@/lib/http/handler'
import { fail, ok } from '@/lib/http/respond'
import { getPlaylistTracks } from '@/lib/spotify/search'

const Body = z.object({
  playlist: z.string().min(1),
})

export const POST = withRoute(
  async ({ request, meter }) => {
    const parsed = Body.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return fail('invalid_request', 'A Spotify playlist link or id is required.', 400, {
        unitsSpent: meter.units,
        calls: meter.calls,
      })
    }

    const tracks = await getPlaylistTracks(parsed.data.playlist)
    return ok({ tracks }, { unitsSpent: meter.units, calls: meter.calls })
  },
  { scope: 'spotify-playlist', limit: 20 },
)
