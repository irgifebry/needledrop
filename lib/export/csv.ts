/**
 * CSV rendering (PLAN §13.9 "Output · Export", §27.2).
 *
 * RFC 4180: every field is quoted, inner quotes are doubled and records are
 * separated by CRLF. That is the combination Excel, Numbers and Google Sheets
 * all read without a "wrong delimiter" dialog. Pure: no I/O.
 */

import type { Track } from '@/lib/youtube/types'

export type CsvOptions = {
  /** Emit the header row. Default true — a headerless CSV is a guessing game. */
  includeHeader?: boolean
}

/** Column order is part of the contract: other tools parse this file. */
const COLUMNS = [
  'position',
  'videoId',
  'title',
  'artist',
  'channelTitle',
  'durationSec',
  'year',
  'url',
] as const

/**
 * Renders a track list as CSV.
 *
 * ```
 * position,videoId,title,artist,channelTitle,durationSec,year,url
 * "1","dQw4w9WgXcQ","Title","Artist","Channel","225","2010","https://…"
 * ```
 */
export function toCsv(tracks: Track[], options: CsvOptions = {}): string {
  const includeHeader = options.includeHeader ?? true
  const rows: string[] = []

  if (includeHeader) rows.push(COLUMNS.join(','))

  tracks.forEach((track, index) => {
    const videoId = safeVideoId(track.videoId)
    const fields = [
      String(index + 1),
      videoId,
      oneLine(track.title),
      oneLine(track.artist),
      oneLine(track.channelTitle),
      String(Math.max(0, Math.round(track.durationSec))),
      yearOf(track.publishedAt),
      `https://music.youtube.com/watch?v=${videoId}`,
    ]
    rows.push(fields.map(quote).join(','))
  })

  return `${rows.join('\r\n')}\r\n`
}

/** RFC 4180 quoting: wrap the field and double any inner quote. */
function quote(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

/** Keeps a record on one line so the row count stays predictable. */
function oneLine(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').trim()
}

/**
 * The publication year, or an empty cell when the date is missing or
 * unparseable. A blank cell is honest; a fabricated year is not. UTC is used
 * so the same date always yields the same year regardless of server locale.
 */
function yearOf(publishedAt: string): string {
  if (!publishedAt) return ''
  const date = new Date(publishedAt)
  if (Number.isNaN(date.getTime())) return ''
  return String(date.getUTCFullYear())
}

/**
 * A YouTube video id is `[A-Za-z0-9_-]`; anything else is dropped so a hostile
 * payload cannot inject extra columns or rows into the generated file.
 */
function safeVideoId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '')
}
