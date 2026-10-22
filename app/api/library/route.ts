import { AppError } from '@/lib/http/errors'
import { withRoute } from '@/lib/http/handler'
import { fail, ok } from '@/lib/http/respond'
import { requireFreshSession } from '@/lib/http/session'
import {
  libraryDuplicateIndex,
  listUserPlaylists,
} from '@/lib/youtube/playlist-lifecycle'

/**
 * `GET /api/library` — the library overview (PLAN §15, §13.5).
 *
 * Returns:
 * - `playlists`     — the user's playlists, with their lineage parsed.
 * - `generated`     — the ids of the playlists NeedleDrop made, so the UI
 *                     can highlight them without re-reading the descriptions.
 * - `duplicateIndex`— how much of the library was scanned, which tracks were
 *                     found, and the bounds the scan ran under.
 *
 * The duplicate index is what powers "skip tracks I already have": it walks
 * the user's playlists and collects the canonical `artist::title` keys of
 * everything in them. The walk is bounded (20 playlists / 500 items by
 * default) because a user with a hundred playlists must not spend a hundred
 * quota units on one click — the bounds travel with the answer so the UI can
 * say "checked 20 of 34 playlists" instead of pretending it saw everything.
 *
 * Cost: 1 unit for the playlist list plus 1 unit per page of 50 items read.
 */

export const dynamic = 'force-dynamic'

export const GET = withRoute(
  async ({ meter, requestId }) => {
    const session = await requireFreshSession()

    try {
      const { playlists } = await listUserPlaylists(session.accessToken, meter, { maxResults: 50 })

      const index = await libraryDuplicateIndex(session.accessToken, meter, { playlists })

      const generated = playlists
        .filter((playlist) => playlist.lineage !== null)
        .map((playlist) => playlist.id)

      return ok(
        {
          playlists,
          generated,
          duplicateIndex: {
            trackKeys: index.trackKeys.size,
            scannedPlaylists: index.scannedPlaylists,
            scannedItems: index.scannedItems,
            maxPlaylists: index.maxPlaylists,
            maxItems: index.maxItems,
            truncated: index.truncated,
            // The keys themselves, so the client can work out how many of the
            // tracks it is about to offer are already in the library.
            keys: [...index.trackKeys],
          },
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
  { scope: 'library' },
)
