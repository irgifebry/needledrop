import { z } from 'zod'

import { withRoute, readJson } from '@/lib/http/handler'
import { fail, ok } from '@/lib/http/respond'
import { requireFreshSession } from '@/lib/http/session'
import {
  listAllPlaylistItems,
  removePlaylistItem,
  reorderPlaylistItems,
} from '@/lib/youtube/playlist-lifecycle'

/**
 * `PATCH /api/playlists/:id/items` — reorder and remove tracks (PLAN §15).
 *
 * Body:
 * ```json
 * { "order": ["videoId", "…"], "remove": ["playlistItemId", "…"] }
 * ```
 * Both keys are optional but at least one has to be present.
 *
 * - `remove` holds **playlist item ids** (the `id` of a `playlistItems`
 *   entry, not the video id). Each removal costs 50 units.
 * - `order` holds **video ids** in their new order. Items that are not named
 *   keep their relative order and end up after the named ones, so a partial
 *   order is safe. Only the items that actually change position are moved —
 *   50 units each.
 *
 * Removals are applied first, because deleting an item shifts every position
 * behind it and would invalidate a reorder computed against the old list.
 *
 * The response contains the resulting item list and a `failed` array with
 * everything that could not be applied — a playlist that is half-updated is
 * more useful than a 500 with no explanation.
 */

export const dynamic = 'force-dynamic'

const ItemsBody = z
  .object({
    order: z.array(z.string().min(1)).max(500).optional(),
    remove: z.array(z.string().min(1)).max(500).optional(),
  })
  .refine((value) => value.order !== undefined || value.remove !== undefined, {
    message: 'Provide an "order" and/or a "remove" list.',
  })

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0]
  const field = issue?.path.join('.')
  if (field) return `${field}: ${issue?.message ?? 'is invalid'}`
  return issue?.message ?? 'The request body is invalid.'
}

/** `PATCH /api/playlists/:id/items` — reorder and/or remove tracks. */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params

  return withRoute(
    async ({ meter, requestId }) => {
      const session = await requireFreshSession()

      const parsed = ItemsBody.safeParse(await readJson(request))
      if (!parsed.success) {
        return fail('invalid_request', firstIssue(parsed.error), 400, {
          unitsSpent: meter.units,
          calls: meter.calls,
          requestId,
        })
      }

      const { order, remove } = parsed.data
      const failed: Array<{ id: string; reason: string }> = []
      let removed = 0
      let moved = 0

      for (const itemId of remove ?? []) {
        try {
          await removePlaylistItem(session.accessToken, itemId, meter)
          removed += 1
        } catch (error) {
          failed.push({
            id: itemId,
            reason: error instanceof Error ? error.message : 'This item could not be removed.',
          })
        }
      }

      if (order !== undefined) {
        const outcome = await reorderPlaylistItems(session.accessToken, id, order, meter)
        moved = outcome.moved
        for (const entry of outcome.failed) {
          failed.push({ id: entry.videoId, reason: entry.reason })
        }
      }

      const { items, truncated } = await listAllPlaylistItems(session.accessToken, id, meter)

      return ok(
        { items, truncated, removed, moved, failed },
        { unitsSpent: meter.units, calls: meter.calls, requestId },
      )
    },
    { scope: 'playlists:write' },
  )(request)
}
