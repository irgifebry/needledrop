import { logger } from '@/lib/observability/logger'
import { youtubeFetch, YouTubeError, type QuotaMeter } from '@/lib/youtube/client'
import { createPlaylist, type PlaylistProgress } from '@/lib/youtube/playlists'

import type {
  JobError,
  JobPartialFailure,
  JobProgress,
  JobRecord,
  JobResult,
  JobState,
  JobStep,
} from './types'

/**
 * The job runner (PLAN §13.6, §13.4).
 *
 * The happy path is delegated to `createPlaylist`, which owns the canonical
 * "create → insert → verify" sequence. What lives here is everything the
 * library function cannot do for us:
 *
 * - progress is forwarded to the store and to every SSE subscriber;
 * - a failed track is retried with exponential backoff and jitter;
 * - a playlist that only half filled up is **kept**, not thrown away;
 * - a cancelled job stops inserting but still reports what was created;
 * - repeated upstream failures trip a circuit breaker instead of burning the
 *   shared daily quota.
 */

const MAX_ATTEMPTS = 3
const BASE_BACKOFF_MS = 500
const JITTER_RATIO = 0.25
const MAX_DESCRIPTION = 5_000
const FAILURE_THRESHOLD = 5
const COOLDOWN_MS = 30_000

const RETRYABLE_CODES = new Set([
  'networkError',
  'timeout',
  'backendError',
  'internalError',
  'serviceUnavailable',
  'rateLimitExceeded',
])

/** Thrown to unwind `createPlaylist` when the user cancels the job. */
class JobCancelled extends Error {
  constructor() {
    super('cancelled')
    this.name = 'JobCancelled'
  }
}

export type WorkerDeps = {
  /** The access token captured when the job was enqueued. Never persisted. */
  accessToken: string | null
  /** Meter for the background run — separate from the HTTP request meter. */
  meter: QuotaMeter
  /** True once the user cancelled; the worker stops inserting new tracks. */
  isCancelled: () => boolean
  /** Called for every progress event so the store and the SSE stream update. */
  onProgress: (progress: { step: JobStep; index: number; of: number }) => void
  /** Injected clock, so the ETA and the breaker do not depend on the wall clock. */
  now?: () => number
}

export type JobOutcome = {
  status: 'succeeded' | 'failed' | 'cancelled'
  error?: JobError
  result?: JobResult
  note?: string
  partialFailures?: JobPartialFailure[]
}

export type BreakerState = {
  state: 'closed' | 'open' | 'half-open'
  failures: number
  openedAt: number | null
  cooldownUntil: number | null
}

const breaker = {
  failures: 0,
  openedAt: null as number | null,
}

/**
 * The state of the circuit breaker (PLAN §13.6).
 *
 * The breaker counts the upstream failures the worker can actually observe —
 * the ones `createPlaylist` could not paper over — so the app stops calling a
 * broken API for a while instead of burning the shared daily quota on 5xx.
 */
export function breakerState(now = Date.now()): BreakerState {
  if (breaker.openedAt === null) {
    return { state: 'closed', failures: breaker.failures, openedAt: null, cooldownUntil: null }
  }
  const cooldownUntil = breaker.openedAt + COOLDOWN_MS
  if (now >= cooldownUntil) {
    return { state: 'half-open', failures: breaker.failures, openedAt: breaker.openedAt, cooldownUntil }
  }
  return { state: 'open', failures: breaker.failures, openedAt: breaker.openedAt, cooldownUntil }
}

function recordFailure(now: number): void {
  breaker.failures += 1
  if (breaker.openedAt !== null) {
    // A half-open probe failed: start the cool-down over.
    if (now >= breaker.openedAt + COOLDOWN_MS) breaker.openedAt = now
    return
  }
  if (breaker.failures >= FAILURE_THRESHOLD) breaker.openedAt = now
}

function recordSuccess(): void {
  breaker.failures = 0
  breaker.openedAt = null
}

/**
 * A rough "how much longer" estimate, derived from the pace of the run so
 * far rather than from a magic constant.
 */
export function estimateEtaSec(index: number, of: number, startedAt: number, now = Date.now()): number {
  if (index <= 0 || of <= index) return 0
  const elapsedSec = Math.max(0, (now - startedAt) / 1000)
  const perItem = elapsedSec / index
  return Math.max(0, Math.ceil((of - index) * perItem))
}

