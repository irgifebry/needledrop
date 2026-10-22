'use client'

import { Download } from 'lucide-react'

import { renderExport, type ExportFormat } from '@/lib/export'
import type { Track } from '@/lib/youtube/types'

/**
 * "Take the list with you" — the export row.
 *
 * This is the path that works without a Google account. Creating a playlist
 * needs a signed-in user and a quota budget; exporting needs neither. The
 * renderers are pure and already ship in the server bundle, so the file is
 * produced in the browser with no network round-trip and no quota — which
 * also means it still works when the YouTube API is down, which is exactly
 * when a user wants to save the list they already have.
 *
 * The formats are deliberately metadata and links only: no audio is ever
 * fetched, and the files are local copies of the YouTube tracklist.
 */

const FORMATS: Array<{ id: ExportFormat; label: string; hint: string }> = [
  { id: 'm3u', label: 'm3u', hint: 'A local playlist file' },
  { id: 'csv', label: 'csv', hint: 'The tracklist as a spreadsheet' },
  { id: 'json', label: 'json', hint: 'Every field, for rebuilding the list elsewhere' },
  { id: 'text', label: 'txt', hint: 'A plain list you can paste anywhere' },
]

export function ExportOptions({
  tracks,
  title,
  heading = 'Take the list with you',
}: {
  tracks: Track[]
  title?: string
  heading?: string
}) {
  function download(format: ExportFormat) {
    if (tracks.length === 0) return

    const rendered = renderExport(format, tracks, {
      title: title ?? '',
      generatedAt: new Date().toISOString(),
    })

    const blob = new Blob([rendered.body], { type: rendered.contentType })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = rendered.filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    // The object URL is revoked right after the click: the download has
    // already been handed to the browser, and holding the blob alive would
    // keep the whole tracklist in memory for the life of the page.
    URL.revokeObjectURL(url)
  }

  if (tracks.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3 t-small">
        <span className="font-semibold">{heading}</span>
        <span className="text-paper/65">Free · no quota</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {FORMATS.map((format) => (
          <button
            key={format.id}
            type="button"
            onClick={() => download(format.id)}
            title={format.hint}
            className="inline-flex h-9 items-center gap-1.5 border-2 border-paper/40 px-3 t-small font-semibold transition-colors hover:border-mint hover:text-mint"
          >
            <Download className="size-3.5 shrink-0" />
            {format.label}
          </button>
        ))}
      </div>
      <p className="t-small text-paper/60">
        Metadata and links only — no audio is downloaded. Download the list for your records or
        playlist saving in needledrop is to YouTube Music.
      </p>
    </div>
  )
}
