'use client'

import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
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
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/presets')
      .then((response) =>
        response
          .json()
          .catch(() => null)
          .then((payload) => ({ response, payload })),
      )
      .then(({ response, payload }) => {
        if (cancelled) return
        if (!response.ok) {
          setError((payload && typeof payload.message === 'string' && payload.message) || 'The presets could not be loaded.')
          return
        }
        setPresets(payload?.presets ?? [])
        setStore(payload?.store ?? 'memory')
      })
      .catch(() => {
        if (cancelled) return
        setError('The presets could not be loaded. Check your connection and try again.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function save() {
    const trimmed = name.trim()
    if (!trimmed) return
    setBusy(true)
    setMessage(null)
    // A preset stores the current discovery options. The settings page does not
    // hold a live options object, so it stores an empty bundle here; the
    // generator is where presets are created with real options. This panel is
    // for reviewing and removing them.
    try {
      const response = await fetch('/api/presets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: trimmed, options: {} }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        setMessage((payload && typeof payload.message === 'string' && payload.message) || 'The preset could not be saved.')
        return
      }
      setPresets((previous) => {
        const rest = previous.filter((entry) => entry.name !== trimmed)
        return [payload.preset, ...rest]
      })
      setStore(payload.store ?? store)
      setName('')
      setMessage('Saved. Saving with an existing name replaces it.')
    } catch {
      setMessage('The preset could not be saved. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(preset: PresetRow) {
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
    return <EmptyState title="The presets could not be loaded." body={error} />
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

      <div className="grid grid-cols-12 gap-[var(--gap)]">
        <div className="col-span-12 lg:col-span-8">
          <label htmlFor="preset-name" className="t-small font-semibold">
            Name
          </label>
          <Input
            id="preset-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Focus · 25 tracks · no live"
            className="mt-2"
          />
        </div>
        <div className="col-span-12 lg:col-span-4 flex items-end">
          <Button variant="mint" size="md" disabled={busy || name.trim().length === 0} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save preset'}
          </Button>
        </div>
      </div>
      <p className="t-small text-ink/60">
        Saving with an existing name replaces it. Presets created in the generator carry the full
        options bundle; presets created here store an empty bundle and are mainly useful for
        renaming or removal.
      </p>

      {presets.length === 0 ? (
        <EmptyState
          title="No presets yet."
          body="Save a setup from the generator and it shows up here."
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
                  onClick={() => void remove(preset)}
                  className="t-small text-ink/60 transition-colors hover:text-orange"
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