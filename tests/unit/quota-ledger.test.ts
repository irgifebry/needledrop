import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AppError, isAppError } from '@/lib/http/errors'
import {
  assertWithinBudget,
  budgetStatus,
  recentSpend,
  recordSpend,
  resetLedger,
  spendForRun,
  spendForSession,
  spendToday,
} from '@/lib/quota-ledger'

/**
 * Noon UTC today — inside the current UTC day whatever time the suite runs,
 * so the "today" figures never depend on the wall clock around midnight.
 */
function noonUtcToday(): number {
  const date = new Date()
  date.setUTCHours(12, 0, 0, 0)
  return date.getTime()
}

describe('recordSpend', () => {
  beforeEach(() => {
    resetLedger()
  })

  it('adds up what a session spent', () => {
    recordSpend({ operation: 'search.list', units: 100, sessionId: 's1', at: 1_000 })
    recordSpend({ operation: 'videos.list', units: 1, sessionId: 's1', at: 2_000 })

    expect(spendForSession('s1', 0)).toBe(101)
  })

  it('keeps two sessions apart', () => {
    recordSpend({ operation: 'search.list', units: 100, sessionId: 's1', at: 1_000 })
    recordSpend({ operation: 'search.list', units: 100, sessionId: 's2', at: 2_000 })

    expect(spendForSession('s1', 0)).toBe(100)
    expect(spendForSession('s2', 0)).toBe(100)
  })

  it('ignores what a session spent before the given moment', () => {
    recordSpend({ operation: 'search.list', units: 100, sessionId: 's1', at: 1_000 })
    recordSpend({ operation: 'search.list', units: 50, sessionId: 's1', at: 5_000 })

    expect(spendForSession('s1', 2_000)).toBe(50)
  })

  it('adds up what a run spent', () => {
    recordSpend({ operation: 'search.list', units: 100, runId: 'r1', at: 1_000 })
    recordSpend({ operation: 'playlistItems.insert', units: 50, runId: 'r1', at: 2_000 })

    expect(spendForRun('r1')).toBe(150)
  })

  it('counts what was spent today', () => {
    recordSpend({ operation: 'search.list', units: 100, at: noonUtcToday() })

    expect(spendToday()).toBe(100)
  })

  it('charges nothing for a call that was answered from the cache', () => {
    recordSpend({ operation: 'videos.list', units: 0, cached: true, at: noonUtcToday() })

    expect(spendToday()).toBe(0)
  })

  it('never records a negative or fractional spend', () => {
    recordSpend({ operation: 'videos.list', units: -10, sessionId: 's1', runId: 'r1', at: 1_000 })
    recordSpend({ operation: 'videos.list', units: 2.7, sessionId: 's1', runId: 'r1', at: 2_000 })

    expect(spendForSession('s1', 0)).toBe(2)
    expect(spendForRun('r1')).toBe(2)
  })

  it('keeps the tail of the ledger for the operator view', () => {
    recordSpend({ operation: 'videos.list', units: 1, at: 1_000 })
    recordSpend({ operation: 'videos.list', units: 2, at: 2_000 })

    const recent = recentSpend(1)

    expect(recent).toHaveLength(1)
    expect(recent[0].units).toBe(2)
  })
})

describe('budgetStatus', () => {
  beforeEach(() => {
    resetLedger()
  })

  it('reports a session that is still inside its budget', () => {
    recordSpend({ operation: 'search.list', units: 100, sessionId: 's1', at: noonUtcToday() })

    const status = budgetStatus('s1')

    expect(status.sessionExceeded).toBe(false)
    expect(status.globalExceeded).toBe(false)
    expect(status.used).toBe(100)
  })

  it('reports a session that has spent its whole budget', () => {
    recordSpend({ operation: 'search.list', units: 3_000, sessionId: 's1', at: noonUtcToday() })

    const status = budgetStatus('s1')

    expect(status.sessionExceeded).toBe(true)
    expect(status.globalExceeded).toBe(false)
    expect(status.tone).not.toBe('safe')
  })

  it('reports a deployment that has spent its whole global budget', () => {
    recordSpend({ operation: 'search.list', units: 9_000, sessionId: 's1', at: noonUtcToday() })

    const status = budgetStatus('s1')

    expect(status.globalExceeded).toBe(true)
    expect(status.tone).toBe('danger')
  })

  it('reports the budgets it enforces', () => {
    const status = budgetStatus('s1')

    expect(status.sessionBudget).toBeGreaterThan(0)
    expect(status.globalCap).toBeGreaterThan(0)
    expect(status.dailyQuota).toBeGreaterThan(0)
  })
})

describe('assertWithinBudget', () => {
  beforeEach(() => {
    resetLedger()
  })

  afterEach(() => {
    resetLedger()
  })

  it('lets a session inside its budget through', () => {
    expect(() => assertWithinBudget('s1')).not.toThrow()
  })

  it('stops a session that has spent its whole budget', () => {
    recordSpend({ operation: 'search.list', units: 3_000, sessionId: 's1', at: noonUtcToday() })

    let caught: unknown
    try {
      assertWithinBudget('s1')
    } catch (error) {
      caught = error
    }

    expect(isAppError(caught)).toBe(true)
    if (isAppError(caught)) {
      expect(caught.code).toBe('quota_exceeded')
      expect(caught.status).toBe(429)
    }
  })

  it('stops a deployment that has spent its whole global budget', () => {
    recordSpend({ operation: 'search.list', units: 9_000, sessionId: 's1', at: noonUtcToday() })

    expect(() => assertWithinBudget('s1')).toThrowError(AppError)
  })
})
