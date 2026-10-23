'use client'

import Image from 'next/image'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowRight,
  Check,
  CircleHelp,
  ExternalLink,
  Loader2,
  Lock,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react'

import { Button, ButtonLink } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Popover } from '@/components/ui/popover'
import { RadioGroup, RadioCard } from '@/components/ui/radio-group'
import { EmptyState } from '@/components/ui/empty-state'
import { ExportOptions } from '@/components/export-options'
import { SeedPicker } from '@/components/seed/seed-picker'
import { InlinePlayer } from '@/components/player/inline-player'
import { JobProgress } from '@/components/jobs/job-progress'
import { useJob } from '@/components/jobs/use-job'
import { formatDuration } from '@/lib/format'
import {
  DAILY_QUOTA,
  estimateDiscoveryUnits,
  estimatePlaylistUnits,
  formatUnits,
} from '@/lib/quota'
import { DEFAULT_OPTIONS, type Candidate, type DiscoveryOptions, type Track } from '@/lib/youtube/types'
import type { BudgetStatus } from '@/lib/quota-ledger'
import { cn } from '@/lib/utils'
import { getSaveCta, getSaveCtaAction, parseGeneratorDraft, storeGeneratorDraft } from '@/lib/generator-flow'

type Stage = 'seed' | 'tune' | 'build' | 'done'

type CreatedPlaylist = {
  playlistId: string | null
  playlistUrl: string | null
  demo: boolean
  message?: string
  ordered?: boolean
  note?: string
}

type PresetRow = {
  id: string
  anon_id: string
  name: string
  options: Record<string, unknown>
  created_at: string
  updated_at: string
}

type BlockRow = {
  id: string
  anon_id: string
  kind: 'artist' | 'keyword' | 'video_id'
  value: string
  created_at: string
}

type LibraryDuplicateIndex = {
  trackKeys: number
  scannedPlaylists: number
  scannedItems: number
  maxPlaylists: number
  maxItems: number
  truncated: boolean
  keys: string[]
}

type PlanEstimateBreakdown = {
  operation: string
  label: string
  count: number
  units: number
}

type PlanResponse = {
  estimate: { units: number; calls: number; breakdown: PlanEstimateBreakdown[] }
  playlistEstimate: { units: number; tracks: number }
  preview: Candidate[] | null
  note: string
  budget: BudgetStatus
  demo: boolean
  unitsSpent: number
  calls: number
}

const STAGES: Array<{ id: Stage; label: string }> = [
  { id: 'seed', label: 'Seed' },
  { id: 'tune', label: 'Tune' },
  { id: 'build', label: 'Build' },
]

const FEEDBACK_REASONS = ['Wrong vibe', 'Too popular', 'Duplicate', 'Wrong version', 'Other']

export function Generator() {
  return (
    <Suspense fallback={<div className="border-4 border-ink bg-ink text-paper p-5">Loading…</div>}>
      <GeneratorInner />
    </Suspense>
  )
}

