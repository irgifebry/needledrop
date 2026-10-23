'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

import { PlaylistCover } from '@/components/library/playlist-cover'
import { PrivacyBadge } from '@/components/library/privacy-badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { formatDuration } from '@/lib/format'
import type { PlaylistItemSummary, PlaylistSummary } from '@/lib/youtube/playlist-lifecycle'

/**
 * The playlist editor — the "mature" half of the product.
 *
 * A playlist is not write-once here: it can be renamed, re-described, re-tagged,
 * re-ordered, trimmed and deleted. Every one of those is a real YouTube API
 * call with a real cost, so each is confirmed or at least announced before it
 * is fired. The partial-failure array from the items route is surfaced inline
 * rather than swallowed, because a playlist that is half-updated is more
 * useful than a 500 with no explanation.
 */

type EditorState = {
  playlist: PlaylistSummary
  items: PlaylistItemSummary[]
  truncated: boolean
}

export function PlaylistEditor({ playlistId }: { playlistId: string }) {
  const router = useRouter()
  const [state, setState] = useState<EditorState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [mutating, setMutating] = useState(false)
  const mutationLock = useRef(false)
  const [attempt, setAttempt] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [failed, setFailed] = useState<Array<{ id: string; reason: string }>>([])

  // Draft fields for the metadata form.
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState('')
  const [privacy, setPrivacy] = useState<'private' | 'unlisted' | 'public'>('private')
  const [confirmPublic, setConfirmPublic] = useState(false)

  const loadPlaylist = useCallback(async (isCancelled: () => boolean) => {
    try {
        const response = await fetch(`/api/playlists/${playlistId}`)
        const payload = await response.json().catch(() => null)
        if (isCancelled()) return
        setError(null)
        setNotice(null)
        setFailed([])
        setStatus(response.status)
        if (!response.ok) {
          setError(
            (payload && typeof payload.message === 'string' && payload.message) ||
              'This playlist could not be loaded.',
          )
          setState(null)
          return
        }
        const next: EditorState = {
          playlist: payload.playlist,
          items: payload.items,
          truncated: Boolean(payload.truncated),
        }
        setState(next)
        setTitle(next.playlist.title)
        setDescription(next.playlist.description)
        setTags('')
        setPrivacy(next.playlist.privacy)
    } catch {
        if (isCancelled()) return
        setError('This playlist could not be loaded. Check your connection and try again.')
    } finally {
        if (!isCancelled()) setLoading(false)
    }
  }, [playlistId])

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => void loadPlaylist(() => cancelled), 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [playlistId, attempt, loadPlaylist])

  const tagList = useMemo(
    () =>
      tags
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    [tags],
  )

  const dirty =
    !!state &&
    (title !== state.playlist.title ||
      description !== state.playlist.description ||
      privacy !== state.playlist.privacy ||
      tagList.join(',') !== '')

  async function saveMetadata() {
    if (mutationLock.current) return
    if (!state) return
    if (privacy === 'public' && !confirmPublic) {
      setNotice('Publishing is effectively irreversible. Tick the confirmation to save as public.')
      return
    }
    mutationLock.current = true
    setSaving(true)
    setNotice(null)
    setFailed([])
    try {
      const response = await fetch(`/api/playlists/${playlistId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: title.trim() || state.playlist.title,
          description,
          tags: tagList,
          privacy,
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        setNotice(
          (payload && typeof payload.message === 'string' && payload.message) ||
            'The playlist could not be saved.',
        )
        return
      }
      setState((previous) =>
        previous ? { ...previous, playlist: payload.playlist } : previous,
      )
      setNotice('Saved.')
      setConfirmPublic(false)
    } catch {
      setNotice('The playlist could not be saved. Check your connection and try again.')
    } finally {
      mutationLock.current = false
      setSaving(false)
    }
  }

  async function moveItem(index: number, direction: -1 | 1) {
    if (mutationLock.current) return
    if (!state) return
    const target = index + direction
    if (target < 0 || target >= state.items.length) return
    const next = [...state.items]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    // `order` holds VIDEO ids, not playlist item ids.
    const order = next.map((item) => item.videoId)
    mutationLock.current = true
    setMutating(true)
    setNotice(null)
    setFailed([])
    try {
      const response = await fetch(`/api/playlists/${playlistId}/items`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ order }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        setNotice(
          (payload && typeof payload.message === 'string' && payload.message) ||
            'The reorder could not be applied.',
        )
        return
      }
      setState((previous) =>
        previous
          ? {
              ...previous,
              items: payload.items,
              truncated: Boolean(payload.truncated),
            }
          : previous,
      )
      if (Array.isArray(payload.failed) && payload.failed.length > 0) {
        setFailed(payload.failed)
      }
    } catch {
      setNotice('The reorder could not be applied. Check your connection and try again.')
    } finally {
      mutationLock.current = false
      setMutating(false)
    }
  }

  async function removeItem(item: PlaylistItemSummary) {
    if (mutationLock.current) return
    if (!state) return
    // `remove` holds PLAYLIST ITEM ids (`item.id`), NOT video ids.
    mutationLock.current = true
    setMutating(true)
    setNotice(null)
    setFailed([])
    try {
      const response = await fetch(`/api/playlists/${playlistId}/items`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ remove: [item.id] }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        setNotice(
          (payload && typeof payload.message === 'string' && payload.message) ||
            'That track could not be removed.',
        )
        return
      }
      setState((previous) =>
        previous
          ? {
              ...previous,
              items: payload.items,
              truncated: Boolean(payload.truncated),
            }
          : previous,
      )
      if (Array.isArray(payload.failed) && payload.failed.length > 0) {
        setFailed(payload.failed)
      }
    } catch {
      setNotice('That track could not be removed. Check your connection and try again.')
    } finally {
      mutationLock.current = false
      setMutating(false)
    }
  }

  async function deletePlaylist() {
    if (mutationLock.current) return
    mutationLock.current = true
    setMutating(true)
    setNotice(null)
    try {
      const response = await fetch(`/api/playlists/${playlistId}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        setNotice(
          (payload && typeof payload.message === 'string' && payload.message) ||
            'The playlist could not be deleted.',
        )
        return
      }
      router.push('/library')
      router.refresh()
    } catch {
      setNotice('The playlist could not be deleted. Check your connection and try again.')
    } finally {
      mutationLock.current = false
      setMutating(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="h-6 w-1/2" />
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="grid grid-cols-12 items-center gap-[var(--gap)] py-3">
            <Skeleton className="col-span-1 h-10 w-10" />
            <div className="col-span-11 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (error || !state) {
    return (
      <div className="border-2 border-ink bg-paper p-6">
        <p className="t-title font-semibold">
          {status === 404 ? 'That playlist is not here.' : 'This playlist could not be loaded.'}
        </p>
        <p className="t-body mt-3 text-ink/75">
          {status === 404
            ? 'It may have been deleted, or it does not belong to this account.'
            : status === 403
              ? 'Your Google account cannot read your YouTube playlists. Sign in again and allow playlist access.'
              : status === 401
                ? 'Sign in with Google to open this playlist.'
                : error}
        </p>
         {status === 401 ? (
          <a href="/api/auth/google" className="mt-5 inline-flex">
            <button type="button" className="h-11 border-2 border-ink bg-ink px-5 t-body font-semibold text-paper hover:bg-orange hover:text-ink">
              Sign in with Google
            </button>
          </a>
         ) : null}
         {status === 403 ? <a href="/api/auth/google" className="mt-5 inline-flex h-11 items-center border-2 border-ink px-5 t-body font-semibold">Review Google permissions</a> : null}
          {status !== 401 && status !== 403 && status !== 404 ? <button type="button" className="mt-5 h-11 border-2 border-ink px-5 t-body font-semibold" onClick={() => { setLoading(true); setAttempt((value) => value + 1) }}>Retry</button> : null}
      </div>
    )
  }

  const playlist = state.playlist

  return (
    <div>
      <Link href="/library" className="mb-6 inline-flex min-h-11 items-center border-2 border-ink px-4 t-body font-semibold hover:bg-ink hover:text-paper">← Back to library</Link>
      <div className="grid grid-cols-12 items-start gap-[var(--gap)]">
        <div className="col-span-12 lg:col-span-4">
          <PlaylistCover thumbnail={playlist.thumbnail} title={playlist.title} size="lg" />
        </div>
        <div className="col-span-12 lg:col-span-8">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="display t-headline leading-none">{playlist.title}</h1>
            <PrivacyBadge privacy={playlist.privacy} />
            {playlist.lineage !== null ? (
              <span className="t-small text-ink/60">
                Made here{playlist.lineage.version ? ` · v${playlist.lineage.version}` : ''}
                {playlist.lineage.run ? ` · run ${playlist.lineage.run.slice(0, 8)}` : ''}
              </span>
            ) : null}
          </div>
          <p className="t-body mt-3 text-ink/70">
            {playlist.itemCount} {playlist.itemCount === 1 ? 'track' : 'tracks'} ·{' '}
            {playlist.description || 'No description yet.'}
          </p>
          {state.truncated ? (
            <p className="t-small mt-2 text-orange">
              The track list is longer than the API returned in one pass, so only the first part is
              shown here.
            </p>
          ) : null}
        </div>
      </div>

      {/* Metadata editor */}
      <section className="mt-10 border-2 border-ink bg-paper p-6">
        <h2 className="t-title font-semibold">Details</h2>
        <p className="t-small mt-2 text-ink/60">
          Each save costs 50 quota units (one playlists.update). The lineage marker in the
          description is preserved automatically.
        </p>
        <div className="mt-6 grid grid-cols-12 gap-[var(--gap)]">
          <div className="col-span-12 lg:col-span-6">
            <label htmlFor="playlist-title" className="t-small font-semibold">
              Title
            </label>
            <Input
              id="playlist-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="mt-2"
            />
          </div>
          <div className="col-span-12 lg:col-span-6">
            <label htmlFor="playlist-privacy" className="t-small font-semibold">
              Visibility
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              {(['private', 'unlisted', 'public'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setPrivacy(value)
                    if (value !== 'public') setConfirmPublic(false)
                  }}
                  className={`h-11 border-2 px-4 t-small font-semibold transition-colors ${
                    privacy === value
                      ? 'border-mint bg-mint text-ink'
                      : 'border-ink/40 hover:border-ink'
                  }`}
                >
                  {value === 'private' ? 'Private' : value === 'unlisted' ? 'Unlisted' : 'Public'}
                </button>
              ))}
            </div>
            {privacy === 'public' ? (
              <label className="mt-3 flex items-start gap-3 t-small text-ink/75">
                <input
                  type="checkbox"
                  checked={confirmPublic}
                  onChange={(event) => setConfirmPublic(event.target.checked)}
                  className="mt-1"
                />
                <span>
                  I understand this makes the playlist public and discoverable. It is effectively
                  irreversible.
                </span>
              </label>
            ) : null}
          </div>
          <div className="col-span-12">
            <label htmlFor="playlist-description" className="t-small font-semibold">
              Description
            </label>
            <Textarea
              id="playlist-description"
              value={description}
              onChange={(event: { target: { value: string } }) => setDescription(event.target.value)}
              className="mt-2"
            />
          </div>
          <div className="col-span-12">
            <label htmlFor="playlist-tags" className="t-small font-semibold">
              Tags (comma separated)
            </label>
            <Input
              id="playlist-tags"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="focus, lo-fi, night"
              className="mt-2"
            />
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button
            variant="mint"
            size="md"
             disabled={!dirty || saving || mutating}
            onClick={() => void saveMetadata()}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
           {notice ? <p role="status" aria-live="polite" className="t-small text-ink/70">{notice}</p> : null}
        </div>
      </section>

      {/* Track list */}
      <section className="mt-10">
        <div className="flex items-end justify-between gap-4">
          <h2 className="display t-headline leading-none">Tracks</h2>
          <p className="t-small text-ink/60">
            Move up / move down to reorder. Each move costs 50 quota units.
          </p>
        </div>

        {state.items.length === 0 ? (
          <div className="mt-6">
            <EmptyState
              title="No tracks in this playlist."
              body="Add some from the generator, or remove the playlist if it is no longer useful."
            />
          </div>
        ) : (
          <div className="mt-6 border-2 border-ink">
            {state.items.map((item, index) => (
              <div
                key={item.id}
                className="grid grid-cols-12 items-center gap-[var(--gap)] border-b-2 border-ink/10 px-3 py-3 last:border-b-0"
                title={item.rawTitle !== item.title ? item.rawTitle : undefined}
              >
                <div className="col-span-1 tnum t-small text-ink/60">{item.position + 1}</div>
                <div className="col-span-1">
                  <PlaylistCover thumbnail={item.thumbnail} title={item.title} size="sm" />
                </div>
                <div className="col-span-6 min-w-0 lg:col-span-5">
                  <p className="t-body font-semibold leading-tight">{item.title}</p>
                  <p className="t-small text-ink/60">
                    {item.artist}
                    {item.channelTitle ? ` · ${item.channelTitle}` : ''}
                  </p>
                </div>
                <div className="col-span-2 tnum t-small text-ink/60">
                  {formatDuration(item.durationSec)}
                </div>
                <div className="col-span-2 flex items-center justify-end gap-1">
                  <button
                    type="button"
                    aria-label={`Move ${item.title} up`}
                     disabled={index === 0 || mutating}
                    onClick={() => void moveItem(index, -1)}
                    className="flex size-9 items-center justify-center border-2 border-ink/40 text-ink transition-colors hover:border-ink disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${item.title} down`}
                     disabled={index === state.items.length - 1 || mutating}
                    onClick={() => void moveItem(index, 1)}
                    className="flex size-9 items-center justify-center border-2 border-ink/40 text-ink transition-colors hover:border-ink disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                     aria-label={`Remove ${item.title}`}
                     disabled={mutating}
                    onClick={() => void removeItem(item)}
                    className="flex size-9 items-center justify-center border-2 border-ink/40 text-ink transition-colors hover:border-orange hover:text-orange"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {failed.length > 0 ? (
          <div className="mt-4 border-2 border-orange bg-paper p-4">
            <p className="t-small font-semibold text-orange">
              {failed.length} {failed.length === 1 ? 'change' : 'changes'} could not be applied:
            </p>
            <ul className="mt-2 space-y-1">
              {failed.map((entry) => (
                <li key={entry.id} className="t-small text-ink/75">
                  {entry.id}: {entry.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {/* Delete */}
      <section className="mt-10 border-t-2 border-ink/15 pt-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="t-title font-semibold">Delete this playlist</h2>
            <p className="t-small mt-2 max-w-[60ch] text-ink/60">
              This deletes the playlist on YouTube. It cannot be undone. The tracks themselves are
              not affected — only the list that pointed at them.
            </p>
          </div>
          <Dialog>
            <DialogTrigger asChild>
              <button
                type="button"
                className="h-11 border-2 border-orange px-5 t-body font-semibold text-orange transition-colors hover:bg-orange hover:text-ink"
              >
                Delete playlist
              </button>
            </DialogTrigger>
            <DialogContent>
              <DialogTitle>Delete this playlist?</DialogTitle>
              <DialogDescription>
                This removes the playlist from your YouTube account. It cannot be undone.
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
                  disabled={mutating}
                  onClick={() => void deletePlaylist()}
                  className="h-11 border-2 border-orange bg-orange px-5 t-body font-semibold text-ink transition-colors hover:bg-ink hover:text-orange"
                >
                  Delete for good
                </button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </section>
    </div>
  )
}
