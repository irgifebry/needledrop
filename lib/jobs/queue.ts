import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { logger } from '@/lib/observability/logger'
import { createMeter } from '@/lib/youtube/client'

import { remember } from './idempotency'
import {
  isTerminal,
  type CreateJobInput,
  type JobListener,
  type JobRecord,
  type JobState,
  type JobStatus,
  type JobStore,
} from './types'
import { runJob, type JobOutcome } from './worker'

/**
 * The in-process job queue (PLAN §13.6).
 *
 * This is the seam where a durable runner (Inngest, Trigger.dev, …) would be
 * plugged in later. It keeps the same three responsibilities a durable
 * runner has: hold the jobs, run them off the request path, and let callers
 * watch them.
 *
 * Everything lives in memory, so a restart loses the *work* — but not
 * silently: on boot every job that was still queued or running is restored
 * from a small snapshot and marked `failed` with the code `interrupted`, so
 * the user is told to retry instead of watching a progress bar that never
 * moves.
 */

const MAX_JOBS = 500
const SNAPSHOT_FILE = join(tmpdir(), 'needledrop-jobs.json')
const SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000
const SNAPSHOT_DEBOUNCE_MS = 500
const GLOBAL_KEY = '__needledrop_jobs__'

type JobRuntime = {
  store: MemoryJobStore
  /** The input of every job that has not been evicted yet. */
  records: Map<string, JobRecord>
  /** Access tokens, held in memory only — never written to disk, never logged. */
  tokens: Map<string, string>
  worker: {
    running: boolean
    timer: ReturnType<typeof setTimeout> | null
    snapshotTimer: ReturnType<typeof setTimeout> | null
  }
}

type GlobalWithJobs = typeof globalThis & {
  [GLOBAL_KEY]?: JobRuntime
}

/**
 * The default store: an in-memory map with per-job listener sets.
 *
 * The interface it implements (`JobStore`) is all the queue needs, so a
 * Redis- or Postgres-backed store can replace it without touching the
 * worker.
 */
class MemoryJobStore implements JobStore {
  private readonly states = new Map<string, JobState>()
  private readonly listeners = new Map<string, Set<JobListener>>()

  get(id: string): JobState | null {
    return this.states.get(id) ?? null
  }

  set(id: string, state: JobState): void {
    this.states.set(id, state)
    const listeners = this.listeners.get(id)
    if (!listeners) return
    for (const listener of [...listeners]) {
      try {
        listener(state)
      } catch (error) {
        // A broken subscriber must never take the worker down with it.
        logger.warn('job listener failed', { jobId: id, error })
      }
    }
  }

  list(): JobState[] {
    return [...this.states.values()]
  }

  subscribe(id: string, listener: JobListener): void {
    const listeners = this.listeners.get(id) ?? new Set<JobListener>()
    listeners.add(listener)
    this.listeners.set(id, listeners)
  }

  unsubscribe(id: string, listener: JobListener): void {
    const listeners = this.listeners.get(id)
    if (!listeners) return
    listeners.delete(listener)
    if (listeners.size === 0) this.listeners.delete(id)
  }

  delete(id: string): void {
    this.states.delete(id)
    this.listeners.delete(id)
  }
}

/**
 * A stable id for the browser session that owns a job.
 *
 * The refresh token is part of the hash because the access token rotates on
 * every refresh — hashing it would orphan the user's jobs after an hour.
 */
export function sessionIdOf(session: { email: string; refreshToken: string }): string {
  return createHash('sha256')
    .update(`${session.email}:${session.refreshToken}`)
    .digest('hex')
    .slice(0, 24)
}

export type EnqueueContext = {
  /** OAuth access token. Kept in memory only, for the lifetime of the job. */
  accessToken: string
  /** Id of the session that owns the job. */
  sessionId: string
  userEmail?: string
}

export type JobFilter = {
  status?: JobStatus
  sessionId?: string
  limit?: number
}

/**
 * Creates a job and schedules the worker.
 *
 * It returns immediately: the whole point of the async layer is that the
 * HTTP request never waits for the 51 upstream calls a playlist needs.
 */
export function enqueue(input: CreateJobInput, context: EnqueueContext): JobState {
  const runtime = getRuntime()
  const id = `job_${randomUUID()}`
  const state: JobState = {
    id,
    status: 'queued',
    step: 'creating',
    index: 0,
    of: input.videoIds.length,
    createdAt: Date.now(),
    idempotencyKey: input.idempotencyKey,
    sessionId: context.sessionId,
    userEmail: context.userEmail,
  }

  runtime.records.set(id, { id, input, state })
  runtime.tokens.set(id, context.accessToken)
  runtime.store.set(id, state)

  evictIfNeeded(runtime)
  scheduleSnapshot(runtime)
  startWorker()
  return state
}

