import { z } from 'zod'

import { withRoute, readJson } from '@/lib/http/handler'
import { fail, ok } from '@/lib/http/respond'
import { requireFreshSession } from '@/lib/http/session'
import {
  deletePlaylist,
  getPlaylist,
  listAllPlaylistItems,
  updatePlaylist,
} from '@/lib/youtube/playlist-lifecycle'

/**
 * `/api/playlists/:id` — one playlist (PLAN §15).
 *
 * - `GET`    → the playlist plus its items.   Cost: 1 unit + 1 unit / 50 items.
 * - `PATCH`  → rename / re-describe / re-tag / change privacy. Cost: 50 units.
 * - `DELETE` → delete the playlist. Cost: 50 units.
 *
 * All three need an OAuth session; the write verbs need a token that is
 * allowed to change playlists, which is a different scope from reading them.
 *
 * **Deletion needs an explicit confirmation.** `DELETE` is not reversible on
 * YouTube's side, so the request body must carry `{ "confirm": true }`.
 * Without it the route answers `invalid_request` (400) and nothing is
 * deleted. The UI is expected to show a confirmation dialog first; this
 * check is the backstop for a request that was fired by a stray script, a
 * double click or a stale tab.
 */

export const dynamic = 'force-dynamic'

const PatchBody = z
  .object({
    title: z.string().min(1).max(100).optional(),
    description: z.string().max(5000).optional(),
    tags: z.array(z.string().min(1).max(30)).max(30).optional(),
    privacy: z.enum(['private', 'unlisted', 'public']).optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: 'Nothing to update.',
  })

const DeleteBody = z.object({ confirm: z.literal(true) })

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0]
  const field = issue?.path.join('.')
  if (field) return `${field}: ${issue?.message ?? 'is invalid'}`
  return issue?.message ?? 'The request body is invalid.'
}

/** `GET /api/playlists/:id` — the playlist and everything in it. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params

  return withRoute(
    async ({ meter, requestId }) => {
      const session = await requireFreshSession()

      const playlist = await getPlaylist(session.accessToken, id, meter)
      if (!playlist) {
        return fail('not_found', 'That playlist does not exist, or it is not yours.', 404, {
          unitsSpent: meter.units,
          calls: meter.calls,
          requestId,
        })
      }

      const { items, truncated } = await listAllPlaylistItems(session.accessToken, id, meter)

      return ok({ playlist, items, truncated }, { unitsSpent: meter.units, calls: meter.calls, requestId })
    },
    { scope: 'playlists' },
  )(request)
}

/** `PATCH /api/playlists/:id` — rename / re-describe / re-tag / re-privatise. */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params

  return withRoute(
    async ({ meter, requestId }) => {
      const session = await requireFreshSession()

      const parsed = PatchBody.safeParse(await readJson(request))
      if (!parsed.success) {
        return fail('invalid_request', firstIssue(parsed.error), 400, {
          unitsSpent: meter.units,
          calls: meter.calls,
          requestId,
        })
      }

      const playlist = await updatePlaylist(session.accessToken, id, parsed.data, meter)

      return ok({ playlist }, { unitsSpent: meter.units, calls: meter.calls, requestId })
    },
    { scope: 'playlists:write' },
  )(request)
}

/** `DELETE /api/playlists/:id` — delete the playlist. Needs `{ confirm: true }`. */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params

  return withRoute(
    async ({ meter, requestId }) => {
      const session = await requireFreshSession()

      const parsed = DeleteBody.safeParse(await readJson(request))
      if (!parsed.success) {
        return fail('invalid_request', 'Deletion needs an explicit confirmation.', 400, {
          unitsSpent: meter.units,
          calls: meter.calls,
          requestId,
        })
      }

      await deletePlaylist(session.accessToken, id, meter)

      return ok({ deleted: true, playlistId: id }, { unitsSpent: meter.units, calls: meter.calls, requestId })
    },
    { scope: 'playlists:write' },
  )(request)
}