/** The payload the SSE stream pushes on every state change. */
export function toProgress(state: JobState, now = Date.now()): JobProgress {
  return {
    jobId: state.id,
    status: state.status,
    step: state.step,
    index: state.index,
    of: state.of,
    etaSec: estimateEtaSec(state.index, state.of, state.startedAt ?? state.createdAt, now),
    error: state.error,
    result: state.result,
  }
}

/**
 * Runs one job to completion and reports what happened.
 *
 * It never throws: a failure is a value here, because the outcome has to be
 * written into the job state and pushed to the subscribers.
 */
export async function runJob(job: JobRecord, deps: WorkerDeps): Promise<JobOutcome> {
  const now = deps.now ?? Date.now
  const input = job.input
  const of = input.videoIds.length
  const token = deps.accessToken

  if (!token) {
    return {
      status: 'failed',
      error: {
        code: 'auth_expired',
        message: 'Your Google session expired before the playlist could be created. Sign in again and retry.',
      },
    }
  }

  const gate = breakerState(now())
  if (gate.state === 'open') {
    const waitSec = Math.max(1, Math.ceil(((gate.cooldownUntil ?? now()) - now()) / 1000))
    return {
      status: 'failed',
      error: {
        code: 'upstream_unavailable',
        message: `The YouTube API is failing repeatedly (${gate.failures} failures in a row). Try again in ${waitSec}s.`,
      },
    }
  }

  let created = false
  let inserted = 0

  try {
    const result = await createPlaylist(
      token,
      {
        videoIds: input.videoIds,
        title: input.title,
        description: withRunMarker(input.description ?? '', job.id),
        privacy: input.privacy,
      },
      deps.meter,
      (progress: PlaylistProgress) => {
        if (progress.step === 'creating') created = true
        if (progress.step === 'inserting') inserted = progress.index
        if (progress.step === 'verifying') inserted = progress.of
        // Cancelling unwinds the library loop, so the remaining tracks are
        // never inserted.
        if (deps.isCancelled()) throw new JobCancelled()
        deps.onProgress({ step: progress.step, index: progress.index, of: progress.of })
      },
    )

    recordSuccess()
    return {
      status: 'succeeded',
      result: {
        playlistId: result.playlistId,
        playlistUrl: result.playlistUrl,
        inserted: of,
        ordered: result.ordered,
      },
      note: result.note,
    }
  } catch (error) {
    if (error instanceof JobCancelled) {
      return finishCancelled(job, deps, token, { created, inserted })
    }
    return await recoverAndFinish(job, deps, token, error, { created, inserted })
  }
}

/**
 * The run failed. If the playlist itself exists, try to finish it instead of
 * throwing the user's work away (PLAN §13.4: "keep partial playlist").
 */
