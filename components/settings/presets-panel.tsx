'use client'

import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import type { PresetRow } from '@/lib/db/client'

/**
 * Saved discovery configurations.
 *
 * A preset is a named bundle of options ("Focus · 25 tracks · no live · ≤1
 * per artist"). Saving with an existing name replaces it, so the name is the
 * key. Presets are scoped to an anonymous cookie and need no account.
 */

function renderOptions(options: Record<string, unknown>): string {
  const entries = Object.entries(options).filter(([key]) => key !== 'shuffleSeed')
  if (entries.length === 0) return 'No options stored.'
  return entries
    .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
    .join(' · ')
}

export function PresetsPanel() {
  const [presets, setPresets] = useState<PresetRow[]>([])
  const [store, setStore] = useState<'memory' | 'postgres'>('memory')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)

  function retryLoad() {
    setLoading(true)
    setError(null)
    setLoadAttempt((attempt) => attempt + 1)
  }

  useEffect(() => {
    let active = true
    const result = fetch('/api/presets')
      .then(async (response) => ({ response, payload: await response.json().catch(() => null) }))
      .catch(() => null)
    void result.then((loaded) => {
      if (!active) return
      if (!loaded) setError('The presets could not be loaded. Check your connection and try again.')
      else if (!loaded.response.ok) setError(loaded.payload?.message || 'The presets could not be loaded.')
      else { setPresets(loaded.payload?.presets ?? []); setStore(loaded.payload?.store ?? 'memory') }
      setLoading(false)
    })
    return () => { active = false }
  }, [loadAttempt])

  async function remove(preset: PresetRow) {
    if (busy) return
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch(`/api/presets?name=${encodeURIComponent(preset.name)}`, {
        method: 'DELETE',
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        setMessage((payload && typeof payload.message === 'string' && payload.message) || 'The preset could not be removed.')
        return
      }
      setPresets((previous) => previous.filter((entry) => entry.id !== preset.id))
      setStore(payload.store ?? store)
      setMessage('Removed.')
    } catch {
      setMessage('The preset could not be removed. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <Skeleton className="h-40 w-full" />
  }

  if (error) {
    return <div className="space-y-3"><EmptyState title="The presets could not be loaded." body={error} /><Button variant="outline" size="md" onClick={retryLoad}>Retry</Button></div>
  }

  return (
    <div className="space-y-6">
      <p className="t-body text-ink/75">
        A preset is a named bundle of discovery options. Presets are scoped to this browser and
        need no account.
        {store === 'memory'
          ? ' The store is in memory right now, so the list is lost when the process restarts.'
          : ''}
      </p>

      {presets.length === 0 ? (
        <EmptyState
          title="No presets yet."
          body="Open Tune and save a real configuration; it will appear here for management."
        />
      ) : (
        <div className="border-2 border-ink">
          {presets.map((preset) => (
            <div
              key={preset.id}
              className="grid grid-cols-12 items-start gap-[var(--gap)] border-b-2 border-ink/10 px-3 py-3 last:border-b-0"
            >
              <div className="col-span-12 lg:col-span-9">
                <p className="t-title font-semibold leading-tight">{preset.name}</p>
                <p className="t-small mt-1 text-ink/60">{renderOptions(preset.options)}</p>
              </div>
              <div className="col-span-12 lg:col-span-3 flex items-start justify-end">
                <button
                   type="button"
                  disabled={busy}
                  onClick={() => void remove(preset)}
                  className="t-small text-ink/60 transition-colors hover:text-orange disabled:opacity-40"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {message ? <p className="t-small text-ink/75">{message}</p> : null}
    </div>
  )
}
