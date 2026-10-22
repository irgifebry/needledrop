'use client'

import Image from 'next/image'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  Check,
  CircleHelp,
  ExternalLink,
  Loader2,
  Lock,
  Search,
  Sparkles,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Popover } from '@/components/ui/popover'
import { RadioGroup, RadioCard } from '@/components/ui/radio-group'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDuration } from '@/lib/format'
import { DAILY_QUOTA, estimateDiscoveryUnits, estimatePlaylistUnits, formatUnits } from '@/lib/quota'
import { DEFAULT_OPTIONS, type Candidate, type DiscoveryOptions, type Track } from '@/lib/youtube/types'
import { cn } from '@/lib/utils'

type Stage = 'seed' | 'tune' | 'build' | 'done'

type CreatedPlaylist = {
  playlistId: string | null
  playlistUrl: string | null
  demo: boolean
  message?: string
}

const STAGES: Array<{ id: Stage; label: string }> = [
  { id: 'seed', label: 'Seed' },
  { id: 'tune', label: 'Tune' },
  { id: 'build', label: 'Build' },
]

export function Generator() {
  const [stage, setStage] = useState<Stage>('seed')
  const [query, setQuery] = useState('')
  const [seeds, setSeeds] = useState<Track[]>([])
  const [seed, setSeed] = useState<Track | null>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [options, setOptions] = useState<DiscoveryOptions>(DEFAULT_OPTIONS)
  const [busy, setBusy] = useState<'search' | 'discover' | 'create' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<CreatedPlaylist | null>(null)
  const [unitsSpent, setUnitsSpent] = useState(0)
  const [demoMode, setDemoMode] = useState(false)
  const [title, setTitle] = useState('')
  const [privacy, setPrivacy] = useState<'private' | 'unlisted' | 'public'>('private')
  const inputRef = useRef<HTMLInputElement>(null)

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
    if (!query.trim()) return
    setBusy('search')
    setError(null)
    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message ?? 'The search failed.')
      setSeeds(payload.seeds as Track[])
      setUnitsSpent(payload.unitsSpent as number)
      if ((payload.seeds as Track[]).length === 0) {
        setError('No tracks matched that search. Try an artist name or a song title.')
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The search failed.')
    } finally {
      setBusy(null)
    }
  }, [query])

  function chooseSeed(track: Track) {
    setSeed(track)
    setTitle(`${track.artist} radio`)
    setStage('tune')
  }

  const runDiscover = useCallback(async () => {
    if (!seed) return
    setBusy('discover')
    setError(null)
    try {
      const response = await fetch('/api/similar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed, options }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message ?? 'Discovery failed.')
      const found = payload.candidates as Candidate[]
      setCandidates(found)
      setPicked(new Set(found.map((candidate) => candidate.videoId)))
      setUnitsSpent((payload.unitsSpent as number) ?? 0)
      setStage('build')
      if (found.length === 0) {
        setError(
          'Nothing cleared the filters. Loosen the version toggles or widen the breadth slider.',
        )
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Discovery failed.')
    } finally {
      setBusy(null)
    }
  }, [options, seed])

  const runCreate = useCallback(async () => {
    const videoIds = candidates
      .filter((candidate) => picked.has(candidate.videoId))
      .map((candidate) => candidate.videoId)
    if (videoIds.length === 0) {
      setError('Pick at least one track before creating the playlist.')
      return
    }
    setBusy('create')
    setError(null)
    try {
      const response = await fetch('/api/playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoIds, title, description: '', privacy }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message ?? 'The playlist could not be created.')
      setCreated(payload as CreatedPlaylist)
      setStage('done')
      setUnitsSpent((payload.unitsSpent as number) ?? 0)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The playlist could not be created.')
    } finally {
      setBusy(null)
    }
  }, [candidates, picked, privacy, title])

  const chosen = useMemo(
    () => candidates.filter((candidate) => picked.has(candidate.videoId)),
    [candidates, picked],
  )

  const totalSeconds = useMemo(
    () => chosen.reduce((sum, candidate) => sum + candidate.durationSec, 0),
    [chosen],
  )

  const playlistUnits = estimatePlaylistUnits(chosen.length)
  const discoveryUnits = estimateDiscoveryUnits()

  function toggle(videoId: string) {
    setPicked((current) => {
      const next = new Set(current)
      if (next.has(videoId)) next.delete(videoId)
      else next.add(videoId)
      return next
    })
  }

  function reset() {
    setStage('seed')
    setSeed(null)
    setSeeds([])
    setCandidates([])
    setPicked(new Set())
    setCreated(null)
    setError(null)
    setUnitsSpent(0)
  }

  return (
    <div
      data-ui className="flex h-full flex-col border-4 border-ink bg-ink text-paper shadow-[14px_14px_0_0_var(--color-orange)]"
      aria-label="Playlist generator"
    >
      {/* Rail */}
      <div className="flex items-center justify-between gap-4 border-b-2 border-paper/20 px-5 py-3">
        <div className="flex items-center gap-2">
          {STAGES.map((item, index) => {
            const activeIndex = STAGES.findIndex((entry) => entry.id === stage)
            const done = stage === 'done' || index < activeIndex
            const active = item.id === stage
            return (
              <div key={item.id} className="flex items-center gap-2">
                {index > 0 && <span className="size-1.5 rotate-45 bg-paper/50" aria-hidden="true" />}
                <span
                  className={cn(
                    't-small font-semibold',
                    active ? 'text-mint' : done ? 'text-paper/70' : 'text-paper/60',
                  )}
                >
                  {item.label}
                </span>
              </div>
            )
          })}
        </div>
        <div className="flex items-center gap-3">
          {demoMode && (
            <span className="border border-paper/40 px-2 py-0.5 t-small text-paper/70">
              Demo catalogue
            </span>
          )}
          <span className="tnum t-small text-paper/60">
            ≈ {formatUnits(discoveryUnits + playlistUnits)} units
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {stage === 'seed' && (
          <div className="flex flex-col gap-4 p-5">
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
              <Button type="submit" size="md" disabled={busy === 'search'} className="shrink-0">
                {busy === 'search' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Search className="size-4" />
                )}
                Search
              </Button>
            </form>

            {error && <p className="t-small text-orange">{error}</p>}

            {busy === 'search' && (
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

            {seeds.length > 0 && (
              <ul className="flex flex-col">
                {seeds.slice(0, 6).map((track) => (
                  <li key={track.videoId}>
                    <button
                      type="button"
                      onClick={() => chooseSeed(track)}
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
                        <span className="block truncate t-body font-semibold">
                          {track.title}
                        </span>
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
            )}
          </div>
        )}

        {stage === 'tune' && seed && (
          <div className="flex flex-col gap-5 p-5">
            <div className="flex items-center gap-3">
              <Image
                src={seed.thumbnail}
                alt=""
                width={56}
                height={56}
                className="size-14 shrink-0 object-cover"
              />
              <div className="min-w-0">
                <p className="truncate t-lead font-semibold leading-tight">{seed.title}</p>
                <p className="truncate t-small text-paper/60">
                  {seed.artist} · {seed.topicName}
                </p>
              </div>
            </div>

            <Control label="Tracks in the playlist">
              <div className="flex flex-wrap gap-2">
                {[10, 20, 30, 50].map((count) => (
                  <button
                    key={count}
                    type="button"
                    onClick={() => setOptions((current) => ({ ...current, count }))}
                    className={cn(
                      'tnum h-9 min-w-12 border-2 border-paper/40 px-3 t-small font-semibold transition-colors',
                      options.count === count
                        ? 'border-mint bg-mint text-ink'
                        : 'hover:border-paper',
                    )}
                  >
                    {count}
                  </button>
                ))}
              </div>
            </Control>

            <Control
              label="Breadth"
              hint={
                options.breadth < 35
                  ? 'Strict: songs that sound like this'
                  : options.breadth > 65
                    ? 'Explore: something new but adjacent'
                    : 'Balanced: same neighbourhood'
              }
            >
              <div className="flex items-center gap-3">
                <span className="w-16 t-small text-paper/70">Strict</span>
                <Slider
                  value={[options.breadth]}
                  min={0}
                  max={100}
                  step={5}
                  onValueChange={([value]) =>
                    setOptions((current) => ({ ...current, breadth: value ?? 50 }))
                  }
                  aria-label="Discovery breadth"
                />
                <span className="w-16 text-right t-small text-paper/70">Explore</span>
              </div>
            </Control>

            <Control label="Versions">
              <div className="flex flex-col gap-2.5">
                {(
                  [
                    ['includeLive', 'Include live versions'],
                    ['includeRemix', 'Include remixes'],
                    ['includeAcoustic', 'Include acoustic takes'],
                    ['hideSeedArtist', 'Hide the seed artist'],
                    ['includePopularity', 'Weight by popularity'],
                  ] as const
                ).map(([key, label]) => (
                  <label
                    key={key}
                    className="flex cursor-pointer items-center justify-between gap-4 t-small"
                  >
                    <span>{label}</span>
                    <Switch
                      checked={options[key]}
                      onCheckedChange={(checked) =>
                        setOptions((current) => ({ ...current, [key]: checked }))
                      }
                      aria-label={label}
                    />
                  </label>
                ))}
              </div>
            </Control>

            <Control label="Max tracks per artist">
              <div className="flex gap-2">
                {[1, 2, 3, 4].map((limit) => (
                  <button
                    key={limit}
                    type="button"
                    onClick={() => setOptions((current) => ({ ...current, maxPerArtist: limit }))}
                    className={cn(
                      'tnum h-9 min-w-11 border-2 border-paper/40 px-3 t-small font-semibold transition-colors',
                      options.maxPerArtist === limit
                        ? 'border-mint bg-mint text-ink'
                        : 'hover:border-paper',
                    )}
                  >
                    {limit}
                  </button>
                ))}
              </div>
            </Control>

            {error && <p className="t-small text-orange">{error}</p>}

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button onClick={() => void runDiscover()} disabled={busy === 'discover'} block>
                {busy === 'discover' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                Discover tracks
              </Button>
              <Button variant="outline" onClick={reset}>
                Change seed
              </Button>
            </div>
          </div>
        )}

        {stage === 'build' && (
          <div className="flex flex-col gap-4 p-5">
            <div className="flex items-baseline justify-between gap-4">
              <h3 className="t-title font-semibold">{chosen.length} tracks ready</h3>
              <span className="tnum t-small text-paper/60">
                {Math.round(totalSeconds / 60)} min
              </span>
            </div>

            <ul className="flex flex-col">
              {candidates.map((candidate) => {
                const active = picked.has(candidate.videoId)
                return (
                  <li
                    key={candidate.videoId}
                    className={cn(
                      'flex items-center gap-3 border-t-2 border-paper/15 py-2.5 transition-opacity',
                      !active && 'opacity-45',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => toggle(candidate.videoId)}
                      aria-pressed={active}
                      aria-label={active ? `Remove ${candidate.title}` : `Add ${candidate.title}`}
                      className={cn(
                        'flex size-6 shrink-0 items-center justify-center border-2 transition-colors',
                        active ? 'border-mint bg-mint text-ink' : 'border-paper/50',
                      )}
                    >
                      {active && <Check className="size-4" strokeWidth={3} />}
                    </button>

                    <Image
                      src={candidate.thumbnail}
                      alt=""
                      width={44}
                      height={44}
                      className="size-11 shrink-0 object-cover"
                    />

                    <div className="min-w-0 flex-1">
                      <p className="truncate t-small font-semibold leading-tight">
                        {candidate.title}
                      </p>
                      <p className="truncate t-small text-paper/70">{candidate.artist}</p>
                    </div>

                    <span className="tnum hidden shrink-0 t-small text-paper/70 sm:block">
                      {formatDuration(candidate.durationSec)}
                    </span>

                    <span className="tnum w-9 shrink-0 text-right t-small font-semibold text-mint">
                      {Math.round(candidate.score)}
                    </span>

                    <Popover
                      trigger={
                        <button
                          type="button"
                          aria-label={`Why ${candidate.title} scored ${Math.round(candidate.score)}`}
                          className="shrink-0 text-paper/70 transition-colors hover:text-paper"
                        >
                          <CircleHelp className="size-4" />
                        </button>
                      }
                    >
                      <p className="t-small font-semibold">Why this track</p>
                      <ul className="mt-2 flex flex-col gap-1.5">
                        {candidate.reasons.map((reason) => (
                          <li
                            key={reason.label}
                            className="flex items-baseline justify-between gap-3 t-small"
                          >
                            <span className="text-ink/75">{reason.label}</span>
                            <span className="tnum shrink-0 font-semibold">+{reason.points}</span>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-3 border-t-2 border-ink/15 pt-2 t-small text-ink/75">
                        Matched on topic, channel and length. Not on audio analysis.
                      </p>
                    </Popover>
                  </li>
                )
              })}
            </ul>

            <div className="flex flex-col gap-3 border-t-2 border-paper/20 pt-4">
              <label className="flex flex-col gap-1.5">
                <span className="t-small font-semibold">Playlist title</span>
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="border-paper/40 focus-visible:border-mint"
                />
              </label>

              <RadioGroup
                value={privacy}
                onValueChange={(value) => setPrivacy(value as typeof privacy)}
                aria-label="Playlist privacy"
                className="grid-cols-1 sm:grid-cols-3"
              >
                <RadioCard value="private">
                  <Lock className="size-4 shrink-0" />
                  <span className="t-small font-semibold">Private</span>
                </RadioCard>
                <RadioCard value="unlisted">
                  <span className="t-small font-semibold">Unlisted</span>
                </RadioCard>
                <RadioCard value="public">
                  <span className="t-small font-semibold">Public</span>
                </RadioCard>
              </RadioGroup>

              <div className="flex items-baseline justify-between t-small">
                <span className="text-paper/65">This run will cost</span>
                <span className="tnum font-semibold">
                  {formatUnits(playlistUnits + discoveryUnits)} of {formatUnits(DAILY_QUOTA)}
                </span>
              </div>

              {error && <p className="t-small text-orange">{error}</p>}

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button onClick={() => void runCreate()} disabled={busy === 'create'} block>
                  {busy === 'create' ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <ArrowRight className="size-4" />
                  )}
                  Create playlist
                </Button>
                <Button variant="outline" onClick={() => void runDiscover()} disabled={busy === 'discover'}>
                  Re-run
                </Button>
              </div>
            </div>
          </div>
        )}

        {stage === 'done' && created && (
          <div className="flex flex-col gap-5 p-5">
            <div>
              <Badge className="border-mint text-mint">
                {created.demo ? 'Demo run' : 'Playlist created'}
              </Badge>
              <h3 className="mt-3 t-title font-semibold leading-tight">{title}</h3>
              <p className="mt-1 t-small text-paper/65">
                {chosen.length} tracks · {Math.round(totalSeconds / 60)} min ·{' '}
                {created.demo ? (
                  <>
                    <span className="tnum">≈ {formatUnits(discoveryUnits + playlistUnits)}</span>{' '}
                    units on a live run
                  </>
                ) : (
                  <>
                    <span className="tnum">{formatUnits(unitsSpent)}</span> units spent
                  </>
                )}
              </p>
            </div>

            {created.demo ? (
              <p className="border-2 border-paper/25 p-4 t-small text-paper/75">
                {created.message ??
                  'No playlist was created on YouTube. This is a demo run.'}
              </p>
            ) : (
              <Button variant="mint" block>
                <a
                  href={created.playlistUrl ?? '#'}
                  target="_blank"
                  rel="noreferrer"
                  className="flex w-full items-center justify-center gap-2"
                >
                  Open in YouTube Music
                  <ExternalLink className="size-4" />
                </a>
              </Button>
            )}

            <div className="flex flex-wrap gap-2">
              {chosen.slice(0, 6).map((candidate) => (
                <Image
                  key={candidate.videoId}
                  src={candidate.thumbnail}
                  alt={candidate.title}
                  width={56}
                  height={56}
                  className="size-14 object-cover"
                />
              ))}
            </div>

            <Button variant="outline" onClick={reset}>
              Start another
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function Control({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="t-small font-semibold">{label}</span>
        {hint && <span className="t-small text-paper/70">{hint}</span>}
      </div>
      {children}
    </div>
  )
}
