'use client'

import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * The visitor's own YouTube Data API key.
 *
 * The shared project key pays for every search, and the project's daily
 * budget is a hundred searches. A key from the visitor's own Google Cloud
 * project moves their traffic onto their own quota. The key is never returned
 * by the API — the panel can only say whether one is set.
 *
 * The app deliberately does not spread its own load over several projects to
 * multiply the quota: that is quota circumvention and it is not a feature.
 */

export function ApiKeyPanel() {
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)

  function retryLoad() {
    setLoading(true)
    setError(null)
    setLoadAttempt((attempt) => attempt + 1)
  }

  useEffect(() => {
    let active = true
    const result = fetch('/api/keys')
      .then(async (response) => ({ response, payload: await response.json().catch(() => null) }))
      .catch(() => null)
    void result.then((loaded) => {
      if (!active) return
      if (!loaded) setError('The key status could not be loaded. Check your connection and try again.')
      else if (!loaded.response.ok) setError(loaded.payload?.message || 'The key status could not be loaded.')
      else setConfigured(Boolean(loaded.payload?.configured))
      setLoading(false)
    })
    return () => { active = false }
  }, [loadAttempt])

  async function save() {
    if (busy) return
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey: value.trim() }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        setMessage(
          (payload && typeof payload.message === 'string' && payload.message) ||
            'The key could not be saved.',
        )
        return
      }
      setConfigured(true)
      setValue('')
      setMessage('Key saved. Your searches now run on your own quota.')
    } catch {
      setMessage('The key could not be saved. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (busy) return
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch('/api/keys', { method: 'DELETE' })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        setMessage((payload && typeof payload.message === 'string' && payload.message) || 'The key could not be removed.')
        return
      }
      setConfigured(false)
      setConfirmRemove(false)
      setMessage('Key removed. Searches run on the shared quota again.')
    } catch {
      setMessage('The key could not be removed. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <Skeleton className="h-24 w-full" />
  }

  if (error) {
    return <div className="space-y-3"><EmptyState title="The key status could not be loaded." body={error} /><Button variant="outline" size="md" onClick={retryLoad}>Retry</Button></div>
  }

  return (
    <div className="space-y-6">
      <p className="t-body text-ink/75">
        NeedleDrop searches YouTube tracks and builds playlists without sign-in. For
        live YouTube search, the shared project key uses the project&apos;s daily quota. You can
        optionally add a YouTube Data API key from your own Google Cloud project here in Settings
        to use your own quota. This key is for searching, not for signing in or saving a playlist.
      </p>

      <div className="border-2 border-ink/20 bg-paper p-5">
        <p className="t-small uppercase tracking-widest text-ink/60">Status</p>
        <p className="display t-title mt-2">
          {configured ? 'A key is set.' : 'No key set.'}
        </p>
        <p className="t-small mt-2 text-ink/60">
          The key itself is never shown back to the browser, not even masked. If you lose it,
          replace it here.
        </p>
      </div>

      {!configured ? (
        <div className="space-y-3">
          <label htmlFor="api-key" className="t-small font-semibold">
            Your YouTube Data API key
          </label>
          <Input
            id="api-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="AIza…"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <p className="t-small text-ink/60">
            Add your key here in Settings; it is checked with YouTube before it is stored. Verification
            costs 1 quota unit. The key is used for YouTube searches only; playlist saving uses Google sign-in.
          </p>
          <Button
            variant="mint"
            size="md"
            disabled={busy || value.trim().length === 0}
            onClick={() => void save()}
          >
            {busy ? 'Verifying…' : 'Save key'}
          </Button>
        </div>
      ) : (
        <div>
          {!confirmRemove ? (
            <Button
              variant="outline"
              size="md"
              disabled={busy}
              onClick={() => setConfirmRemove(true)}
            >
              Remove key
            </Button>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <p className="t-small text-ink/75">Remove the saved key? Searches fall back to the shared quota.</p>
              <Button variant="ink" size="sm" disabled={busy} onClick={() => void remove()}>
                {busy ? 'Removing…' : 'Confirm remove'}
              </Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirmRemove(false)}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      )}

      {message ? <p className="t-small text-ink/75">{message}</p> : null}
    </div>
  )
}
