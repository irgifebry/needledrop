import { withRoute } from '@/lib/http/handler'
import { fail, ok } from '@/lib/http/respond'
import { requireSession } from '@/lib/http/session'
import { getJob, sessionIdOf } from '@/lib/jobs/queue'

/**
 * `GET /api/jobs/:id` — the current state of one job.
 *
 * The snapshot is nested under `job` so it cannot collide with the
 * request-level `unitsSpent` / `calls` that every response carries.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params

  return withRoute(
    async ({ meter }) => {
      const session = await requireSession()
      const job = getJob(id)

      if (!job) {
        return fail('not_found', 'That job does not exist.', 404, {
          unitsSpent: meter.units,
          calls: meter.calls,
        })
      }

      // A job belongs to the session that created it.
      if (job.sessionId && job.sessionId !== sessionIdOf(session)) {
        return fail('forbidden', 'That job belongs to a different session.', 403, {
          unitsSpent: meter.units,
          calls: meter.calls,
        })
      }

      return ok(
        {
          job: {
            jobId: job.id,
            status: job.status,
            step: job.step,
            index: job.index,
            of: job.of,
            createdAt: job.createdAt,
            startedAt: job.startedAt,
            finishedAt: job.finishedAt,
            error: job.error,
            result: job.result,
            note: job.note,
            partialFailures: job.partialFailures,
            unitsSpent: job.unitsSpent,
            calls: job.calls,
          },
        },
        { unitsSpent: meter.units, calls: meter.calls },
      )
    },
    { scope: 'jobs:read', limit: 60 },
  )(request)
}
