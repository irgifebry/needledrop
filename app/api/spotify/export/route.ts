import { z } from 'zod'

import { AppError } from '@/lib/http/errors'
import { withRoute } from '@/lib/http/handler'
import { fail, ok } from '@/lib/http/respond'
import { readSpotifySession, writeSpotifySession } from '@/lib/session'
import { refreshAccessToken } from '@/lib/spotify/oauth'
import { createPlaylist, searchTrackUri } from '@/lib/spotify/playlists'

const Body = z.object({
  name: z.string().min(1).max(100),
  tracks: z
    .array(z.object({ title: z.string().min(1), artist: z.string().optional().default('') }))
    .min(1)
    .max(200),
})

export const POST = withRoute(
  async ({ request, meter }) => {
    const parsed = Body.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return fail('invalid_request', 'A playlist name and track list are required.', 400, {
        unitsSpent: meter.units,
        calls: meter.calls,
      })
    }

    let session = await readSpotifySession()
    if (!session) {
      throw new AppError('auth_required', 'Connect your Spotify account to export playlists.', 401)
    }

    if (session.expiresAt - Date.now() < 60_000 && session.refreshToken) {
      try {
        const refreshed = await refreshAccessToken(session)
        await writeSpotifySession(refreshed)
        session = refreshed
      } catch {
        throw new AppError('auth_expired', 'Your Spotify session expired. Connect again.', 401)
      }
    }

    const uris: string[] = []
    let skipped = 0
    for (const track of parsed.data.tracks) {
      const query = `${track.title} ${track.artist}`.trim()
      const uri = await searchTrackUri(query)
      if (uri) uris.push(uri)
      else skipped += 1
    }

    const result = await createPlaylist(parsed.data.name, uris, session.accessToken)

    return ok(
      {
        playlistId: result.id,
        spotifyUrl: result.spotifyUrl,
        added: uris.length,
        skipped,
      },
      { unitsSpent: meter.units, calls: meter.calls },
    )
  },
  { scope: 'spotify-export', limit: 10 },
)
