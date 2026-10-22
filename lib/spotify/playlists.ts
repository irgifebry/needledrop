import { getClientCredentialsToken, SpotifyError } from './client'

const API_BASE = 'https://api.spotify.com'

async function spotifyApiFetch<T>(
  path: string,
  params?: Record<string, string | number | undefined | null>,
  init?: RequestInit,
  accessToken?: string,
): Promise<T> {
  const token = accessToken ?? (await getClientCredentialsToken())
  const url = new URL(path.startsWith('http') ? path : `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`)
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value))
      }
    }
  }

  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    let body: unknown
    try {
      body = await response.json()
    } catch {
      body = await response.text().catch(() => null)
    }
    const errorBody = body as { error?: { status?: number; message?: string } } | null
    const message = errorBody?.error?.message ?? (typeof body === 'string' ? body : response.statusText)
    throw new SpotifyError(message || 'Spotify request failed.', String(errorBody?.error?.status ?? 'spotify_error'), response.status)
  }

  if (response.status === 204) {
    return undefined as T
  }
  return (await response.json()) as T
}

export async function createPlaylist(
  name: string,
  trackUris: string[],
  accessToken: string,
): Promise<{ id: string; spotifyUrl: string }> {
  const playlist = await spotifyApiFetch<{ id: string; external_urls?: { spotify?: string } }>(
    '/v1/me/playlists',
    undefined,
    {
      method: 'POST',
      body: JSON.stringify({ name, public: false, description: 'Created with needledrop' }),
    },
    accessToken,
  )

  if (trackUris.length > 0) {
    await addTracks(playlist.id, trackUris, accessToken)
  }

  return {
    id: playlist.id,
    spotifyUrl: playlist.external_urls?.spotify ?? `https://open.spotify.com/playlist/${playlist.id}`,
  }
}

export async function addTracks(playlistId: string, uris: string[], accessToken: string): Promise<void> {
  if (uris.length === 0) return
  // Spotify allows max 100 per request.
  for (let i = 0; i < uris.length; i += 100) {
    const chunk = uris.slice(i, i + 100)
    await spotifyApiFetch(`/v1/playlists/${playlistId}/tracks`, undefined, {
      method: 'POST',
      body: JSON.stringify({ uris: chunk }),
    }, accessToken)
  }
}

export async function searchTrackUri(query: string, accessToken?: string): Promise<string | null> {
  try {
    const data = await spotifyApiFetch<{
      tracks?: { items?: Array<{ uri?: string; id?: string }> }
    }>('/v1/search', { q: query, type: 'track', limit: 1 }, undefined, accessToken)
    const item = data.tracks?.items?.[0]
    if (item?.uri) return item.uri
    if (item?.id) return `spotify:track:${item.id}`
    return null
  } catch {
    return null
  }
}
