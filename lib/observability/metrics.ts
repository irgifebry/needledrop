/**
 * In-process metrics (PLAN §20).
 *
 * The funnel the plan cares about:
 *   search issued → seed resolved → discovery completed →
 *   at least one track added → playlist created → playlist opened
 *
 * Plus the guardrails: units/day, error rate by operation, job failure rate,
 * % of runs served from cache, % of playlists containing a region-blocked
 * track.
 *
 * These are counters, not a time-series database. They exist so the operator
 * view can answer "is anything on fire?" without a metrics backend; if one
 * is ever added, these become the exporter's source.
 */

export type MetricName =
  | 'searchIssued'
  | 'seedResolved'
  | 'discoveryCompleted'
  | 'trackAdded'
  | 'playlistCreated'
  | 'playlistOpened'
  | 'exportRendered'
  | 'apiRequest'
  | 'apiError'
  | 'cacheHit'
  | 'cacheMiss'
  | 'jobCreated'
  | 'jobFailed'
  | 'quotaRejected'

const counters = new Map<MetricName, number>()
const durations = new Map<string, { total: number; count: number; max: number }>()

export function increment(name: MetricName, by = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + by)
}

export function observeDuration(name: string, durationMs: number): void {
  const entry = durations.get(name) ?? { total: 0, count: 0, max: 0 }
  entry.total += durationMs
  entry.count += 1
  entry.max = Math.max(entry.max, durationMs)
  durations.set(name, entry)
}

export function countOf(name: MetricName): number {
  return counters.get(name) ?? 0
}

export type MetricSnapshot = {
  counters: Record<string, number>
  durations: Record<string, { avgMs: number; maxMs: number; count: number }>
  errorRate: number
  cacheHitRate: number
}

/** A point-in-time snapshot for `/api/health` and the operator dashboard. */
export function snapshot(): MetricSnapshot {
  const requests = countOf('apiRequest')
  const errors = countOf('apiError')
  const hits = countOf('cacheHit')
  const misses = countOf('cacheMiss')

  const durationSnapshot: MetricSnapshot['durations'] = {}
  for (const [name, entry] of durations) {
    durationSnapshot[name] = {
      avgMs: entry.count === 0 ? 0 : Math.round(entry.total / entry.count),
      maxMs: entry.max,
      count: entry.count,
    }
  }

  const counterSnapshot: Record<string, number> = {}
  for (const [name, value] of counters) counterSnapshot[name] = value

  return {
    counters: counterSnapshot,
    durations: durationSnapshot,
    errorRate: requests === 0 ? 0 : Number((errors / requests).toFixed(4)),
    cacheHitRate: hits + misses === 0 ? 0 : Number((hits / (hits + misses)).toFixed(4)),
  }
}

/** Test/dev helper — clears every counter. */
export function resetMetrics(): void {
  counters.clear()
  durations.clear()
}
