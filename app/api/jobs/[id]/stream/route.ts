import { NextResponse } from 'next/server'

import { withRoute } from '@/lib/http/handler'
import { fail } from '@/lib/http/respond'
import { requireSession } from '@/lib/http/session'
import { getJob, sessionIdOf, subscribe, unrefTimer } from '@/lib/jobs/queue'
import { isSettled, type JobState } from '@/lib/jobs/types'
import { toProgress } from '@/lib/jobs/worker'

/** A comment every 15 s keeps proxies from closing an idle stream. */
const HEARTBEAT_MS = 15_000

/**
 * `GET /api/jobs/:id/stream` — live progress for one job (SSE).
 *
 * The stream opens with the current state, so a subscriber that arrives late
 * is never left in the dark, then pushes one event per state change and
 * closes as soon as the job reaches a terminal state.
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

      if (job.sessionId && job.sessionId !== sessionIdOf(session)) {
        return fail('forbidden', 'That job belongs to a different session.', 403, {
          unitsSpent: meter.units,
          calls: meter.calls,
        })
      }

      return new NextResponse(createJobStream(id, request.signal), {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          // Tell nginx (and friends) not to buffer the stream.
          'X-Accel-Buffering': 'no',
        },
      })
    },
    { scope: 'jobs:read', limit: 120 },
  )(request)
}

/**
 * The event stream for one job.
 *
 * `progress` carries every state change; `done` and `error` close the
 * stream. A client using the browser `EventSource` has to close it itself
 * once it sees `done` or `error`, otherwise the browser reconnects.
 */
export function createJobStream(id: string, signal: AbortSignal): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      let heartbeat: ReturnType<typeof setInterval> | null = null
      let unsubscribe: () => void = () => {}

      const send = (chunk: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          closed = true
        }
      }

      const close = () => {
        if (closed) return
        closed = true
        if (heartbeat) {
          clearInterval(heartbeat)
          heartbeat = null
        }
        unsubscribe()
        try {
          controller.close()
        } catch {
          // The runtime already closed the stream.
        }
      }

      const emit = (event: string, state: JobState) => {
        send(`event: ${event}\ndata: ${JSON.stringify(toProgress(state))}\n\n`)
      }

      unsubscribe = subscribe(id, (state) => {
        emit('progress', state)
        if (!isSettled(state)) return
        emit(state.status === 'failed' ? 'error' : 'done', state)
        close()
      })

      heartbeat = setInterval(() => send(': ping\n\n'), HEARTBEAT_MS)
      unrefTimer(heartbeat)

      // The client went away — stop pushing and free the subscription.
      signal.addEventListener('abort', close, { once: true })

      const current = getJob(id)
      if (current) {
        emit('progress', current)
        if (isSettled(current)) {
          emit(current.status === 'failed' ? 'error' : 'done', current)
          close()
        }
      }
    },
  })
}
