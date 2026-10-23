'use client'

import { useState } from 'react'

import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

/**
 * Delete all my data.
 *
 * Erases every row stored under the anonymous identifier — presets, blocks,
 * feedback and run history alike — and then rotates the identifier so the old
 * cookie cannot reach anything. It is irreversible, so it needs a real
 * confirmation step, and the counts the server returns are shown rather than
 * a generic "done".
 */

type DeleteCounts = {
  runs: number
  presets: number
  blocks: number
  feedback: number
  quotaLedger: number
}

export function DataPanel() {
  const [busy, setBusy] = useState(false)
  const [counts, setCounts] = useState<DeleteCounts | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [store, setStore] = useState<'memory' | 'postgres' | null>(null)

  async function deleteAll() {
    if (busy) return
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch('/api/feedback', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        setMessage(
          (payload && typeof payload.message === 'string' && payload.message) ||
            'The data could not be deleted.',
        )
        return
      }
      setCounts(payload.deleted as DeleteCounts)
      setStore(payload.store ?? null)
      setMessage('Deleted. The anonymous identifier has been rotated.')
    } catch {
      setMessage('The data could not be deleted. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <p className="t-body text-ink/75">
        This erases every row stored under this browser&apos;s anonymous identifier — presets, blocks,
        feedback and run history — and then rotates that identifier so the old cookie cannot reach
        anything. It cannot be undone. It does not touch your Google account or your YouTube
        playlists.
      </p>

      <Dialog>
        <DialogTrigger asChild>
          <button
            type="button"
            className="h-11 border-2 border-orange px-5 t-body font-semibold text-orange transition-colors hover:bg-orange hover:text-ink"
          >
            Delete all my data
          </button>
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>Delete everything?</DialogTitle>
          <DialogDescription>
            This erases every row stored under your anonymous identifier and rotates it. It cannot
            be undone.
          </DialogDescription>
          <div className="mt-6 flex justify-end gap-3">
            <DialogClose asChild>
              <button
                type="button"
                className="h-11 border-2 border-ink px-5 t-body font-semibold text-ink transition-colors hover:bg-ink hover:text-paper"
              >
                Keep it
              </button>
            </DialogClose>
            <button
              type="button"
              disabled={busy}
              onClick={() => void deleteAll()}
              className="h-11 border-2 border-orange bg-orange px-5 t-body font-semibold text-ink transition-colors hover:bg-ink hover:text-orange disabled:opacity-40"
            >
              {busy ? 'Deleting…' : 'Delete for good'}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {counts ? (
        <div className="border-2 border-ink bg-paper p-5">
          <p className="t-small uppercase tracking-widest text-ink/60">Deleted</p>
          <dl className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-5">
            {[
              ['Runs', counts.runs],
              ['Presets', counts.presets],
              ['Blocks', counts.blocks],
              ['Feedback', counts.feedback],
              ['Quota ledger', counts.quotaLedger],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="t-small text-ink/60">{label}</dt>
                <dd className="tnum t-title font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
          {store ? <p className="t-small mt-3 text-ink/60">Store: {store}.</p> : null}
        </div>
      ) : null}

      {message ? <p className="t-small text-ink/75">{message}</p> : null}

      <p className="t-small text-ink/60">
        For the full policy, see <a href="/privacy" className="underline underline-offset-4">/privacy</a>.
      </p>
    </div>
  )
}
