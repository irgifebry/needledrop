import { NextResponse } from 'next/server'
import { z } from 'zod'

import { hasJobs } from '@/lib/env'
import { withRoute } from '@/lib/http/handler'
import { fail, ok, type ResponseMeta } from '@/lib/http/respond'
import { requireFreshSession } from '@/lib/http/session'
import { idempotencyKeyOf, lookup, remember, scopedIdempotencyKey } from '@/lib/jobs/idempotency'
import { enqueue, getJob, sessionIdOf } from '@/lib/jobs/queue'
import { estimatePlaylistUnits } from '@/lib/quota'
import { hasLiveApi } from '@/lib/youtube/client'

/**
 * `POST /api/jobs` — queue a playlist creation.
 *
 * The response is immediate: a 50-track playlist is 51 sequential API calls,
 * which no request should ever wait for. The client gets a job id and then
 * follows `/api/jobs/:id/stream` for progress.
 */
const Body = z.object({
  videoIds: z
    .array(z.string().trim().regex(/^[A-Za-z0-9_-]{11}$/, 'Expected a YouTube video id'))
    .min(1)
    .max(50),
  title: z.string().trim().min(1).max(100),
  description: z.string().max(5000).default(''),
  privacy: z.enum(['private', 'unlisted', 'public']).default('private'),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
})

/**
 * `ok()` always answers with 200, but the jobs contract asks for 201 on a
 * fresh creation and 200 on an idempotent replay — the client uses the
 * difference to know whether it is looking at a new playlist.
 */
function jobResponse(
  status: number,
  data: Record<string, unknown>,
  meta: ResponseMeta,
): NextResponse {
  return NextResponse.json({ ...data, ...meta }, { status })
}

export const POST = withRoute(
  async ({ request, meter }) => {
    const parsed = Body.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return fail(
        'invalid_request',
        'A track list, a title and a privacy setting are required.',
        400,
        { unitsSpent: meter.units, calls: meter.calls },
      )
    }

    const input = parsed.data

    // Demo mode: without a live API key nothing can be written to YouTube.
    // Say so plainly instead of pretending a playlist exists.
    if (!hasLiveApi()) {
      return ok(
        {
          jobId: null,
          demo: true,
          message: 'Demo mode: no playlist was created on YouTube.',
        },
        {
          unitsSpent: estimatePlaylistUnits(input.videoIds.length),
          calls: meter.calls,
          demo: true,
        },
      )
    }

    if (!hasJobs()) {
      return fail(
        'upstream_unavailable',
        'Background jobs are disabled on this deployment.',
        503,
        { unitsSpent: meter.units, calls: meter.calls },
      )
    }

    // A fresh session, because the access token is captured here and used by
    // the background worker for the next few minutes.
    const session = await requireFreshSession()
    const sessionId = sessionIdOf(session)

    // The client may bring its own key; otherwise one is derived from the
    // request so a double-click still resolves to the same job.
    const key = input.idempotencyKey
      ? scopedIdempotencyKey(sessionId, input.idempotencyKey)
      : idempotencyKeyOf(input, sessionId)

    const existingId = lookup(key)
    if (existingId) {
      const existing = getJob(existingId)
      if (existing) {
        return ok(
          { jobId: existing.id, status: existing.status, idempotent: true },
          { unitsSpent: meter.units, calls: meter.calls },
        )
      }
    }

    const state = enqueue(
      { ...input, idempotencyKey: key },
      {
        accessToken: session.accessToken,
        sessionId,
        userEmail: session.email,
      },
    )
    remember(key, state.id)

    return jobResponse(
      201,
      { jobId: state.id, status: state.status, idempotent: false },
      { unitsSpent: meter.units, calls: meter.calls },
    )
  },
  { scope: 'jobs', limit: 10 },
)
