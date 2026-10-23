'use client'

import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { formatUnits, UNIT_COST } from '@/lib/quota'
import type { BudgetStatus } from '@/lib/quota-ledger'

/**
 * The budget, shown as figures rather than as a percentage alone.
 *
 * The daily quota is the scarce resource in this product, so the page leads
 * with the actual numbers: the project's daily quota, the global cap the app
 * refuses to cross, the soft per-session budget, and what this session and
 * the whole deployment have spent today. The tone comes from the server, not
 * from a re-derived threshold, so the UI cannot disagree with the ledger.
 */

type QuotaResponse = {
  dailyQuota: number
  globalCap: number
  sessionBudget: number
  demo: boolean
  discovery: { units: number; calls: number }
  playlist: { units: number; tracks: number }
  budget: BudgetStatus
  cache: {
    hits: number
    stale: number
    misses: number
    loads: number
    servedWithoutUpstream: number
    evictions: number
    expired: number
    hitRate: number
    entries: number
    backend: 'memory' | 'redis'
  }
  flags: Record<string, string | number | boolean>
  unitsSpent: number
  calls: number
}

const COST_ROWS: Array<{ label: string; value: number; note: string }> = [
  { label: 'search.list', value: UNIT_COST.search, note: 'per call — the expensive one' },
  { label: 'playlistItems.insert', value: UNIT_COST.playlistItemsInsert, note: 'per item' },
  { label: 'playlists.insert', value: UNIT_COST.playlistsInsert, note: 'per playlist' },
  { label: 'videos.list', value: UNIT_COST.videosList, note: 'per call, up to 50 ids' },
  { label: 'playlistItems.list', value: UNIT_COST.playlistItemsList, note: 'per page' },
]

