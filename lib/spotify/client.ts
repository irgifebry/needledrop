import { env } from '@/lib/env'

const API_BASE = 'https://api.spotify.com'
const TOKEN_URL = 'https://accounts.spotify.com/api/token'

export function hasSpotify(): boolean {
  const value = env()
  return Boolean(value.SPOTIFY_CLIENT_ID && value.SPOTIFY_CLIENT_SECRET)
}

export class SpotifyError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'SpotifyError'
  }
}

type TokenCache = { token: string; expiresAt: number } | null
let cachedToken: TokenCache = null

export async function getClientCredentialsToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - Date.now() > 60_000) {
    return cachedToken.token
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID ?? env().SPOTIFY_CLIENT_ID
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET ?? env().SPOTIFY_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new SpotifyError('Spotify is not configured.', 'not_configured', 503)
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
    cache: 'no-store',
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new SpotifyError(
      `Spotify token request failed (${response.status}): ${detail}`,
      'token_error',
      response.status,
    )
  }

  const data = (await response.json()) as { access_token: string; expires_in: number }
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  }
  return cachedToken.token
}

/** Test seam — resets the memoised token. */
export function resetSpotifyToken(): void {
  cachedToken = null
}

export async function spotifyFetch<T>(
  path: string,
  params?: Record<string, string | number | undefined | null>,
  init?: RequestInit,
): Promise<T> {
  const token = await getClientCredentialsToken()
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

const SPOTIFY_PLAYLIST_ID = /^[A-Za-z0-9]{22}$/

export function parsePlaylistId(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  if (trimmed.startsWith('spotify:playlist:')) {
    const id = trimmed.slice('spotify:playlist:'.length).split('?')[0]
    return SPOTIFY_PLAYLIST_ID.test(id) ? id : null
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    return SPOTIFY_PLAYLIST_ID.test(trimmed) ? trimmed : null
  }

  try {
    const url = new URL(trimmed)
    const segments = url.pathname.split('/').filter(Boolean)
    const idx = segments.indexOf('playlist')
    const candidate = idx >= 0 ? segments[idx + 1] : segments[segments.length - 1]
    if (candidate && SPOTIFY_PLAYLIST_ID.test(candidate)) return candidate
    const list = url.searchParams.get('playlist') ?? url.searchParams.get('list')
    if (list && SPOTIFY_PLAYLIST_ID.test(list)) return list
    return null
  } catch {
    return null
  }
}
