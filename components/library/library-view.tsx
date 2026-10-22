'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import { PlaylistRow } from '@/components/library/playlist-row'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import type { PlaylistSummary } from '@/lib/youtube/playlist-lifecycle'

/**
 * The library data island.
 *
 * `GET /api/library` needs a signed-in Google session. The page shell is a
 * server component so it can render the signed-out state without a fetch;
 * this client component takes over once we know there is a session and handles
 * loading, empty, error and success.
 *
 * The library is a view of the user's *own* YouTube account, so the signed-out
 * state is the honest one — a broken list behind a 401 would be worse than
 * telling the visitor what the library is for.
 */

type LibraryResponse = {
  playlists: PlaylistSummary[]
  generated: string[]
  duplicateIndex: {
    trackKeys: number
    scannedPlaylists: number
    scannedItems: number
    maxPlaylists: number
    maxItems: number
    truncated: boolean
    keys: string[]
  }
  unitsSpent: number
  calls: number
  requestId?: string
}

export function LibraryView({ signedIn }: { signedIn: boolean }) {
  const router = useRouter()
  const [data, setData] = useState<LibraryResponse | null>(null)
  const [loading, setLoading] = useState(signedIn)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<number | null>(null)

  useEffect(() => {
    if (!signedIn) return
    let cancelled = false
    fetch('/api/library')
      .then((response) =>
        response
          .json()
          .catch(() => null)
          .then((payload) => ({ response, payload })),
      )
      .then(({ response, payload }) => {
        if (cancelled) return
        setStatus(response.status)
        if (!response.ok) {
          setError(
            (payload && typeof payload.message === 'string' && payload.message) ||
              'The library could not be loaded.',
          )
          setData(null)
          return
        }
        setData(payload as LibraryResponse)
      })
      .catch(() => {
        if (cancelled) return
        setError('The library could not be loaded. Check your connection and try again.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [signedIn])

  if (!signedIn) {
    return (
      <EmptyState
        title="Your playlists live on YouTube."
        body="The library is a view of the playlists on your own YouTube account. Sign in with Google and the ones you made here — and the ones you made yourself — show up in one place."
        action={
          <a href="/api/auth/google" className="inline-flex">
            <button type="button" className="h-11 border-2 border-ink bg-ink px-5 t-body font-semibold text-paper hover:bg-orange hover:text-ink">
              Sign in with Google
            </button>
          </a>
        }
      />
    )
  }

  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="grid grid-cols-12 items-center gap-[var(--gap)] py-4">
            <Skeleton className="col-span-1 h-10 w-10" />
            <div className="col-span-11 space-y-2">
              <Skeleton className="h-5 w-2/5" />
              <Skeleton className="h-4 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="border-2 border-ink bg-paper p-6">
        <p className="t-title font-semibold">
          {status === 403 ? 'Playlist access is not allowed.' : 'The library could not be loaded.'}
        </p>
        <p className="t-body mt-3 text-ink/75">
          {status === 403
            ? 'Your Google account cannot read your YouTube playlists. Sign in again and allow playlist access.'
            : error}
        </p>
        {status === 401 ? (
          <a href="/api/auth/google" className="mt-5 inline-flex">
            <button type="button" className="h-11 border-2 border-ink bg-ink px-5 t-body font-semibold text-paper hover:bg-orange hover:text-ink">
              Sign in with Google
            </button>
          </a>
        ) : null}
      </div>
    )
  }

  if (!data || data.playlists.length === 0) {
    return (
      <EmptyState
        title="No playlists yet."
        body="Generate one from the home page and it shows up here. Playlists you make on YouTube itself appear too — they just will not carry the 'Made here' badge."
      />
    )
  }

  const index = data.duplicateIndex

  return (
    <div>
      <div className="mb-8 grid grid-cols-12 gap-[var(--gap)]">
        <div className="col-span-12 lg:col-span-7">
          <p className="t-body text-ink/75">
            {index.scannedPlaylists} of {Math.max(index.scannedPlaylists, index.maxPlaylists)} playlists
            scanned, {index.scannedItems} tracks, {index.trackKeys} unique keys. The app compares
            candidates against this index when &quot;skip tracks I already have&quot; is on.
          </p>
          {index.truncated ? (
            <p className="t-small mt-2 text-orange">
              The scan stopped after {index.maxPlaylists} playlists, so the count is a floor, not
              the total. A user with more playlists than that will see more matches than the index
              suggests.
            </p>
          ) : null}
        </div>
      </div>

      <div className="border-2 border-ink">
        {data.playlists.map((playlist) => (
          <PlaylistRow
            key={playlist.id}
            playlist={playlist}
            onMakeLikeThis={(target) => {
              // Hand off to the generator through the URL. The generator is
              // responsible for resolving this playlist into a centroid; see
              // the report for the matching gap on the generator side.
              router.push(`/?seed=${encodeURIComponent(target.id)}`)
            }}
          />
        ))}
      </div>
    </div>
  )
}