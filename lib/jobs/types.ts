import type { ErrorCode } from '@/lib/http/errors'

/**
 * The job contract (PLAN §13.6).
 *
 * Creating a 50-track playlist is 51 sequential HTTP calls — far too slow
 * for one request. The POST therefore hands back a job id immediately and the
 * work happens in the background while the client watches an SSE stream.
 *
 * These types are the seam between the in-process runner and whatever durable
 * runner replaces it later (Inngest, Trigger.dev, …). Nothing in this file
 * touches a runtime API, so the same shapes work for a Redis- or
 * Postgres-backed store.
 */

/** Lifecycle of a playlist-creation job. */
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

/** The stage the worker is in — finer-grained than the status. */
export type JobStep = 'creating' | 'inserting' | 'verifying' | 'done'

/**
 * Error codes for job failures.
 *
 * `ErrorCode` covers everything the HTTP layer already knows. `interrupted`
 * and `cancelled` are job-only outcomes with no HTTP equivalent: a job that
 * was killed by a server restart, and a job the user stopped on purpose.
 */
export type JobErrorCode = ErrorCode | 'interrupted' | 'cancelled'

export type JobError = {
  code: JobErrorCode
  message: string
}

/** What the user ends up with when a run succeeds. */
export type JobResult = {
  playlistId: string
  playlistUrl: string
  /** How many tracks actually made it into the playlist. */
  inserted: number
  /** Whether the final order was verified against the API. */
  ordered: boolean
}

/** A track that could not be added; the rest of the playlist was kept. */
export type JobPartialFailure = {
  videoId: string
  index: number
  reason: string
}

/** The full, serialisable state of one job. */
export type JobState = {
  id: string
  status: JobStatus
  step: JobStep
  /** How far the run got (0-based index of the current track). */
  index: number
  /** How many tracks the job has to insert. */
  of: number
  createdAt: number
  startedAt?: number
  finishedAt?: number
  error?: JobError
  result?: JobResult
  /** The scoped key used for idempotency; a hash, never the raw request. */
  idempotencyKey?: string
  /** Owning session — a hash, so a job cannot be read by another browser. */
  sessionId?: string
  userEmail?: string
  /** Human-readable caveat, e.g. "3 tracks could not be added". */
  note?: string
  partialFailures?: JobPartialFailure[]
  /** Quota the background run actually spent. */
  unitsSpent?: number
  calls?: number
}

/** The payload pushed over SSE on every state change. */
export type JobProgress = {
  jobId: string
  status: JobStatus
  step: JobStep
  index: number
  of: number
  etaSec: number
  error?: JobError
  result?: JobResult
}

/** The body of `POST /api/jobs`. */
export type CreateJobInput = {
  videoIds: string[]
  title: string
  description?: string
  privacy: 'private' | 'unlisted' | 'public'
  /** Optional client key so a double-click cannot create two playlists. */
  idempotencyKey?: string
}

/** Notified on every state change of one job. */
export type JobListener = (state: JobState) => void

/**
 * The storage seam.
 *
 * A durable backend only has to satisfy this interface; the queue and the
 * worker never touch a concrete store. `delete` exists so the queue can
 * evict old terminal jobs and keep memory bounded.
 */
export interface JobStore {
  get(id: string): JobState | null
  set(id: string, state: JobState): void
  list(): JobState[]
  subscribe(id: string, listener: JobListener): void
  unsubscribe(id: string, listener: JobListener): void
  delete(id: string): void
}

/** A job plus the input it was created from. */
export type JobRecord = {
  id: string
  input: CreateJobInput
  state: JobState
}

/**
 * Terminal jobs can no longer change. The SSE stream closes as soon as a job
 * reaches one of these.
 */
export function isTerminal(status: JobStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled'
}

/**
 * A job is *settled* when the worker is done with it.
 *
 * Cancelling a running job marks it cancelled immediately, so the UI can
 * react at once, but the insert that is in flight still finishes and the
 * partial playlist is only known afterwards. The stream therefore waits for
 * the job to settle before it closes.
 */
export function isSettled(state: JobState): boolean {
  return isTerminal(state.status) && state.finishedAt !== undefined
}