async function recoverAndFinish(
  job: JobRecord,
  deps: WorkerDeps,
  token: string,
  failure: unknown,
  progress: { created: boolean; inserted: number },
): Promise<JobOutcome> {
  const now = deps.now ?? Date.now
  const of = job.input.videoIds.length

  // A dead session or a missing permission will fail every remaining insert
  // too — do not burn quota on 50 doomed attempts.
  const fatal = fatalJobError(failure)
  if (fatal) {
    recordFailure(now())
    return { status: 'failed', error: fatal }
  }

  if (failure instanceof YouTubeError && (failure.code === 'quotaExceeded' || failure.code === 'dailyLimitExceeded')) {
    return { status: 'failed', error: { code: 'quota_exceeded', message: failure.message } }
  }

  if (!progress.created) {
    // `playlists.insert` itself failed, so there is nothing to keep.
    recordFailure(now())
    return { status: 'failed', error: toJobError(failure) }
  }

  const playlistId = await recoverPlaylistId(token, runMarker(job.id), deps.meter)
  if (!playlistId) {
    recordFailure(now())
    return {
      status: 'failed',
      error: toJobError(failure),
      note: 'The playlist was created on YouTube but could not be looked up again, so its link is unavailable here.',
    }
  }

  const partialFailures: JobPartialFailure[] = []
  let count = progress.inserted
  let position = count

  for (let index = progress.inserted; index < of; index++) {
    if (deps.isCancelled()) {
      return finishCancelled(job, deps, token, {
        created: true,
        inserted: count,
        playlistId,
      })
    }

    const videoId = job.input.videoIds[index]
    const outcome = await insertWithRetry({
      videoId,
      playlistId,
      position,
      token,
      meter: deps.meter,
      isCancelled: deps.isCancelled,
    })

    if (outcome.ok) {
      position += 1
      count += 1
      deps.onProgress({ step: 'inserting', index, of })
    } else {
      partialFailures.push({ videoId, index, reason: outcome.reason })
    }
  }

  let ordered: boolean
  try {
    const verified = await verifyPlaylist(playlistId, token, deps.meter)
    count = verified.count
    ordered = verified.ordered
  } catch {
    recordFailure(now())
    ordered = false
  }

  recordSuccess()

  const result: JobResult = {
    playlistId,
    playlistUrl: playlistUrlOf(playlistId),
    inserted: count,
    ordered,
  }

  if (partialFailures.length > 0) {
    return {
      status: 'succeeded',
      result,
      partialFailures,
      note: `${partialFailures.length} of ${of} tracks could not be added; the playlist was kept with the other ${count}.`,
    }
  }

  return {
    status: 'succeeded',
    result,
    note: ordered
      ? undefined
      : 'The final order could not be fully verified; the playlist was still created.',
  }
}

/**
 * A cancelled job keeps whatever was already created — the user asked to
 * stop, not to lose the playlist.
 */
async function finishCancelled(
  job: JobRecord,
  deps: WorkerDeps,
  token: string,
  progress: { created: boolean; inserted: number; playlistId?: string },
): Promise<JobOutcome> {
  let playlistId = progress.playlistId ?? null
  if (!playlistId && progress.created) {
    playlistId = await recoverPlaylistId(token, runMarker(job.id), deps.meter)
  }

  const result: JobResult | undefined = playlistId
    ? {
        playlistId,
        playlistUrl: playlistUrlOf(playlistId),
        inserted: progress.inserted,
        ordered: false,
      }
    : undefined

  return {
    status: 'cancelled',
    error: { code: 'cancelled', message: 'The job was cancelled.' },
    result,
    note: result ? `The playlist was kept with ${result.inserted} tracks.` : undefined,
  }
}

/**
 * Inserts one track, retrying transient upstream failures with exponential
 * backoff and jitter. Permanent failures (a private or deleted video) fail
 * immediately so one bad track cannot stall the whole playlist.
 */
async function insertWithRetry(args: {
  videoId: string
  playlistId: string
  position: number
  token: string
  meter: QuotaMeter
  isCancelled: () => boolean
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  let lastError: unknown = null

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await sleep(backoffMs(attempt - 1, retryAfterMsOf(lastError)), args.isCancelled)
      if (args.isCancelled()) return { ok: false, reason: 'Cancelled.' }
    }

    try {
      await youtubeFetch(
        'playlistItems.insert',
        { part: 'snippet' },
        args.meter,
        {
          method: 'POST',
          accessToken: args.token,
          body: JSON.stringify({
            snippet: {
              playlistId: args.playlistId,
              resourceId: { videoId: args.videoId, kind: 'youtube#video' },
              position: args.position,
            },
          }),
        },
      )
      return { ok: true }
    } catch (error) {
      lastError = error
      if (!isRetryable(error)) break
    }
  }

  return { ok: false, reason: errorMessage(lastError) }
}

/**
 * Finds the playlist a failed run created.
 *
 * The run marker in the description is the only reliable way back to it: the
 * library function does not hand the playlist id back when it throws.
 */
async function recoverPlaylistId(
  token: string,
  marker: string,
  meter: QuotaMeter,
): Promise<string | null> {
  try {
    const response = await youtubeFetch<PlaylistsListResponse>(
      'playlists.list',
      { mine: true, maxResults: 50, part: 'snippet' },
      meter,
      { accessToken: token },
    )

    for (const item of response.items ?? []) {
      if ((item.snippet?.description ?? '').includes(marker)) return item.id ?? null
    }
    return null
  } catch (error) {
    logger.warn('playlist recovery failed', { error })
    return null
  }
}

