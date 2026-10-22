import { AppError } from '@/lib/http/errors'
import { withRoute } from '@/lib/http/handler'
import { fail, ok } from '@/lib/http/respond'
import { requireFreshSession } from '@/lib/http/session'
import { listUserPlaylists } from '@/lib/youtube/playlist-lifecycle'

/**
 * `GET /api/playlists` — the user's playlists (PLAN §15).
 *
 * Query: `?max=50&pageToken=…`. Costs 1 quota unit per page.
 *
 * The route needs an OAuth token with the `youtube.readonly` scope. A token
 * without it is not an error the user can fix by retrying, so it comes back
 * as `forbidden` with a copy that says what to do about it.
 */

export const dynamic = 'force-dynamic'

function boundedMax(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  if (!Number.isFinite(parsed)) return 50
  if (parsed < 1) return 1
  if (parsed > 50) return 50
  return parsed
}

export const GET = withRoute(
  async ({ url, meter, requestId }) => {
    const session = await requireFreshSession()

    const maxResults = boundedMax(url.searchParams.get('max'))
    const pageToken = url.searchParams.get('pageToken') ?? undefined

    try {
      const result = await listUserPlaylists(session.accessToken, meter, {
        maxResults,
        pageToken,
      })

      return ok(
        {
          playlists: result.playlists,
          nextPageToken: result.nextPageToken ?? null,
        },
        { unitsSpent: meter.units, calls: meter.calls, requestId },
      )
    } catch (error) {
      if (error instanceof AppError && error.code === 'forbidden') {
        return fail(
          'forbidden',
          'Your Google account cannot read your YouTube playlists. Sign in again and allow playlist access.',
          403,
          { unitsSpent: meter.units, calls: meter.calls, requestId },
        )
      }
      throw error
    }
  },
  { scope: 'playlists' },
)
