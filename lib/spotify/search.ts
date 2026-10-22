import { spotifyFetch, parsePlaylistId } from './client'
export { parsePlaylistId }
import type { SpotifyTrack } from './types'

type SpotifyApiTrack = {
  id: string
  name: string
  artists?: Array<{ name: string }>
  album?: { name?: string; images?: Array<{ url: string }> }
  duration_ms: number
  external_urls?: { spotify?: string }
  preview_url?: string | null
}

function mapTrack(t: SpotifyApiTrack): SpotifyTrack {
  return {
    id: t.id,
    title: t.name,
    artist: (t.artists ?? []).map((a) => a.name).join(', '),
    album: t.album?.name ?? '',
    durationMs: t.duration_ms,
    spotifyUrl: t.external_urls?.spotify ?? `https://open.spotify.com/track/${t.id}`,
    previewUrl: t.preview_url ?? undefined,
    imageUrl: t.album?.images?.[0]?.url,
  }
}

export async function searchTracks(query: string, limit = 20): Promise<SpotifyTrack[]> {
  const data = await spotifyFetch<{
    tracks?: { items?: SpotifyApiTrack[] }
  }>('/v1/search', { q: query, type: 'track', limit })

  return (data.tracks?.items ?? []).map(mapTrack)
}

export async function getPlaylistTracks(playlistIdOrUrl: string): Promise<SpotifyTrack[]> {
  const id = parsePlaylistId(playlistIdOrUrl)
  if (!id) {
    throw new Error('Invalid Spotify playlist id.')
  }

  const tracks: SpotifyTrack[] = []
  let offset = 0
  const limit = 100

  // Paginate through all items.
  while (true) {
    const data = await spotifyFetch<{
      items?: Array<{ track?: SpotifyApiTrack | null }>
      next?: string | null
      total?: number
    }>(`/v1/playlists/${id}/tracks`, { limit, offset })

    for (const item of data.items ?? []) {
      if (item?.track) tracks.push(mapTrack(item.track))
    }

    if (!data.next) break
    offset += limit
    if (offset >= (data.total ?? Infinity)) break
  }

  return tracks
}