/** The current snapshot of a job, or `null` when it is unknown. */
export function getJob(id: string): JobState | null {
  return getRuntime().store.get(id)
}

/** The jobs of this process, newest first. */
export function listJobs(filter: JobFilter = {}): JobState[] {
  const states = getRuntime()
    .store.list()
    .filter((state) => (filter.status ? state.status === filter.status : true))
    .filter((state) => (filter.sessionId ? state.sessionId === filter.sessionId : true))
    .sort((a, b) => b.createdAt - a.createdAt)

  return filter.limit ? states.slice(0, filter.limit) : states
}

/**
 * Cancels a job.
 *
 * The insert that is in flight finishes; the rest are skipped. The playlist
 * that was already created is kept and reported, because cancelling is not
 * the same as "throw the work away".
 */
export function cancelJob(id: string): JobState | null {
  const runtime = getRuntime()
  const current = runtime.store.get(id)
  if (!current) return null
  if (isTerminal(current.status)) return current

  // A queued job has nothing left to do, so it is settled right away. A
  // running job still has an insert in flight: it is marked cancelled so the
  // UI reacts at once, but it only settles once the worker is done with it.
  const running = current.status === 'running'

  const next: JobState = {
    ...current,
    status: 'cancelled',
    finishedAt: running ? undefined : Date.now(),
    error: { code: 'cancelled', message: 'The job was cancelled.' },
    note: running ? 'Cancelling — the insert that is in flight finishes first.' : current.note,
  }
  runtime.store.set(id, next)
  scheduleSnapshot(runtime)
  return next
}

/** Subscribes to every state change of one job. Returns the unsubscribe fn. */
export function subscribe(id: string, listener: JobListener): () => void {
  const runtime = getRuntime()
  runtime.store.subscribe(id, listener)
  return () => runtime.store.unsubscribe(id, listener)
}

/** Removes a subscriber again. */
export function unsubscribe(id: string, listener: JobListener): void {
  getRuntime().store.unsubscribe(id, listener)
}

/**
 * Starts the worker.
 *
 * It is called lazily on the first enqueue, and the timers it creates are
 * unreferenced so a quiet process can still exit.
 */
export function startWorker(): void {
  const runtime = getRuntime()
  if (runtime.worker.running) return
  runtime.worker.running = true
  scheduleTick(runtime, 0)
}

/** Stops picking up new jobs. A job that is already running finishes. */
export function stopWorker(): void {
  const runtime = getRuntime()
  runtime.worker.running = false
  if (runtime.worker.timer) {
    clearTimeout(runtime.worker.timer)
    runtime.worker.timer = null
  }
}

async function tick(runtime: JobRuntime): Promise<void> {
  if (!runtime.worker.running) return

  const next = nextQueued(runtime)
  if (!next) return

  try {
    await execute(runtime, next)
  } catch (error) {
    logger.error('job crashed', { jobId: next.id, error })
    failJob(runtime, next.id)
  }

  scheduleTick(runtime, 0)
}

/** The oldest job that is still waiting. */
function nextQueued(runtime: JobRuntime): JobRecord | null {
  let next: JobRecord | null = null
  for (const record of runtime.records.values()) {
    const state = runtime.store.get(record.id)
    if (!state || state.status !== 'queued') continue
    if (!next || state.createdAt < next.state.createdAt) next = record
  }
  return next
}

async function execute(runtime: JobRuntime, record: JobRecord): Promise<void> {
  const meter = createMeter()
  const token = runtime.tokens.get(record.id) ?? null

  updateState(runtime, record.id, {
    status: 'running',
    startedAt: Date.now(),
    step: 'creating',
    index: 0,
  })

  const outcome = await runJob(record, {
    accessToken: token,
    meter,
    isCancelled: () => runtime.store.get(record.id)?.status === 'cancelled',
    onProgress: (progress) => updateState(runtime, record.id, progress),
  })

  applyOutcome(runtime, record.id, outcome, meter)
}

function updateState(runtime: JobRuntime, id: string, patch: Partial<JobState>): void {
  const current = runtime.store.get(id)
  if (!current) return
  runtime.store.set(id, { ...current, ...patch })
}

function applyOutcome(
  runtime: JobRuntime,
  id: string,
  outcome: JobOutcome,
  meter: ReturnType<typeof createMeter>,
): void {
  const current = runtime.store.get(id)
  if (!current) return

  const next: JobState = {
    ...current,
    status: outcome.status,
    step: outcome.status === 'succeeded' ? 'done' : current.step,
    finishedAt: Date.now(),
    // The outcome is authoritative: a run that finished after a cancel
    // really did succeed, and must not keep the cancellation as its error.
    error: outcome.error,
    result: outcome.result,
    note: outcome.note,
    partialFailures: outcome.partialFailures,
    unitsSpent: meter.units,
    calls: meter.calls,
  }

  runtime.store.set(id, next)
  // The token has done its job; do not keep it around.
  runtime.tokens.delete(id)
  evictIfNeeded(runtime)
  scheduleSnapshot(runtime)

  logger.info('job finished', {
    jobId: id,
    status: next.status,
    units: meter.units,
    calls: meter.calls,
  })
}

