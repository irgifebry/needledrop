'use client'

import { useState } from 'react'
import Image from 'next/image'

/**
 * A playlist's cover.
 *
 * The Data API does not return a cover image for a user playlist — it
 * returns a `thumbnail` only when YouTube has generated one, which is not
 * guaranteed for a freshly created playlist. So the fallback is not a
 * broken image tag: it is a flat mint/ink block built from the playlist's
 * first letter, which is honest about "no thumbnail exists yet" rather
 * than silently loading a 404.
 *
 * YouTube also answers "no thumbnail" with a placeholder URL that itself
 * 404s (`i.ytimg.com/img/no_thumbnail.jpg`). That URL is truthy, so it
 * has to be rejected explicitly — otherwise the fallback never triggers
 * and the browser shows a broken image.
 */

export function isUsableThumbnail(thumbnail: string | undefined): thumbnail is string {
  if (!thumbnail) return false
  return !/no_thumbnail/i.test(thumbnail)
}

export function PlaylistCover({
  thumbnail,
  title,
  size = 'md',
}: {
  thumbnail?: string
  title: string
  size?: 'sm' | 'md' | 'lg'
}) {
  const dim = size === 'sm' ? 40 : size === 'lg' ? 72 : 56
  const initial = (title.trim().charAt(0) || '?').toUpperCase()

  const [failedFor, setFailedFor] = useState<string | undefined>(undefined)
  const failed = failedFor === thumbnail

  if (isUsableThumbnail(thumbnail) && !failed) {
    return (
      <Image
        src={thumbnail}
        alt=""
        width={dim}
        height={dim}
        className="shrink-0 border-2 border-current object-cover"
        style={{ width: dim, height: dim }}
        onError={() => setFailedFor(thumbnail)}
      />
    )
  }

  return (
    <div
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center border-2 border-current bg-mint text-ink"
      style={{ width: dim, height: dim }}
    >
      <span className="display t-sub leading-none">{initial}</span>
    </div>
  )
}