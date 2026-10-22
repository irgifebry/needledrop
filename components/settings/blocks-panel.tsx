'use client'

import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import type { BlockRow } from '@/lib/db/client'

/**
 * Blocked artists, keywords and videos.
 *
 * A block is matched during discovery so the same unwanted track never comes
 * back. Blocks are scoped to an anonymous cookie, not to a Google account, so
 * they work without signing in and disappear when the cookie does. When the
 * store is `memory` they also disappear when the process restarts — the
 * panel says so rather than pretending they are durable.
 */

type BlockKind = 'artist' | 'keyword' | 'video_id'

const KIND_LABEL: Record<BlockKind, string> = {
  artist: 'Artist',
  keyword: 'Keyword',
  video_id: 'Video id',
}

export function BlocksPanel() {
  const [blocks, setBlocks] = useState<BlockRow[]>([])
  const [store, setStore] = useState<'memory' | 'postgres'>('memory')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [kind, setKind] = useState<BlockKind>('artist')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/blocks')
      .then((response) =>
        response
          .json()
          .catch(() => null)
          .then((payload) => ({ response, payload })),
      )
      .then(({ response, payload }) => {
        if (cancelled) return
        if (!response.ok) {
          setError((payload && typeof payload.message === 'string' && payload.message) || 'The blocklist could not be loaded.')
          return
        }
        setBlocks(payload?.blocks ?? [])
        setStore(payload?.store ?? 'memory')
      })
      .catch(() => {
        if (cancelled) return
        setError('The blocklist could not be loaded. Check your connection and try again.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function add() {
    const trimmed = value.trim()
    if (!trimmed) return
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch('/api/blocks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, value: trimmed }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        setMessage((payload && typeof payload.message === 'string' && payload.message) || 'The block could not be added.')
        return
      }
      setBlocks((previous) => [...previous, payload.block])
      setStore(payload.store ?? store)
      setValue('')
      setMessage('Blocked.')
    } catch {
      setMessage('The block could not be added. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(block: BlockRow) {
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch(`/api/blocks?id=${encodeURIComponent(block.id)}`, {
        method: 'DELETE',
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        setMessage((payload && typeof payload.message === 'string' && payload.message) || 'The block could not be removed.')
        return
      }
      setBlocks((previous) => previous.filter((entry) => entry.id !== block.id))
      setStore(payload.store ?? store)
      setMessage('Removed.')
    } catch {
      setMessage('The block could not be removed. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <Skeleton className="h-40 w-full" />
  }

  if (error) {
    return <EmptyState title="The blocklist could not be loaded." body={error} />
  }

  const grouped: Record<BlockKind, BlockRow[]> = { artist: [], keyword: [], video_id: [] }
  for (const block of blocks) {
    if (block.kind in grouped) grouped[block.kind as BlockKind].push(block)
  }

  return (
    <div className="space-y-6">
      <p className="t-body text-ink/75">
        Blocks are matched during discovery, so the same unwanted track never comes back. They are
        scoped to this browser, not to a Google account, and they work without signing in.
        {store === 'memory'
          ? ' The store is in memory right now, so the list is lost when the process restarts.'
          : ''}
      </p>

      <div className="grid grid-cols-12 gap-[var(--gap)]">
        <div className="col-span-12 lg:col-span-4">
          <label className="t-small font-semibold">Kind</label>
          <Select value={kind} onValueChange={(next) => setKind(next as BlockKind)}>
            <SelectTrigger className="mt-2">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(KIND_LABEL) as BlockKind[]).map((entry) => (
                <SelectItem key={entry} value={entry}>
                  {KIND_LABEL[entry]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-12 lg:col-span-6">
          <label htmlFor="block-value" className="t-small font-semibold">
            Value
          </label>
          <Input
            id="block-value"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={kind === 'video_id' ? 'dQw4w9WgXcQ' : kind === 'artist' ? 'artist name' : 'keyword'}
            className="mt-2"
          />
        </div>
        <div className="col-span-12 lg:col-span-2 flex items-end">
          <Button variant="mint" size="md" disabled={busy || value.trim().length === 0} onClick={() => void add()}>
            {busy ? 'Adding…' : 'Block'}
          </Button>
        </div>
      </div>

      {blocks.length === 0 ? (
        <EmptyState
          title="Nothing blocked."
          body="Add an artist, a keyword or a video id and it is filtered out of every future run."
        />
      ) : (
        <div className="space-y-6">
          {(Object.keys(grouped) as BlockKind[]).map((entry) =>
            grouped[entry].length === 0 ? null : (
              <div key={entry}>
                <h3 className="t-title font-semibold">{KIND_LABEL[entry]}s</h3>
                <div className="mt-3 border-2 border-ink">
                  {grouped[entry].map((block) => (
                    <div
                      key={block.id}
                      className="flex items-center justify-between gap-3 border-b-2 border-ink/10 px-3 py-2 last:border-b-0"
                    >
                      <code className="t-small font-mono">{block.value}</code>
                      <button
                        type="button"
                        onClick={() => void remove(block)}
                        className="t-small text-ink/60 transition-colors hover:text-orange"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ),
          )}
        </div>
      )}

      {message ? <p className="t-small text-ink/75">{message}</p> : null}
    </div>
  )
}