'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import type {
  CreateJobInput,
  JobError,
  JobProgress,
  JobResult,
  JobStatus,
} from '@/lib/jobs/types'

/**
 * Client-side driver for the async playlist-creation job.
 *
 * It posts to `/api/jobs`, then follows the SSE stream on
 * `/api/jobs/:id/stream`, closing the `EventSource` the moment the job
 * settles so the browser does not reconnect forever. If the stream never
 * connects (or drops), it falls back to polling `GET /api/jobs/:id`.
 *
 * The hook is deliberately stateful but side-effect free on unmount: it
 * tears down timers and sockets in its cleanup.
 */
export type JobSnapshot = {
  jobId: string
  status: JobStatus
  step: JobProgress['step']
  index: number
  of: number
  createdAt: number
  startedAt?: number
  finishedAt?: number
  error?: JobError
  result?: JobResult
  note?: string
  unitsSpent?: number
  calls?: number
}

export function useJob() {
  const [jobId, setJobId] = useState<string | null>(null)
  const [status, setStatus] = useState<JobStatus | null>(null)
  const [progress, setProgress] = useState<JobProgress | null>(null)
  const [result, setResult] = useState<JobResult | null>(null)
  const [error, setError] = useState<JobError | null>(null)
  const [note, setNote] = useState<string | undefined>(undefined)
  const [unitsSpent, setUnitsSpent] = useState<number | undefined>(undefined)
  const [calls, setCalls] = useState<number | undefined>(undefined)

  const esRef = useRef<EventSource | null>(null)
  const pollRef = useRef<number | null>(null)

  const cleanup = useCallback(() => {
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const applySnapshot = useCallback((job: JobSnapshot) => {
    setStatus(job.status)
    setProgress({
      jobId: job.jobId,
      status: job.status,
      step: job.step,
      index: job.index,
      of: job.of,
      etaSec: 0,
      error: job.error,
      result: job.result,
    })
    if (job.result) setResult(job.result)
    if (job.error) setError(job.error)
    setNote(job.note)
    setUnitsSpent(job.unitsSpent)
    setCalls(job.calls)
  }, [])

  const pollOnce = useCallback(
    async (id: string) => {
      const response = await fetch(`/api/jobs/${id}`)
      if (!response.ok) throw new Error('poll failed')
      const payload = (await response.json()) as { job: JobSnapshot }
      applySnapshot(payload.job)
      if (payload.job.status === 'succeeded' || payload.job.status === 'failed' || payload.job.status === 'cancelled') {
        cleanup()
      }
      return payload.job
    },
    [applySnapshot, cleanup],
  )

  const startPolling = useCallback(
    (id: string) => {
      if (pollRef.current !== null) return
      pollRef.current = window.setInterval(() => {
        void pollOnce(id).catch(() => undefined)
      }, 2000)
      void pollOnce(id).catch(() => undefined)
    },
    [pollOnce],
  )

  const subscribe = useCallback(
    (id: string) => {
      cleanup()
      setJobId(id)
      try {
        const es = new EventSource(`/api/jobs/${id}/stream`)
        esRef.current = es
        const handle = (event: MessageEvent) => {
          try {
            const p = JSON.parse(event.data) as JobProgress
            setStatus(p.status)
            setProgress(p)
            if (p.result) setResult(p.result)
            if (p.error) setError(p.error)
            if (p.status === 'succeeded' || p.status === 'failed' || p.status === 'cancelled') {
              cleanup()
              void pollOnce(id).catch(() => undefined)
            }
          } catch {
            // Ignore malformed payloads; the polling fallback covers them.
          }
        }
        es.addEventListener('progress', handle as EventListener)
        es.addEventListener('done', handle as EventListener)
        es.addEventListener('error', (event) => {
          const me = event as MessageEvent
          if (me.data) {
            handle(me)
            return
          }
          es.close()
          esRef.current = null
          startPolling(id)
        })
      } catch {
        startPolling(id)
      }
    },
    [cleanup, pollOnce, startPolling],
  )

  const start = useCallback(
    async (input: CreateJobInput & { idempotencyKey?: string }) => {
      cleanup()
      setJobId(null)
      setStatus('queued')
      setProgress(null)
      setResult(null)
      setError(null)
      setNote(undefined)
      setUnitsSpent(undefined)
      setCalls(undefined)

      const response = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>

      if (response.status === 503) {
        return { disabled: true as const, payload }
      }
      if (payload.demo === true) {
        return { demo: true as const, payload }
      }
      if (!response.ok) {
        throw new Error(
          typeof payload.message === 'string' ? payload.message : 'The job could not be queued.',
        )
      }

      const id = payload.jobId as string
      subscribe(id)
      return { jobId: id, payload }
    },
    [cleanup, subscribe],
  )

  const reset = useCallback(() => {
    cleanup()
    setJobId(null)
    setStatus(null)
    setProgress(null)
    setResult(null)
    setError(null)
    setNote(undefined)
    setUnitsSpent(undefined)
    setCalls(undefined)
  }, [cleanup])

  useEffect(() => () => cleanup(), [cleanup])

  const isRunning = status === 'queued' || status === 'running'

  return {
    jobId,
    status,
    progress,
    result,
    error,
    note,
    unitsSpent,
    calls,
    isRunning,
    start,
    reset,
    cleanup,
  }
}