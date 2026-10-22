import { z } from 'zod'

import { withRoute } from '@/lib/http/handler'
import { fail, ok } from '@/lib/http/respond'
import { requireFreshSession } from '@/lib/http/session'
import { createPlaylist } from '@/lib/youtube/playlists'
import { hasLiveApi } from '@/lib/youtube/client'

/**
 * `POST { videoIds, title, description, privacy }` → the created playlist.
 *
 * The synchronous path. It is fine for a 20-track playlist (21 calls) but
 * a 50-track playlist takes 51 sequential calls, which is why `/api/jobs`
 * exists for the long runs.
 */
const Body = z.object({
  videoIds: z.array(z.string().min(1)).min(1).max(50),
  title: z.string().min(1).max(100),
  description: z.string().max(5000).default(''),
  privacy: z.enum(['private', 'unlisted', 'public']).default('private'),
})

export const POST = withRoute(
  async ({ request, meter }) => {
    const parsed = Body.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return fail('invalid_request', 'A track list, title and privacy are required.', 400, {
        unitsSpent: meter.units,
        calls: meter.calls,
      })
    }

    // Demo mode: no API key, so nothing can be written to YouTube. Say so
    // plainly rather than pretending a playlist exists.
    if (!hasLiveApi()) {
      return ok(
        {
          demo: true,
          playlistId: null,
          playlistUrl: null,
          message:
            'Demo mode: no playlist was created on YouTube. Connect a Google account and a YouTube API key to create it for real.',
        },
        { unitsSpent: 50 + 50 * parsed.data.videoIds.length, calls: meter.calls },
      )
    }

    // Refreshes the access token when it is about to expire, so the insert
    // calls do not fail mid-flight with a 401.
    const session = await requireFreshSession()

    const result = await createPlaylist(session.accessToken, parsed.data, meter)

    return ok(
      {
        demo: false,
        playlistId: result.playlistId,
        playlistUrl: result.playlistUrl,
        ordered: result.ordered,
        note: result.note,
      },
      { unitsSpent: meter.units, calls: meter.calls },
    )
  },
  { scope: 'playlist', limit: 10 },
)
