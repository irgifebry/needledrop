'use client'

import { useState } from 'react'
import { Pause, Play, X } from 'lucide-react'

import { Button } from '@/components/ui/button'

/**
 * A tiny inline preview player.
 *
 * The embed uses the privacy-enhanced `youtube-nocookie.com` host and never
 * autoplays: the iframe only starts once the visitor presses play, and pausing
 * unmounts the autoplay flag so the video stops. No audio is ever downloaded
 * until the visitor asks for it.
 */
export function InlinePlayer({
  videoId,
  title,
  onClose,
}: {
  videoId: string
  title?: string
  onClose: () => void
}) {
  const [playing, setPlaying] = useState(false)

  const src = `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1${
    playing ? '&autoplay=1' : ''
  }`

  return (
    <div className="flex flex-col gap-2 border-2 border-paper/20 bg-ink p-2">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate t-small font-semibold">{title ?? 'Preview'}</p>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setPlaying((value) => !value)}
            aria-label={playing ? 'Pause preview' : 'Play preview'}
            className="size-8"
          >
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close preview"
            className="size-8"
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>
      <div className="aspect-video w-full overflow-hidden border-2 border-paper/15">
        <iframe
          key={playing ? 'playing' : 'paused'}
          src={src}
          title={title ?? 'YouTube preview'}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="h-full w-full"
          loading="lazy"
        />
      </div>
    </div>
  )
}