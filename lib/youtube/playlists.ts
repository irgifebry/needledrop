import { youtubeFetch, YouTubeError, type QuotaMeter } from './client'
import type { PlaylistPrivacy } from './types'

const MAX_ATTEMPTS = 3
const BASE_BACKOFF_MS = 500

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function retryAfterMs(error: unknown): number | null {
  const candidate = error as { retryAfter?: unknown; retryAfterMs?: unknown }
  if (typeof candidate?.retryAfterMs === 'number' && candidate.retryAfterMs > 0) {
    return candidate.retryAfterMs
  }
  if (typeof candidate?.retryAfter === 'number' && candidate.retryAfter > 0) {
    return candidate.retryAfter * 1000
  }
  const headers = (error as { headers?: { get?: (name: string) => string | null } })?.headers
  const header = headers?.get?.('Retry-After')
  if (header) {
    const seconds = Number(header)
    if (!Number.isNaN(seconds) && seconds > 0) return seconds * 1000
    const date = Date.parse(header)
    if (!Number.isNaN(date)) {
      const delay = date - Date.now()
      if (delay > 0) return delay
    }
  }
  return null
}

function isRetryable(error: unknown): boolean {
  if (error instanceof YouTubeError) {
    return true
  }
  return error instanceof TypeError
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt === MAX_ATTEMPTS - 1 || !isRetryable(error)) {
        throw error
      }
      const delay = retryAfterMs(error) ?? BASE_BACKOFF_MS * Math.pow(2, attempt)
      await sleep(delay)
    }
  }
  throw lastError
}

type PlaylistInsertResponse = {
  id: string
  snippet?: { title?: string }
}

type PlaylistItemsResponse = {
  items?: Array<{ id?: string; snippet?: { position?: number } }>
}

export type PlaylistInput = {
  videoIds: string[]
  title: string
  description: string
  privacy: PlaylistPrivacy
  tags?: string[]
}

export type PlaylistProgress = {
  step: 'creating' | 'inserting' | 'verifying' | 'done'
  index: number
  of: number
}

export type PlaylistResult = {
  playlistId: string
  playlistUrl: string
  ordered: boolean
  note?: string
}

export async function createPlaylist(
  accessToken: string,
  input: PlaylistInput,
  meter: QuotaMeter,
  onProgress?: (progress: PlaylistProgress) => void,
): Promise<PlaylistResult> {
  const playlist = await withRetry(() =>
    youtubeFetch<PlaylistInsertResponse>(
      'playlists.insert',
      { part: 'snippet,status' },
      meter,
      {
        method: 'POST',
        accessToken,
        body: JSON.stringify({
          snippet: {
            title: input.title,
            description: input.description,
            tags: ['needledrop', 'generated-playlist'],
          },
          status: { privacyStatus: input.privacy },
        }),
      },
    )
  )

  onProgress?.({ step: 'creating', index: 0, of: input.videoIds.length })

  for (const [index, videoId] of input.videoIds.entries()) {
    onProgress?.({ step: 'inserting', index, of: input.videoIds.length })
    await withRetry(() =>
      youtubeFetch(
        'playlistItems.insert',
        { part: 'snippet' },
        meter,
        {
          method: 'POST',
          accessToken,
          body: JSON.stringify({
            snippet: {
              playlistId: playlist.id,
              resourceId: { videoId, kind: 'youtube#video' },
              position: index,
            },
          }),
        },
      ),
    )
  }

  onProgress?.({ step: 'verifying', index: input.videoIds.length, of: input.videoIds.length })
  const verify = await youtubeFetch<PlaylistItemsResponse>(
    'playlistItems.list',
    { playlistId: playlist.id, maxResults: 50, part: 'snippet' },
    meter,
    { accessToken },
  )
  const positions = (verify.items ?? [])
    .map((item) => item.snippet?.position ?? 0)
    .sort((a, b) => a - b)
  const ordered = positions.every((position, index) => position === index)

  const note = ordered
    ? undefined
    : 'Final order could not be fully verified; the playlist was still created.'

  onProgress?.({ step: 'done', index: input.videoIds.length, of: input.videoIds.length })

  return {
    playlistId: playlist.id,
    playlistUrl: `https://music.youtube.com/playlist?list=${playlist.id}`,
    ordered,
    note,
  }
}