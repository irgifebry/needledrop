import { env } from '@/lib/env'
import { AppError } from '@/lib/http/errors'
import { quotaTone } from '@/lib/quota'

/**
 * Quota ledger (PLAN §13.7).
 *
 * The project's daily quota is shared by every user, so it is the one number
 * that must never drift from reality. Every API call appends what it spent
 * here, which gives an exact "units spent" per run instead of an estimate.
 *
 * The ledger is deliberately in-process and bounded: the app must run with no
 * database at all. A deployment that needs cross-instance accounting can
 * replace this module without touching its callers.
 */

export type SpendEntry = {
  /** Data API operation, or a synthetic name for a batch of work. */
  operation: string
  /** Units charged. `0` for a call that was served from the cache. */
  units: number
  /** Generation run this spend belongs to. */
  runId?: string
  /** Browser session this spend belongs to. */
  sessionId?: string
  /** `true` when the call was answered from the cache. */
  cached?: boolean
  /** Epoch milliseconds. Defaults to now. */
  at: number
}

/** How many entries the ring buffer keeps. */
const MAX_ENTRIES = 1_000

const ledger: SpendEntry[] = []

/** Start of the current UTC day, in epoch milliseconds. */
function startOfUtcDay(at: number): number {
  const date = new Date(at)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

/**
 * Records what a call spent.
 *
 * Entries with `cached: true` carry zero units: they exist so the operator
 * view can show the cache hit rate, not to inflate the spend.
 */
export function recordSpend(entry: {
  operation: string
  units: number
  runId?: string
  sessionId?: string
  cached?: boolean
  at?: number
}): void {
  const units = Number.isFinite(entry.units) ? Math.max(0, Math.floor(entry.units)) : 0
  const at = Number.isFinite(entry.at) ? (entry.at as number) : Date.now()

  ledger.push({
    operation: entry.operation,
    units,
    runId: entry.runId,
    sessionId: entry.sessionId,
    cached: entry.cached,
    at,
  })

  // Ring buffer: the oldest entries fall off once the buffer is full.
  if (ledger.length > MAX_ENTRIES) {
    ledger.splice(0, ledger.length - MAX_ENTRIES)
  }
}

/** Units one session has spent since a point in time. */
export function spendForSession(sessionId: string, sinceMs: number): number {
  let total = 0
  for (const entry of ledger) {
    if (entry.sessionId === sessionId && entry.at >= sinceMs) total += entry.units
  }
  return total
}

/** Units one generation run has spent in total. */
export function spendForRun(runId: string): number {
  let total = 0
  for (const entry of ledger) {
    if (entry.runId === runId) total += entry.units
  }
  return total
}

/** Units spent since midnight UTC. */
export function spendToday(): number {
  const since = startOfUtcDay(Date.now())
  let total = 0
  for (const entry of ledger) {
    if (entry.at >= since) total += entry.units
  }
  return total
}

export type BudgetStatus = {
  /** Units this session spent today. */
  used: number
  /** Soft per-session daily budget. */
  sessionBudget: number
  /** Units the whole deployment spent today. */
  dailySpend: number
  /** Global ceiling we refuse to cross. */
  globalCap: number
  /** The project's hard daily quota. */
  dailyQuota: number
  /** The session is over its soft budget. */
  sessionExceeded: boolean
  /** The deployment is over the global ceiling. */
  globalExceeded: boolean
  /** UI tone for the banner. */
  tone: 'safe' | 'warn' | 'danger'
}

/**
 * Snapshot of every budget that matters, for `/api/quota` and the UI banner.
 *
 * The tone starts from the shared-project scale (`quotaTone`) and is
 * escalated when the session itself is close to (or over) its own budget,
 * because that is the limit the user can actually act on.
 */
export function budgetStatus(sessionId: string): BudgetStatus {
  const value = env()
  const sessionBudget = value.SESSION_DAILY_BUDGET
  const globalCap = value.GLOBAL_DAILY_CAP
  const dailyQuota = value.DAILY_QUOTA

  const used = spendForSession(sessionId, startOfUtcDay(Date.now()))
  const dailySpend = spendToday()

  const sessionExceeded = used >= sessionBudget
  const globalExceeded = dailySpend >= globalCap

  const base = quotaTone(dailySpend)
  const tone: BudgetStatus['tone'] = globalExceeded
    ? 'danger'
    : sessionExceeded
      ? (base === 'safe' ? 'warn' : base)
      : base

  return {
    used,
    sessionBudget,
    dailySpend,
    globalCap,
    dailyQuota,
    sessionExceeded,
    globalExceeded,
    tone,
  }
}

/**
 * Stops a request that would blow a budget.
 *
 * The message always says what the user can do next — the shared project key
 * is finite, so "wait" and "add your own key" are the only two options, and
 * both are now real: the quota resets at midnight Pacific Time, and a
 * visitor can paste their own key next to the search box.
 */
export function assertWithinBudget(sessionId: string): void {
  const status = budgetStatus(sessionId)

  if (status.globalExceeded) {
    throw new AppError(
      'quota_exceeded',
      `The shared daily API quota is used up (${status.dailySpend} of ${status.globalCap} units today). It resets at midnight Pacific Time, or add your own YouTube API key to keep going now.`,
      429,
      status,
    )
  }

  if (status.sessionExceeded) {
    throw new AppError(
      'quota_exceeded',
      `This session used ${status.used} of ${status.sessionBudget} daily units. It resets at midnight Pacific Time, or add your own YouTube API key to keep going now.`,
      429,
      status,
    )
  }
}

/**
 * The tail of the ledger, oldest first.
 *
 * Used by the operator view: the most recent calls, in the order they
 * happened.
 */
export function recentSpend(limit = 50): SpendEntry[] {
  const size = Math.max(0, Math.floor(limit))
  if (size === 0) return []
  return ledger.slice(-size).map((entry) => ({ ...entry }))
}

/** Test seam — empties the ledger. */
export function resetLedger(): void {
  ledger.length = 0
}
