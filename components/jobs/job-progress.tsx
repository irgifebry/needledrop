'use client'

import { Loader2 } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { JobProgress } from '@/lib/jobs/types'

/**
 * Visual progress for an async playlist-creation job.
 *
 * The bar is driven by `index / of`; the status line is the contract's
 * `step` so the visitor sees which of the four phases the worker is in.
 * The whole block is `aria-live="polite"` so screen readers announce the
 * moving numbers without stealing focus.
 */
export function JobProgress({
  progress,
  note,
  unitsSpent,
  className,
}: {
  progress: JobProgress | null
  note?: string
  unitsSpent?: number
  className?: string
}) {
  const percent =
    progress && progress.of > 0
      ? Math.min(100, Math.round((progress.index / progress.of) * 100))
      : 0

  return (
    <div
      className={cn('flex flex-col gap-2 border-2 border-paper/20 p-3', className)}
      aria-live="polite"
      role="status"
    >
      <div className="flex items-baseline justify-between gap-3 t-small">
        <span className="font-semibold">
          {progress ? stepLabel(progress.step, progress.status) : 'Queuing…'}
        </span>
        <span className="tnum text-paper/70">
          {progress ? `${progress.index} / ${progress.of}` : '—'}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden border-2 border-paper/20 bg-paper/10">
        <div
          className="h-full bg-mint transition-[width] duration-200"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="flex items-baseline justify-between gap-3 t-small text-paper/60">
        <span>
          {progress?.etaSec ? `≈ ${progress.etaSec}s remaining` : 'Working on it…'}
        </span>
        {typeof unitsSpent === 'number' && (
          <span className="tnum">{unitsSpent.toLocaleString('en-US')} units</span>
        )}
      </div>
      {progress?.status === 'running' && (
        <Loader2 className="size-4 animate-spin self-end text-mint" aria-hidden="true" />
      )}
      {note && <p className="t-small text-paper/70">{note}</p>}
      {progress?.error && (
        <p className="t-small text-orange">
          {progress.error.code}: {progress.error.message}
        </p>
      )}
    </div>
  )
}

function stepLabel(step: JobProgress['step'], status: JobProgress['status']): string {
  if (status === 'succeeded') return 'Done'
  if (status === 'failed') return 'Failed'
  if (status === 'cancelled') return 'Cancelled'
  switch (step) {
    case 'creating':
      return 'Creating playlist'
    case 'inserting':
      return 'Adding tracks'
    case 'verifying':
      return 'Verifying order'
    case 'done':
      return 'Done'
    default:
      return 'Working'
  }
}