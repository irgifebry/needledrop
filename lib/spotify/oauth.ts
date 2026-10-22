import { env } from '@/lib/env'
import { randomState } from '@/lib/crypto'
import type { SpotifySession } from '@/lib/session'

const AUTH_URL = 'https://accounts.spotify.com/authorize'
const TOKEN_URL = 'https://accounts.spotify.com/api/token'
const ME_URL = 'https://api.spotify.com/v1/me'

export const SCOPES = [
  'playlist-modify-public',
  'playlist-modify-private',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-read-private',
  'user-read-email',
]

export function clientId(): string | null {
  return process.env.SPOTIFY_CLIENT_ID ?? env().SPOTIFY_CLIENT_ID ?? null
}

export function clientSecret(): string | null {
  return process.env.SPOTIFY_CLIENT_SECRET ?? env().SPOTIFY_CLIENT_SECRET ?? null
}

export function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? env().NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
}

export function redirectUri(): string {
  return `${appUrl()}/api/auth/spotify/callback`
}

export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: clientId() ?? '',
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPES.join(' '),
    state,
  })
  return `${AUTH_URL}?${params.toString()}`
}

export { randomState }

export function isExpired(session: SpotifySession): boolean {
  return session.expiresAt - Date.now() < 60_000
}

type TokenResponse = {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope?: string
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const id = clientId() ?? ''
  const secret = clientSecret() ?? ''
  const basic = Buffer.from(`${id}:${secret}`).toString('base64')
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body),
    cache: 'no-store',
  })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Spotify token request failed (${response.status}): ${detail}`)
  }
  return (await response.json()) as TokenResponse
}

export async function exchangeCode(code: string): Promise<SpotifySession> {
  const tokens = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
  })

  let spotifyUserId = ''
  let displayName = 'Spotify user'
  try {
    const profile = await fetch(ME_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      cache: 'no-store',
    })
    if (profile.ok) {
      const info = (await profile.json()) as { id?: string; display_name?: string }
      spotifyUserId = info.id ?? ''
      displayName = info.display_name ?? displayName
    }
  } catch {
    // ignore profile errors
  }

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? '',
    expiresAt: Date.now() + tokens.expires_in * 1000,
    spotifyUserId,
    displayName,
  }
}

export async function refreshAccessToken(session: SpotifySession): Promise<SpotifySession> {
  if (!session.refreshToken) return session
  const tokens = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: session.refreshToken,
  })
  return {
    ...session,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? session.refreshToken,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  }
}

export async function ensureFresh(session: SpotifySession): Promise<SpotifySession> {
  if (!isExpired(session)) return session
  if (!session.refreshToken) return session
  try {
    return await refreshAccessToken(session)
  } catch {
    return session
  }
}

/** Alias for callers expecting the Google-style name. */
export async function ensureFreshSession(session: SpotifySession): Promise<SpotifySession> {
  return ensureFresh(session)
}