export function QuotaPanel() {
  const [data, setData] = useState<QuotaResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)

  function retryLoad() {
    setLoading(true)
    setError(null)
    setLoadAttempt((attempt) => attempt + 1)
  }

  useEffect(() => {
    let active = true
    const result = fetch('/api/quota')
      .then(async (response) => ({ response, payload: await response.json().catch(() => null) }))
      .catch(() => null)
    void result.then((loaded) => {
      if (!active) return
      if (!loaded) setError('The budget could not be loaded. Check your connection and try again.')
      else if (!loaded.response.ok) setError(loaded.payload?.message || 'The budget could not be loaded.')
      else setData(loaded.payload as QuotaResponse)
      setLoading(false)
    })
    return () => { active = false }
  }, [loadAttempt])

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-1/2" />
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="space-y-3">
        <EmptyState
          title="The budget could not be loaded."
          body={error ?? 'Try again in a moment.'}
        />
        <Button variant="outline" size="md" onClick={retryLoad}>Retry</Button>
      </div>
    )
  }

  const tone = data.budget.tone
  const toneClass =
    tone === 'danger' ? 'text-orange' : tone === 'warn' ? 'text-ink' : 'text-mint'

  const sessionPct = Math.min(100, (data.budget.used / Math.max(1, data.budget.sessionBudget)) * 100)
  const globalPct = Math.min(100, (data.budget.dailySpend / Math.max(1, data.budget.globalCap)) * 100)

  return (
    <div className="space-y-10">
      {data.demo ? (
        <div className="border-2 border-orange bg-paper p-5">
          <p className="t-title font-semibold text-orange">Demo mode.</p>
          <p className="t-body mt-2 text-ink/80">
            Searches and playlist building are using the built-in demo catalogue. Nothing is being
            written to YouTube, and discovery is not spending the shared quota. Add your own YouTube
            Data API key in Settings to search live YouTube tracks. Sign-in is still only needed when
            you choose to save a finished playlist.
          </p>
        </div>
      ) : null}

      <p className="t-small text-ink/60">
        Quota is measured in YouTube Data API units, not tracks or dollars. Shared-project values cover visitors using the app&apos;s key; a visitor&apos;s optional personal key uses that Google Cloud project&apos;s separate quota and is not included here.
      </p>

      {data.budget.sessionExceeded || data.budget.globalExceeded ? (
        <div className="border-2 border-orange bg-paper p-5">
          <p className="t-title font-semibold text-orange">
            {data.budget.globalExceeded ? 'The shared daily budget is spent.' : 'This session is over its budget.'}
          </p>
          <p className="t-body mt-2 text-ink/80">
            The daily quota resets at midnight Pacific Time. You can add your own YouTube Data API
            key in Settings to search live YouTube tracks using your own quota.
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-12 gap-[var(--gap)]">
        <figure className="col-span-6 lg:col-span-3">
          <p className="t-small uppercase tracking-widest text-ink/60">Daily quota</p>
          <p className="display tnum t-mega mt-2 leading-none">{formatUnits(data.dailyQuota)}</p>
          <p className="t-small mt-2 text-ink/60">The project&apos;s hard ceiling.</p>
        </figure>
        <figure className="col-span-6 lg:col-span-3">
          <p className="t-small uppercase tracking-widest text-ink/60">Global cap</p>
          <p className="display tnum t-mega mt-2 leading-none">{formatUnits(data.globalCap)}</p>
          <p className="t-small mt-2 text-ink/60">The app refuses to cross this.</p>
        </figure>
        <figure className="col-span-6 lg:col-span-3">
          <p className="t-small uppercase tracking-widest text-ink/60">Session budget</p>
          <p className="display tnum t-mega mt-2 leading-none">{formatUnits(data.sessionBudget)}</p>
          <p className="t-small mt-2 text-ink/60">Soft cap per visitor.</p>
        </figure>
        <figure className="col-span-6 lg:col-span-3">
          <p className="t-small uppercase tracking-widest text-ink/60">This session</p>
          <p className={`display tnum t-mega mt-2 leading-none ${toneClass}`}>{formatUnits(data.budget.used)}</p>
          <p className="t-small mt-2 text-ink/60">Spent today.</p>
        </figure>
      </div>

      <div className="space-y-6">
        <div>
          <div className="flex items-center justify-between">
            <p className="t-small font-semibold">Session usage</p>
            <p className="tnum t-small text-ink/60">
              {formatUnits(data.budget.used)} / {formatUnits(data.budget.sessionBudget)}
            </p>
          </div>
          <div className="mt-2 h-2 w-full bg-ink/10">
            <div
              className={`h-2 ${tone === 'danger' ? 'bg-orange' : tone === 'warn' ? 'bg-ink' : 'bg-mint'}`}
              style={{ width: `${sessionPct}%` }}
            />
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between">
            <p className="t-small font-semibold">Deployment usage today</p>
            <p className="tnum t-small text-ink/60">
              {formatUnits(data.budget.dailySpend)} / {formatUnits(data.budget.globalCap)}
            </p>
          </div>
          <div className="mt-2 h-2 w-full bg-ink/10">
            <div
              className={`h-2 ${data.budget.globalExceeded ? 'bg-orange' : 'bg-ink'}`}
              style={{ width: `${globalPct}%` }}
            />
          </div>
        </div>
      </div>

      <div>
        <h3 className="t-title font-semibold">What things cost</h3>
        <p className="t-small mt-2 text-ink/60">
          A discovery run is about {formatUnits(data.discovery.units)} units and a 20-track playlist is
          about {formatUnits(data.playlist.units)}. Every response carries the real number so you can
          reconcile it against these estimates.
        </p>
        <div className="mt-4 border-2 border-ink">
          {COST_ROWS.map((row) => (
            <div
              key={row.label}
              className="grid grid-cols-12 items-center gap-[var(--gap)] border-b-2 border-ink/10 px-3 py-2 last:border-b-0"
            >
              <code className="col-span-6 t-small font-mono">{row.label}</code>
              <span className="col-span-2 tnum t-small font-semibold">{row.value}</span>
              <span className="col-span-4 t-small text-ink/60">{row.note}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="t-title font-semibold">Cache</h3>
        <p className="t-small mt-2 text-ink/60">
          Backend: {data.cache.backend}. Hit rate{' '}
          {Math.round(data.cache.hitRate * 100)}% across {data.cache.entries} entries.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ['Hits', data.cache.hits],
            ['Stale', data.cache.stale],
            ['Misses', data.cache.misses],
            ['Served without upstream', data.cache.servedWithoutUpstream],
          ].map(([label, value]) => (
            <div key={label} className="border-2 border-ink/20 px-3 py-2">
              <p className="t-small text-ink/60">{label}</p>
              <p className="tnum t-title font-semibold">{value}</p>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="t-title font-semibold">Feature flags</h3>
        <p className="t-small mt-2 text-ink/60">
          What this deployment is actually doing. Set through environment variables, not the UI.
        </p>
        <div className="mt-4 border-2 border-ink">
          {Object.entries(data.flags).map(([key, value]) => (
            <div
              key={key}
              className="grid grid-cols-12 items-center gap-[var(--gap)] border-b-2 border-ink/10 px-3 py-2 last:border-b-0"
            >
              <code className="col-span-6 t-small font-mono">{key}</code>
              <span className="col-span-6 t-small font-semibold">{String(value)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
