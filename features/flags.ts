import { env } from '@/lib/env'

/**
 * Feature flags (PLAN §13.10).
 *
 * The engine can be flipped without a redeploy so v2 can ship dark and be
 * compared against v1 on real seeds before it takes over.
 */

export type EngineVersion = 'v1' | 'v2'

export const ENGINE_VERSIONS: EngineVersion[] = ['v1', 'v2']

export function engineVersion(): EngineVersion {
  return env().ENGINE_VERSION
}

export function discoveryDepth(): 1 | 2 {
  return env().DISCOVERY_DEPTH === 1 ? 1 : 2
}

export function cacheEnabled(): boolean {
  return env().CACHE_ENABLED === 'true'
}

export function jobsEnabled(): boolean {
  return env().JOBS_ENABLED === 'true'
}

export function persistenceEnabled(): boolean {
  return env().PERSISTENCE_ENABLED === 'true'
}

/** Snapshot for `/api/health` and the operator dashboard. */
export function flagSnapshot(): Record<string, string | number | boolean> {
  return {
    ENGINE_VERSION: engineVersion(),
    DISCOVERY_DEPTH: discoveryDepth(),
    CACHE_ENABLED: cacheEnabled(),
    JOBS_ENABLED: jobsEnabled(),
    PERSISTENCE_ENABLED: persistenceEnabled(),
  }
}