/** One cheap call to confirm what actually landed in the playlist. */
async function verifyPlaylist(
  playlistId: string,
  token: string,
  meter: QuotaMeter,
): Promise<{ count: number; ordered: boolean }> {
  const response = await youtubeFetch<PlaylistItemsResponse>(
    'playlistItems.list',
    { playlistId, maxResults: 50, part: 'snippet' },
    meter,
    { accessToken: token },
  )
  const positions = (response.items ?? [])
    .map((item) => item.snippet?.position ?? 0)
    .sort((a, b) => a - b)
  const ordered = positions.every((position, index) => position === index)
  return { count: positions.length, ordered }
}

/**
 * The run marker makes an app-generated playlist recognisable from the API
 * alone (PLAN §13.4) — and gives a failed run a way back to its playlist.
 */
function runMarker(jobId: string): string {
  return `<!--ytmg run=${jobId} v=2 -->`
}

/** Appends the run marker, leaving room for it inside the API's length cap. */
function withRunMarker(description: string, jobId: string): string {
  const marker = runMarker(jobId)
  const room = Math.max(0, MAX_DESCRIPTION - marker.length - 1)
  const text = description.trim()
  const trimmed = text.length > room ? text.slice(0, room) : text
  return trimmed ? `${trimmed}\n${marker}` : marker
}

function playlistUrlOf(playlistId: string): string {
  return `https://music.youtube.com/playlist?list=${playlistId}`
}

/** Exponential backoff with jitter, unless the upstream sent a `Retry-After`. */
function backoffMs(attempt: number, retryAfterMs: number | null): number {
  if (retryAfterMs && retryAfterMs > 0) return retryAfterMs
  const base = BASE_BACKOFF_MS * 2 ** attempt
  return Math.round(base + base * JITTER_RATIO * Math.random())
}

/** Waits, but gives up early when the job is cancelled meanwhile. */
async function sleep(ms: number, isCancelled: () => boolean): Promise<void> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (isCancelled()) return
    await new Promise((resolve) => setTimeout(resolve, Math.min(100, deadline - Date.now())))
  }
}

function retryAfterMsOf(error: unknown): number | null {
  if (error instanceof YouTubeError && typeof error.retryAfterMs === 'number' && error.retryAfterMs > 0) {
    return error.retryAfterMs
  }
  return null
}

function isRetryable(error: unknown): boolean {
  if (error instanceof TypeError) return true
  if (error instanceof YouTubeError) {
    if (error.status === 429 || error.status >= 500) return true
    return RETRYABLE_CODES.has(error.code)
  }
  return false
}

/** Errors that make every further insert pointless. */
function fatalJobError(error: unknown): JobError | null {
  if (error instanceof YouTubeError && error.status === 401) {
    return {
      code: 'auth_expired',
      message: 'Your Google session expired while the playlist was being created. Sign in again and retry.',
    }
  }
  if (error instanceof YouTubeError && error.status === 403) {
    return { code: 'forbidden', message: error.message }
  }
  return null
}

function toJobError(error: unknown): JobError {
  if (error instanceof YouTubeError) {
    if (error.status === 401) {
      return {
        code: 'auth_expired',
        message: 'Your Google session expired while the playlist was being created. Sign in again and retry.',
      }
    }
    if (error.status === 403) return { code: 'forbidden', message: error.message }
    if (error.status === 429 || error.code === 'quotaExceeded' || error.code === 'dailyLimitExceeded') {
      return { code: 'quota_exceeded', message: error.message }
    }
    return { code: 'upstream_error', message: error.message }
  }
  if (error instanceof TypeError) {
    return { code: 'network', message: 'The network request to the YouTube API failed. Check your connection and try again.' }
  }
  return {
    code: 'internal_error',
    message: error instanceof Error ? error.message : 'The playlist could not be created.',
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof YouTubeError) return error.message
  if (error instanceof Error) return error.message
  return 'The track could not be added to the playlist.'
}

type PlaylistItemsResponse = {
  items?: Array<{ id?: string; snippet?: { position?: number } }>
}

type PlaylistsListResponse = {
  items?: Array<{ id?: string; snippet?: { description?: string } }>
}