function GeneratorInner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [stage, setStage] = useState<Stage>('seed')
  const [seed, setSeed] = useState<Track | null>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [options, setOptions] = useState<DiscoveryOptions>(DEFAULT_OPTIONS)
  const [busy, setBusy] = useState<'discover' | 'create' | 'plan' | 'resolve' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<CreatedPlaylist | null>(null)
  const [unitsSpent, setUnitsSpent] = useState(0)
  const [demoMode, setDemoMode] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [privacy, setPrivacy] = useState<'private' | 'unlisted' | 'public'>('private')

  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [authConfigured, setAuthConfigured] = useState(false)
  const [liveApi, setLiveApi] = useState(false)
  const [authNotice, setAuthNotice] = useState<string | null>(null)
  const [draftRestored, setDraftRestored] = useState(false)

  const [plan, setPlan] = useState<PlanResponse | null>(null)
  const [planBusy, setPlanBusy] = useState(false)

  const [presets, setPresets] = useState<PresetRow[]>([])
  const [presetName, setPresetName] = useState('')
  const [presetsLoading, setPresetsLoading] = useState(true)
  const [presetSaving, setPresetSaving] = useState(false)

  const [blocks, setBlocks] = useState<BlockRow[]>([])

  const [libraryKeys, setLibraryKeys] = useState<Set<string> | null>(null)
  const [libraryInfo, setLibraryInfo] = useState<LibraryDuplicateIndex | null>(null)
  const [libraryLoading, setLibraryLoading] = useState(false)

  const [playingId, setPlayingId] = useState<string | null>(null)

  const [jobPending, setJobPending] = useState(false)

  const stageHeadingRef = useRef<HTMLHeadingElement>(null)

  const job = useJob()

  // Demo mode + presets + blocks on mount.
  useEffect(() => {
    fetch('/api/quota')
      .then((response) => response.json())
      .then((data: { demo: boolean }) => setDemoMode(Boolean(data.demo)))
      .catch(() => undefined)

    fetch('/api/presets')
      .then((response) => response.json())
      .then((data: { presets?: PresetRow[] }) => setPresets(data.presets ?? []))
      .catch(() => undefined)
      .finally(() => setPresetsLoading(false))

    fetch('/api/blocks')
      .then((response) => response.json())
      .then((data: { blocks?: BlockRow[] }) => {
        const next = data.blocks ?? []
        setBlocks(next)
        setOptions((current) => ({
          ...current,
          blockedArtists: next
            .filter((block) => block.kind === 'artist')
            .map((block) => block.value),
          blockedKeywords: next
            .filter((block) => block.kind === 'keyword')
            .map((block) => block.value),
        }))
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/session')
      .then((response) => response.json())
      .then((data: { signedIn: boolean; configured?: boolean; liveApi?: boolean }) => {
        if (!cancelled) {
          setSignedIn(Boolean(data.signedIn))
          setAuthConfigured(Boolean(data.configured))
          setLiveApi(Boolean(data.liveApi))
        }
      })
      .catch(() => {
        if (!cancelled) setSignedIn(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const callback = searchParams.get('auth')
    if (callback !== 'ok' && callback !== 'failed') return
    let raw: string | null = null
    try {
      raw = window.sessionStorage.getItem('playlist-generator-draft')
    } catch {
      // Storage can be unavailable in restricted browser contexts.
    }
    const draft = raw ? parseGeneratorDraft(raw) : null
    // Defer restoration out of the effect's synchronous phase. In particular,
    // do not mark the draft ready for persistence until all snapshot fields
    // have been applied, or the storage effect could overwrite the OAuth draft.
    const restore = window.setTimeout(() => {
      setAuthNotice(callback === 'ok' ? 'Google sign-in successful. Your draft is ready to save.' : 'Google sign-in failed. Your playlist draft has been kept; try signing in again.')
      if (draft) {
        setTitle(draft.title)
        setDescription(draft.description)
        setPrivacy(draft.privacy)
        if (draft.seed && typeof draft.seed === 'object') setSeed(draft.seed as Track)
        if (Array.isArray(draft.candidates)) setCandidates(draft.candidates as Candidate[])
        if (Array.isArray(draft.picked)) setPicked(new Set(draft.picked))
        if (draft.options && typeof draft.options === 'object') setOptions(draft.options as DiscoveryOptions)
        if (draft.seed && Array.isArray(draft.candidates)) setStage('build')
      }
      setDraftRestored(true)
    }, 0)
    return () => window.clearTimeout(restore)
  }, [searchParams])

  useEffect(() => {
    if (!draftRestored || stage === 'done') return
    storeGeneratorDraft(window.sessionStorage, {
      title, description, privacy, seed: seed ?? undefined, candidates, picked: [...picked], options,
    })
  }, [draftRestored, stage, title, description, privacy, seed, candidates, picked, options])

  // Library index for "skip tracks I already have".
  useEffect(() => {
    if (signedIn !== true) return
    let cancelled = false
    fetch('/api/library')
      .then((response) => {
        setLibraryLoading(true)
        return response.json()
      })
      .then((data: { duplicateIndex?: LibraryDuplicateIndex }) => {
        if (cancelled) return
        if (data.duplicateIndex) {
          setLibraryKeys(new Set(data.duplicateIndex.keys))
          setLibraryInfo(data.duplicateIndex)
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLibraryLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [signedIn])

  // Seed from URL ?seed= param.
  useEffect(() => {
    const seedParam = searchParams.get('seed')
    if (!seedParam) return
    let cancelled = false
    async function resolve() {
      setBusy('resolve')
      setError(null)
      try {
        const response = await fetch('/api/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: seedParam }),
        })
        const payload = (await response.json()) as {
          label?: string
          candidates?: Track[]
          unitsSpent?: number
          message?: string
        }
        if (!response.ok) {
          throw new Error(payload.message ?? 'Could not resolve that seed.')
        }
        const found = (payload.candidates ?? []) as Track[]
        if (found.length === 0) {
          throw new Error('Nothing matched that seed.')
        }
        if (cancelled) return
        const chosen = found[0]
        setSeed(chosen)
        setTitle(payload.label ? `${payload.label} radio` : `${chosen.artist} radio`)
        setStage('tune')
        setUnitsSpent((previous) => previous + (payload.unitsSpent ?? 0))
        router.replace('/', { scroll: false })
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : 'Could not resolve that seed.')
        }
      } finally {
        if (!cancelled) setBusy(null)
      }
    }
    void resolve()
    return () => {
      cancelled = true
    }
  }, [searchParams, router])

  // Move focus to the new step heading whenever the stage changes.
  useEffect(() => {
    stageHeadingRef.current?.focus()
  }, [stage])

  const handleJobCompletion = useCallback(() => {
    if (!jobPending) return
    if (job.status === 'succeeded' && job.result) {
      setCreated({
        playlistId: job.result.playlistId,
        playlistUrl: job.result.playlistUrl,
        demo: false,
        ordered: job.result.ordered,
        note: job.note,
      })
      setUnitsSpent((previous) => previous + (job.unitsSpent ?? 0))
      setStage('done')
      setJobPending(false)
      setBusy(null)
      job.reset()
    } else if (job.status === 'failed' || job.status === 'cancelled') {
      setError(job.error?.message ?? 'The playlist could not be created.')
      setJobPending(false)
      setBusy(null)
      job.reset()
    }
  }, [jobPending, job])

  // Watch an async job to completion.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    handleJobCompletion()
  }, [handleJobCompletion])
  /* eslint-enable react-hooks/set-state-in-effect */

  const discoverInFlightRef = useRef(false)

  const runDiscover = useCallback(async () => {
    if (!seed || discoverInFlightRef.current) return
    discoverInFlightRef.current = true
    setBusy('discover')
    setError(null)
    try {
      const response = await fetch('/api/similar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed, options }),
      })
      const payload = (await response.json()) as {
        candidates?: Candidate[]
        unitsSpent?: number
        message?: string
      }
      if (!response.ok) throw new Error(payload.message ?? 'Discovery failed.')
      const found = (payload.candidates ?? []) as Candidate[]
      setCandidates(found)
      setPicked(new Set(found.map((candidate) => candidate.videoId)))
      setUnitsSpent((previous) => previous + (payload.unitsSpent ?? 0))
      setStage('build')
      if (found.length === 0) {
        setError('Nothing cleared the filters. Loosen the version toggles or widen the breadth slider.')
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Discovery failed.')
    } finally {
      discoverInFlightRef.current = false
      setBusy(null)
    }
  }, [options, seed])

  const planInFlightRef = useRef(false)

  const runPlan = useCallback(async () => {
    if (!seed || planInFlightRef.current) return
    planInFlightRef.current = true
    setPlanBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed, options, topN: 10 }),
      })
      const payload = (await response.json()) as PlanResponse & { message?: string }
      if (!response.ok) throw new Error(payload.message ?? 'The plan could not be computed.')
      setPlan(payload)
      setUnitsSpent((previous) => previous + (payload.unitsSpent ?? 0))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The plan could not be computed.')
    } finally {
      planInFlightRef.current = false
      setPlanBusy(false)
    }
  }, [options, seed])

  const createSync = useCallback(
    async (videoIds: string[]) => {
      const response = await fetch('/api/playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoIds, title, description, privacy }),
      })
      const payload = (await response.json()) as CreatedPlaylist & { unitsSpent?: number; message?: string }
      if (!response.ok) throw new Error(payload.message ?? 'The playlist could not be created.')
      setCreated(payload)
      setStage('done')
      setUnitsSpent((previous) => previous + (payload.unitsSpent ?? 0))
    },
    [description, privacy, title],
  )

  const runCreate = useCallback(async () => {
    const chosenCandidates = candidates.filter((candidate) => picked.has(candidate.videoId))
    const videoIds = chosenCandidates.map((candidate) => candidate.videoId)
    if (videoIds.length === 0) {
      setError('Pick at least one track before creating the playlist.')
      return
    }
    setBusy('create')
    setError(null)
    const idempotencyKey = `${Date.now()}-${Math.random().toString(36).slice(2)}`

    try {
      if (videoIds.length >= 20) {
        const result = await job.start({
          videoIds,
          title,
          description,
          privacy,
          idempotencyKey,
        })
        if (result.disabled) {
          await createSync(videoIds)
          setBusy(null)
          return
        }
        if (result.demo) {
          const payload = result.payload as { message?: string; unitsSpent?: number }
          setCreated({
            playlistId: null,
            playlistUrl: null,
            demo: true,
            message: payload.message,
          })
          setUnitsSpent((previous) => previous + (payload.unitsSpent ?? 0))
          setStage('done')
          setBusy(null)
          return
        }
        setJobPending(true)
        // busy stays true until the job settles (watched above)
        return
      }
      await createSync(videoIds)
      setBusy(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The playlist could not be created.')
      setBusy(null)
    }
  }, [candidates, picked, title, description, privacy, job, createSync])

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
  const railUnits = plan
    ? plan.estimate.units + plan.playlistEstimate.units
    : discoveryUnits + playlistUnits

  function toggle(videoId: string) {
    setPicked((current) => {
      const next = new Set(current)
      if (next.has(videoId)) next.delete(videoId)
      else next.add(videoId)
      return next
    })
  }

  /**
   * Reset the whole run. The BYO-key state is deliberately kept: a visitor who
   * pasted their own key should not have to paste it again just because they
   * started a new playlist. Everything else — including the title, options and
   * privacy they tuned — goes back to defaults.
   */
  function reset() {
    try {
      window.sessionStorage.removeItem('playlist-generator-draft')
    } catch {
      // Reset the in-memory run even when storage is unavailable.
    }
    setStage('seed')
    setSeed(null)
    setCandidates([])
    setPicked(new Set())
    setCreated(null)
    setError(null)
    setTitle('')
    setDescription('')
    setOptions({
      ...DEFAULT_OPTIONS,
      blockedArtists: blocks
        .filter((block) => block.kind === 'artist')
        .map((block) => block.value),
      blockedKeywords: blocks
        .filter((block) => block.kind === 'keyword')
        .map((block) => block.value),
    })
    setPrivacy('private')
    setUnitsSpent(0)
    setPlan(null)
    setPlayingId(null)
    job.reset()
  }

  const inLibrary = useCallback(
    (candidate: Candidate) => {
      if (!libraryKeys) return false
      const key = candidate.trackKey ?? `${candidate.artist}::${candidate.title}`
      return libraryKeys.has(key)
    },
    [libraryKeys],
  )

  const sendFeedback = useCallback(async (videoId: string, verdict: 'keep' | 'drop', reason?: string) => {
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId, verdict, reason }),
      })
    } catch {
      // Feedback is best-effort; never block the UI on it.
    }
  }, [])

  const blockArtist = useCallback(async (artist: string) => {
    try {
      const response = await fetch('/api/blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'artist', value: artist }),
      })
      const payload = (await response.json()) as { block?: BlockRow }
      if (response.ok && payload.block) {
        const block = payload.block as BlockRow
        setBlocks((previous) => [...previous, block])
        setOptions((current) => ({
          ...current,
          blockedArtists:
            block.kind === 'artist'
              ? [...current.blockedArtists, block.value]
              : current.blockedArtists,
          blockedKeywords:
            block.kind === 'keyword'
              ? [...current.blockedKeywords, block.value]
              : current.blockedKeywords,
        }))
      }
    } catch {
      // ignore
    }
  }, [])

  const applyPreset = useCallback((preset: PresetRow) => {
    setOptions({ ...DEFAULT_OPTIONS, ...(preset.options as Partial<DiscoveryOptions>) })
  }, [])

  const savePreset = useCallback(async () => {
    if (!presetName.trim()) return
    setPresetSaving(true)
    try {
      const response = await fetch('/api/presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: presetName.trim(), options }),
      })
      const payload = (await response.json()) as { preset?: PresetRow; message?: string }
      if (!response.ok || !payload.preset) {
        setError(payload.message ?? 'The preset could not be saved.')
        return
      }
      setPresets((previous) => {
        const filtered = previous.filter((preset) => preset.name !== payload.preset!.name)
        return [payload.preset as PresetRow, ...filtered]
      })
      setPresetName('')
    } catch {
      setError('The preset could not be saved.')
    } finally {
      setPresetSaving(false)
    }
  }, [options, presetName])

  const liveStatus =
    busy === 'create'
      ? 'Creating playlist…'
      : busy === 'discover'
        ? 'Discovering tracks…'
        : busy === 'plan'
          ? 'Planning…'
          : job.isRunning
            ? 'Job running…'
            : `${chosen.length} tracks selected`

  const saveCta = getSaveCta({ signedIn, configured: authConfigured, liveApi, demo: demoMode })
  const saveCtaAction = getSaveCtaAction(saveCta)

  return (
    <div
      data-ui
      className="flex h-full flex-col border-4 border-ink bg-ink text-paper shadow-[14px_14px_0_0_var(--color-orange)]"
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
          <span className="tnum t-small text-paper/60" aria-live="polite">
            ≈ {formatUnits(railUnits)} units
          </span>
        </div>
      </div>

      {/* aria-live region for quota / progress */}
      <div aria-live="polite" className="sr-only">
        {liveStatus} · approximately {formatUnits(railUnits)} units
      </div>

      <div className="flex-1 overflow-y-auto">
        {stage === 'seed' && (
          <div className="p-5">
            <SeedPicker
              onSeed={(track) => {
                setSeed(track)
                setTitle(`${track.artist} radio`)
                setStage('tune')
              }}
              onUnitsSpent={(units) => setUnitsSpent((previous) => previous + units)}
            />
            {error && <p className="mt-3 t-small text-orange">{error}</p>}
            {busy === 'resolve' && (
              <p className="mt-3 t-small text-paper/65">Resolving seed…</p>
            )}

          </div>
        )}

        {stage === 'tune' && seed && (
          <div className="flex flex-col gap-5 p-5">
            <h2
              ref={stageHeadingRef}
              tabIndex={-1}
              className="t-title font-semibold outline-none"
            >
              Tune the discovery
            </h2>
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

            {/* Presets */}
            <div className="flex flex-col gap-2 border-2 border-paper/20 p-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="t-small font-semibold">Presets</span>
                {presetsLoading && <Loader2 className="size-3.5 animate-spin" />}
              </div>
              <div className="flex flex-wrap gap-2">
                {presets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyPreset(preset)}
                    className="border-2 border-paper/40 px-3 py-1 t-small font-semibold transition-colors hover:border-mint hover:text-mint"
                  >
                    {preset.name}
                  </button>
                ))}
                {presets.length === 0 && !presetsLoading && (
                  <span className="t-small text-paper/60">No presets saved yet.</span>
                )}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={presetName}
                  onChange={(event) => setPresetName(event.target.value)}
                  placeholder="Preset name"
                  aria-label="Preset name"
                  className="border-paper/40 placeholder:text-paper/65 focus-visible:border-mint"
                />
                <Button
                  size="sm"
                  onClick={() => void savePreset()}
                  disabled={presetSaving || !presetName.trim()}
                  className="shrink-0"
                >
                  {presetSaving ? <Loader2 className="size-4 animate-spin" /> : null}
                  Save preset
                </Button>
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
                      checked={Boolean(options[key])}
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

            {/* Library-aware dedupe */}
            <Control label="Library">
              {signedIn === true ? (
                <label className="flex cursor-pointer items-center justify-between gap-4 t-small">
                  <span>
                    Skip tracks I already have
                    {libraryInfo && (
                      <span className="ml-2 text-paper/60">
                        ({libraryInfo.trackKeys} keys · {libraryInfo.scannedPlaylists} playlists)
                      </span>
                    )}
                  </span>
                  <Switch
                    checked={options.skipAlreadyInLibrary}
                    onCheckedChange={(checked) =>
                      setOptions((current) => ({ ...current, skipAlreadyInLibrary: checked }))
                    }
                    aria-label="Skip tracks I already have"
                  />
                </label>
              ) : (
                <p className="t-small text-paper/65">
                  Sign in to compare candidates against your own library.
                </p>
              )}
              {libraryLoading && <p className="t-small text-paper/60">Loading library…</p>}
            </Control>

            {blocks.length > 0 && (
              <p className="t-small text-paper/65">
                Blocklist applied: {blocks.length} {blocks.length === 1 ? 'rule' : 'rules'}.
              </p>
            )}

            {error && <p role="alert" className="t-small text-orange">{error}</p>}

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button onClick={() => void runDiscover()} disabled={busy === 'discover'} block>
                {busy === 'discover' ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                Discover tracks
              </Button>
              <Button
                variant="outline"
                onClick={() => void runPlan()}
                disabled={busy === 'discover' || planBusy || !seed}
              >
                {planBusy ? <Loader2 className="size-4 animate-spin" /> : null}
                Preview cost
              </Button>
              <Button variant="outline" onClick={reset}>
                Change seed
              </Button>
            </div>

            {plan && (
              <div className="flex flex-col gap-2 border-2 border-paper/20 p-3">
                <p className="t-small font-semibold">Cost breakdown</p>
                <ul className="flex flex-col gap-1">
                  {plan.estimate.breakdown.map((row, index) => (
                    <li
                      key={`${row.operation}-${index}`}
                      className="flex items-baseline justify-between gap-3 t-small"
                    >
                      <span className="text-paper/75">{row.label}</span>
                      <span className="tnum shrink-0">
                        {row.count} × {row.units / Math.max(row.count, 1)} = {row.units}
                      </span>
                    </li>
                  ))}
                  <li className="flex items-baseline justify-between gap-3 border-t-2 border-paper/15 pt-1 t-small font-semibold">
                    <span>Discovery total</span>
                    <span className="tnum">{plan.estimate.units} units</span>
                  </li>
                  <li className="flex items-baseline justify-between gap-3 t-small">
                    <span>Playlist write ({plan.playlistEstimate.tracks} tracks)</span>
                    <span className="tnum">{plan.playlistEstimate.units} units</span>
                  </li>
                  <li className="flex items-baseline justify-between gap-3 border-t-2 border-paper/15 pt-1 t-small font-semibold">
                    <span>Grand total</span>
                    <span className="tnum">
                      {plan.estimate.units + plan.playlistEstimate.units} units
                    </span>
                  </li>
                </ul>
                <p className="t-small text-paper/65">{plan.note}</p>
                {plan.preview && plan.preview.length > 0 && (
                  <div className="mt-2 flex flex-col gap-1">
                    <p className="t-small font-semibold">Cached preview</p>
                    <ul className="flex flex-col">
                      {plan.preview.map((track) => (
                        <li
                          key={track.videoId}
                          className="flex items-center gap-2 border-t-2 border-paper/15 py-1.5 t-small"
                        >
                          <span className="truncate">{track.title}</span>
                          <span className="ml-auto shrink-0 text-paper/60">{track.artist}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {stage === 'build' && (
          <div className="flex flex-col gap-4 p-5">
            <div className="flex items-baseline justify-between gap-4">
              <h2
                ref={stageHeadingRef}
                tabIndex={-1}
                className="t-title font-semibold outline-none"
              >
                {chosen.length} tracks ready
              </h2>
              <span className="tnum t-small text-paper/60">
                {Math.round(totalSeconds / 60)} min
              </span>
            </div>

            {candidates.length === 0 && (
              <EmptyState
                title="No candidates yet."
                body="Run discovery from the tune stage. Candidates that clear your filters show up here."
                className="border-paper/30 text-paper"
              />
            )}

            {job.isRunning && <JobProgress progress={job.progress} note={job.note} unitsSpent={job.unitsSpent} />}

            <ul className="flex flex-col">
              {candidates.map((candidate) => {
                const active = picked.has(candidate.videoId)
                const alreadyInLibrary = inLibrary(candidate)
                return (
                  <li
                    key={candidate.videoId}
                    className={cn(
                      'flex flex-col border-t-2 border-paper/15 py-2.5 transition-opacity',
                      !active && 'opacity-45',
                    )}
                  >
                    <div className="flex items-center gap-3">
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
                          {alreadyInLibrary && (
                            <Badge className="ml-2 text-mint">In library</Badge>
                          )}
                        </p>
                        <p className="truncate t-small text-paper/70">{candidate.artist}</p>
                      </div>

                      <span className="tnum hidden shrink-0 t-small text-paper/70 sm:block">
                        {formatDuration(candidate.durationSec)}
                      </span>

                      <span className="tnum w-9 shrink-0 text-right t-small font-semibold text-mint">
                        {Math.round(candidate.score)}
                      </span>

                      <button
                        type="button"
                        onClick={() =>
                          setPlayingId((current) =>
                            current === candidate.videoId ? null : candidate.videoId,
                          )
                        }
                        className="shrink-0 text-paper/70 transition-colors hover:text-mint"
                        aria-label={`Preview ${candidate.title}`}
                      >
                        <CircleHelp className="size-4" />
                      </button>

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

                      {/* Feedback */}
                      <Popover
                        trigger={
                          <button
                            type="button"
                            aria-label={`Feedback for ${candidate.title}`}
                            className="shrink-0 text-paper/70 transition-colors hover:text-mint"
                          >
                            <ThumbsUp className="size-4" />
                          </button>
                        }
                      >
                        <p className="t-small font-semibold">Keep or drop?</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void sendFeedback(candidate.videoId, 'keep')}
                            className="border-2 border-ink px-2 py-1 t-small font-semibold hover:bg-mint"
                          >
                            Keep
                          </button>
                          <Popover
                            trigger={
                              <button
                                type="button"
                                className="border-2 border-ink px-2 py-1 t-small font-semibold hover:bg-orange"
                              >
                                Drop
                              </button>
                            }
                          >
                            <p className="t-small font-semibold">Why drop?</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {FEEDBACK_REASONS.map((reason) => (
                                <button
                                  key={reason}
                                  type="button"
                                  onClick={() =>
                                    void sendFeedback(candidate.videoId, 'drop', reason)
                                  }
                                  className="border-2 border-ink px-2 py-1 t-small hover:bg-orange/80"
                                >
                                  {reason}
                                </button>
                              ))}
                            </div>
                          </Popover>
                        </div>
                      </Popover>

                      <button
                        type="button"
                        onClick={() => void blockArtist(candidate.artist)}
                        className="shrink-0 text-paper/70 transition-colors hover:text-orange"
                        aria-label={`Block ${candidate.artist}`}
                        title="Block this artist"
                      >
                        <ThumbsDown className="size-4" />
                      </button>
                    </div>

                    {playingId === candidate.videoId && (
                      <div className="mt-2">
                        <InlinePlayer
                          videoId={candidate.videoId}
                          title={candidate.title}
                          onClose={() => setPlayingId(null)}
                        />
                      </div>
                    )}
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

              <label className="flex flex-col gap-1.5">
                <span className="t-small font-semibold">Description</span>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={3}
                  className="w-full border-2 border-paper/40 bg-transparent px-3 py-2 t-body text-paper placeholder:text-paper/65 focus-visible:border-mint"
                  placeholder="Optional description for the playlist"
                />
              </label>

              <RadioGroup
                value={privacy}
                onValueChange={(value) => setPrivacy(value as typeof privacy)}
                aria-label="YouTube Music playlist privacy"
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

              <p className="t-small text-paper/65">
                Browse, search, and build your playlist without signing in. {saveCtaAction === 'demo'
                  ? 'Demo mode cannot save to YouTube Music; export your selected tracks instead.'
                  : 'Google sign-in is only needed to save to YouTube Music.'}
              </p>

            {authNotice && <p role="status" aria-live="polite" className="t-small text-mint">{authNotice}</p>}
            {error && <p role="alert" className="t-small text-orange">{error}</p>}

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  onClick={() => {
                    if (saveCtaAction === 'sign-in') {
                      storeGeneratorDraft(window.sessionStorage, {
                        title, description, privacy, seed: seed ?? undefined, candidates, picked: [...picked], options,
                      })
                      // OAuth must complete a full browser round-trip; don't use client routing.
                      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                      window.location.href = '/api/auth/google'
                      return
                    }
                    if (saveCtaAction === 'demo') {
                      const chosenCandidates = candidates.filter((candidate) => picked.has(candidate.videoId))
                      if (chosenCandidates.length === 0) {
                        setError('Pick at least one track before creating the playlist.')
                        return
                      }
                      setError(null)
                      setCreated({
                        playlistId: null,
                        playlistUrl: null,
                        demo: true,
                        message: 'Demo mode: no playlist was created or saved to YouTube. Export your selected tracks below.',
                      })
                      setStage('done')
                      return
                    }
                    if (saveCtaAction !== 'create') return
                    if (privacy === 'public' && !window.confirm('This playlist will be public and visible to anyone. Create it?')) return
                    void runCreate()
                  }}
                  disabled={busy === 'create' || job.isRunning || saveCtaAction === 'none'}
                  block
                >
                  {busy === 'create' || job.isRunning ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
                  {saveCta === 'loading' ? 'Checking sign-in…' : saveCta === 'sign-in' ? 'Sign in to save' : saveCta === 'unavailable' ? 'YouTube save unavailable' : saveCta === 'demo' ? 'Preview demo · export only' : 'Save to YouTube Music'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void runDiscover()}
                  disabled={busy === 'discover'}
                >
                  Re-run
                </Button>
              </div>

              <ExportOptions tracks={chosen} title={title} />
            </div>
          </div>
        )}

        {stage === 'done' && created && (
          <div className="flex flex-col gap-5 p-5">
            <div>
              <Badge className="border-mint text-mint">
                {created.demo ? 'Demo run' : 'Playlist created'}
              </Badge>
              <h2
                ref={stageHeadingRef}
                tabIndex={-1}
                className="mt-3 t-title font-semibold leading-tight outline-none"
              >
                {title}
              </h2>
              <p className="mt-1 t-small text-paper/65">
                {chosen.length} tracks · {Math.round(totalSeconds / 60)} min ·{' '}
                {created.demo ? (
                  <>
                    <span className="tnum">≈ {formatUnits(discoveryUnits + playlistUnits)}</span> units on a
                    live run
                  </>
                ) : (
                  <>
                    <span className="tnum">{formatUnits(unitsSpent)}</span> units spent
                    {typeof created.ordered === 'boolean' && (
                      <span className="ml-2">
                        · {created.ordered ? 'order verified' : 'order not verified'}
                      </span>
                    )}
                  </>
                )}
              </p>
              {created.note && <p className="mt-1 t-small text-paper/60">{created.note}</p>}
            </div>

            {created.demo ? (
              <p className="border-2 border-paper/25 p-4 t-small text-paper/75">
                {created.message ?? 'No playlist was created on YouTube. This is a demo run.'}
              </p>
            ) : (
              <ButtonLink
                href={created.playlistUrl ?? '#'}
                variant="mint"
                block
                target="_blank"
                rel="noreferrer"
              >
                Open in YouTube Music
                <ExternalLink className="size-4" />
              </ButtonLink>
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

            <ExportOptions tracks={chosen} title={title} />

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