function failJob(runtime: JobRuntime, id: string): void {
  const current = runtime.store.get(id)
  if (!current || isTerminal(current.status)) return

  runtime.store.set(id, {
    ...current,
    status: 'failed',
    finishedAt: Date.now(),
    error: { code: 'internal_error', message: 'The job failed unexpectedly.' },
  })
  runtime.tokens.delete(id)
  scheduleSnapshot(runtime)
}

/** Keeps the map bounded by dropping the oldest finished jobs first. */
function evictIfNeeded(runtime: JobRuntime): void {
  const states = runtime.store.list()
  if (states.length <= MAX_JOBS) return

  const evictable = states
    .filter((state) => isTerminal(state.status))
    .sort((a, b) => a.createdAt - b.createdAt)

  let excess = states.length - MAX_JOBS
  for (const state of evictable) {
    if (excess <= 0) break
    runtime.store.delete(state.id)
    runtime.records.delete(state.id)
    runtime.tokens.delete(state.id)
    excess -= 1
  }
}

function scheduleTick(runtime: JobRuntime, delay: number): void {
  if (!runtime.worker.running || runtime.worker.timer) return

  const timer = setTimeout(() => {
    runtime.worker.timer = null
    void tick(runtime)
  }, delay)
  unrefTimer(timer)
  runtime.worker.timer = timer
}

function scheduleSnapshot(runtime: JobRuntime): void {
  if (runtime.worker.snapshotTimer) return

  const timer = setTimeout(() => {
    runtime.worker.snapshotTimer = null
    void writeSnapshot(runtime)
  }, SNAPSHOT_DEBOUNCE_MS)
  unrefTimer(timer)
  runtime.worker.snapshotTimer = timer
}

type JobSnapshot = {
  savedAt: number
  jobs: JobState[]
}

/**
 * Writes a small snapshot of the job states to disk.
 *
 * It is best effort: the file lives in the temp directory, it never contains
 * an access token, and a failure to write it is not worth an error.
 */
async function writeSnapshot(runtime: JobRuntime): Promise<void> {
  try {
    const jobs = runtime.store.list().map((state) => ({
      ...state,
      // The e-mail is personal data and has no business in a temp file.
      userEmail: undefined,
    }))
    const payload: JobSnapshot = { savedAt: Date.now(), jobs }
    await writeFile(SNAPSHOT_FILE, JSON.stringify(payload), 'utf8')
  } catch (error) {
    logger.debug('job snapshot not written', { error })
  }
}

/**
 * Restores the snapshot and marks anything that was still in flight as
 * failed.
 *
 * A job that was running when the process died can never be resumed — the
 * access token is gone with the process — so it is reported honestly as
 * `interrupted` instead of hanging in `running` forever.
 */
function restoreSnapshot(runtime: JobRuntime): void {
  let payload: JobSnapshot
  try {
    payload = JSON.parse(readFileSync(SNAPSHOT_FILE, 'utf8')) as JobSnapshot
  } catch {
    return
  }

  if (!payload || !Array.isArray(payload.jobs)) return
  if (Date.now() - payload.savedAt > SNAPSHOT_MAX_AGE_MS) return

  let restored = 0
  for (const state of payload.jobs) {
    if (!state || typeof state.id !== 'string') continue

    const recovered: JobState = isTerminal(state.status)
      ? state
      : {
          ...state,
          status: 'failed',
          finishedAt: Date.now(),
          error: {
            code: 'interrupted',
            message: 'The server restarted while this job was running. Start it again.',
          },
        }

    runtime.store.set(recovered.id, recovered)
    if (recovered.idempotencyKey) remember(recovered.idempotencyKey, recovered.id)
    restored += 1
  }

  if (restored > 0) logger.info('restored jobs from snapshot', { restored })
}

function getRuntime(): JobRuntime {
  const scope = globalThis as GlobalWithJobs
  const existing = scope[GLOBAL_KEY]
  if (existing) return existing

  const runtime: JobRuntime = {
    store: new MemoryJobStore(),
    records: new Map(),
    tokens: new Map(),
    worker: { running: false, timer: null, snapshotTimer: null },
  }
  scope[GLOBAL_KEY] = runtime
  restoreSnapshot(runtime)
  return runtime
}

/** Keeps an unreferenced timer from holding the process open. */
export function unrefTimer(timer: unknown): void {
  if (typeof timer !== 'object' || timer === null) return
  const candidate = timer as { unref?: () => void }
  candidate.unref?.()
}
