import { z } from 'zod'

import {
  deleteAllUserData,
  getAnonId,
  recordFeedback,
  rotateAnonId,
  storeLabel,
} from '@/lib/db/repo'
import { readJson, withRoute } from '@/lib/http/handler'
import { fail, ok } from '@/lib/http/respond'

/**
 * `POST | DELETE /api/feedback` — the per-track keep/drop signal.
 *
 * `POST` records one signal; it is the raw material the ranking loop learns
 * from, so it is worth storing even when the run it belongs to was never
 * persisted.
 *
 * `DELETE` is the "delete all my data" endpoint required by PLAN §13.11. It
 * erases every row stored under the caller's anonymous id — presets, blocks,
 * feedback and run history alike — and then rotates the anonymous id so the
 * old cookie cannot reach anything. It is destructive and therefore explicit:
 * a body of `{ "confirm": true }` is required.
 *
 * The store is optional: the response always carries `"store"`, which is
 * `"memory"` when no database is configured or reachable and `"postgres"`
 * when the rows really are persisted.
 */

const Body = z.object({
  runId: z.string().trim().min(1).max(64).optional(),
  videoId: z.string().trim().min(1).max(64),
  verdict: z.enum(['keep', 'drop']),
  reason: z.string().trim().max(500).optional(),
})

const Confirm = z.object({
  confirm: z.literal(true),
})

export const POST = withRoute(
  async ({ request, meter }) => {
    const parsed = Body.safeParse(await readJson(request))
    if (!parsed.success) {
      return fail(
        'invalid_request',
        'Feedback needs a video id, a verdict (keep or drop) and an optional reason.',
        400,
        { unitsSpent: meter.units, calls: meter.calls },
      )
    }

    const anonId = await getAnonId()
    await recordFeedback(anonId, {
      runId: parsed.data.runId ?? null,
      videoId: parsed.data.videoId,
      verdict: parsed.data.verdict,
      reason: parsed.data.reason ?? null,
    })

    return ok(
      { recorded: true },
      { store: storeLabel(), unitsSpent: meter.units, calls: meter.calls },
    )
  },
  { scope: 'feedback', limit: 120 },
)

export const DELETE = withRoute(
  async ({ request, meter }) => {
    const parsed = Confirm.safeParse(await readJson(request))
    if (!parsed.success) {
      return fail(
        'invalid_request',
        'Deleting all data is irreversible. Send { "confirm": true } to proceed.',
        400,
        { unitsSpent: meter.units, calls: meter.calls },
      )
    }

    const anonId = await getAnonId()
    const deleted = await deleteAllUserData(anonId)
    await rotateAnonId()

    return ok(
      { deleted },
      { store: storeLabel(), unitsSpent: meter.units, calls: meter.calls },
    )
  },
  { scope: 'feedback', limit: 10 },
)
