import Link from 'next/link'

import { PlaylistCover } from '@/components/library/playlist-cover'
import { PrivacyBadge } from '@/components/library/privacy-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { PlaylistSummary } from '@/lib/youtube/playlist-lifecycle'

/**
 * One row of the library list.
 *
 * The row is a single link to the playlist's editor, so the whole surface
 * is clickable. The "Make one like this" action is a separate button that
 * stops propagation and hands off to the generator through the URL — it does
 * not live inside the link.
 */

export function PlaylistRow({
  playlist,
  onMakeLikeThis,
}: {
  playlist: PlaylistSummary
  onMakeLikeThis: (playlist: PlaylistSummary) => void
}) {
  return (
    <div className="grid grid-cols-12 items-center gap-[var(--gap)] border-b-2 border-ink/10 px-4 py-4 last:border-b-0">
      <Link
        href={`/library/${playlist.id}`}
        className="col-span-12 flex min-w-0 items-center gap-4 lg:col-span-7"
      >
        <PlaylistCover thumbnail={playlist.thumbnail} title={playlist.title} size="sm" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="t-title min-w-0 break-words font-semibold leading-tight">
              {playlist.title}
            </h2>
            {playlist.lineage !== null ? (
              <Badge className="text-mint">
                Made here{playlist.lineage.version ? ` · v${playlist.lineage.version}` : ''}
              </Badge>
            ) : null}
          </div>
          <p className="t-small mt-1 text-ink/60">
            {playlist.itemCount} {playlist.itemCount === 1 ? 'track' : 'tracks'}
            {playlist.description ? ` · ${playlist.description.slice(0, 60)}` : ''}
          </p>
        </div>
      </Link>

      <div className="col-span-12 flex flex-wrap items-center justify-end gap-3 lg:col-span-5">
        <PrivacyBadge privacy={playlist.privacy} />
        <Button
          variant="outline"
          size="sm"
          onClick={(event) => {
            event.preventDefault()
            onMakeLikeThis(playlist)
          }}
        >
          Make one like this
        </Button>
      </div>
    </div>
  )
}