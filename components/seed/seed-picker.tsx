'use client'

import Image from 'next/image'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  Loader2,
  Search,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDuration } from '@/lib/format'
import type { Track } from '@/lib/youtube/types'

/**
 * The seed picker — the first stage of the generator.
 *
 * It owns the search input and result list so the generator component itself
 * only has to react to a chosen track. The picker reports quota spend upward
 * through `onUnitsSpent` rather than owning the running total.
 */
export function SeedPicker({
  onSeed,
  onUnitsSpent,
}: {
  onSeed: (track: Track) => void
  onUnitsSpent: (units: number) => void
}) {
  const [query, setQuery] = useState('')
  const [seeds, setSeeds] = useState<Track[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [demoMode, setDemoMode] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const searchInFlightRef = useRef(false)

  useEffect(() => {
    fetch('/api/quota')
      .then((response) => response.json())
      .then((data: { demo: boolean }) => setDemoMode(Boolean(data.demo)))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA'
      if (event.key === '/' && !typing) {
        event.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const runSearch = useCallback(async () => {
    if (!query.trim() || searchInFlightRef.current) return
    searchInFlightRef.current = true
    setBusy(true)
    setError(null)
    setSeeds([])
    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })
      const payload = (await response.json()) as {
        seeds?: Track[]
        unitsSpent?: number
        message?: string
      }
      if (!response.ok) throw new Error(payload.message ?? 'The search failed.')
      const found = (payload.seeds ?? []) as Track[]
      onUnitsSpent(payload.unitsSpent ?? 0)
      setSeeds(found)
      if (found.length === 0) {
        setError('No tracks matched that search. Try an artist name or a song title.')
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The search failed.')
    } finally {
      searchInFlightRef.current = false
      setBusy(false)
    }
  }, [onUnitsSpent, query])

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="t-title font-semibold">Start with one track</h3>
        <p className="mt-1 t-small text-paper/65">
          A title, an artist, or a YouTube link. Everything else is inferred.
        </p>
      </div>

      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault()
          void runSearch()
        }}
      >
        <Input
          ref={inputRef}
          id="seed-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="e.g. Kaytranada - Lite Spots"
          aria-label="Track, artist or YouTube link"
          className="border-paper/40 placeholder:text-paper/65 focus-visible:border-mint"
        />
        <Button type="submit" size="md" disabled={busy} className="shrink-0">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          Search
        </Button>
      </form>

      {error && <p className="t-small text-orange">{error}</p>}

      {demoMode && (
        <span className="self-start border border-paper/40 px-2 py-0.5 t-small text-paper/70">
          Demo catalogue
        </span>
      )}

      {busy && (
        <ul className="flex flex-col" aria-busy="true" aria-label="Searching">
          {[0, 1, 2].map((row) => (
            <li key={row} className="flex items-center gap-3 border-t-2 border-paper/15 py-2.5">
              <Skeleton className="size-12 shrink-0" />
              <span className="flex-1">
                <Skeleton className="mb-2 h-3 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </span>
            </li>
          ))}
        </ul>
      )}

      {!busy && seeds.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="t-small text-paper/60">
            {seeds.length} {seeds.length === 1 ? 'track' : 'tracks'} found
          </p>
          <ul className="flex flex-col">
            {seeds.map((track) => (
              <li key={track.videoId}>
                <button
                  type="button"
                  onClick={() => onSeed(track)}
                  className="group flex w-full items-center gap-3 border-t-2 border-paper/15 py-2.5 text-left transition-colors hover:bg-paper/10"
                >
                  <Image
                    src={track.thumbnail}
                    alt=""
                    width={48}
                    height={48}
                    className="size-12 shrink-0 object-cover"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate t-body font-semibold">{track.title}</span>
                    <span className="block truncate t-small text-paper/60">
                      {track.artist} · {track.topicName}
                    </span>
                  </span>
                  <span className="tnum shrink-0 t-small text-paper/70">
                    {formatDuration(track.durationSec)}
                  </span>
                  <ArrowRight className="size-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!busy && seeds.length === 0 && !error && (
        <EmptyState
          title="No seed yet."
          body="Search for a track above. The seed becomes the centre of gravity for everything that follows."
          className="border-paper/30 text-paper"
        />
      )}
    </div>
  )
}
