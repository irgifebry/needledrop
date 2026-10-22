import { randomState } from './crypto'
import type { Session } from './session'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'

/**
 * The scopes the app asks for.
 *
 * There is no `youtube.playlists` scope. The Data API has never published
 * one, and a request that names it comes back as `invalid_scope` — the
 * consent screen answers with the list of scopes it *can* satisfy, and the
 * name it does not recognise is the one in the request. The write side of
 * the playlist API is covered by `youtube.force-ssl`, which is `youtube`
 * with the SSL requirement made explicit and is what Google recommends
 * for new integrations.
 *
 * `youtube.readonly` covers the read side (`playlists.list`,
 * `playlistItems.list`), and the two `userinfo` scopes carry the identity
 * the session cookie holds.
 *
 * The set is pinned by `tests/contract/oauth-scopes.test.ts`: every scope
 * here must be one Google actually publishes, or the consent screen
 * rejects the whole request and nobody can sign in at all.
 */
export const SCOPES = [
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
]

export function clientId(): string | null {
  return process.env.GOOGLE_CLIENT_ID ?? null
}

export function clientSecret(): string | null {
  return process.env.GOOGLE_CLIENT_SECRET ?? null
}

export function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
}

export function redirectUri(): string {
  return `${appUrl()}/api/auth/callback`
}

export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: clientId() ?? '',
    redirect_uri: redirectUri(),
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES.join(' '),
    state,
  })
  return `${AUTH_URL}?${params.toString()}`
}

export { randomState }

export function isExpired(session: Session): boolean {
  return session.expiresAt - Date.now() < 60000
}

type TokenResponse = {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope?: string
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
    cache: 'no-store',
  })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Token exchange failed (${response.status}): ${detail}`)
  }
  return (await response.json()) as TokenResponse
}

export async function exchangeCode(code: string): Promise<Session> {
  const tokens = await tokenRequest({
    code,
    client_id: clientId() ?? '',
    client_secret: clientSecret() ?? '',
    redirect_uri: redirectUri(),
    grant_type: 'authorization_code',
  })

  const profile = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    cache: 'no-store',
  })
  const info = profile.ok ? ((await profile.json()) as { email?: string; name?: string }) : {}

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? '',
    expiresAt: Date.now() + tokens.expires_in * 1000,
    email: info.email ?? 'signed-in user',
    name: info.name ?? 'Music lover',
  }
}

export async function refreshAccessToken(session: Session): Promise<Session> {
  if (!session.refreshToken) return session
  const tokens = await tokenRequest({
    refresh_token: session.refreshToken,
    client_id: clientId() ?? '',
    client_secret: clientSecret() ?? '',
    grant_type: 'refresh_token',
  })
  return {
    ...session,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? session.refreshToken,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  }
}

export async function ensureFreshSession(session: Session): Promise<Session> {
  if (!isExpired(session)) return session
  if (!session.refreshToken) return session
  try {
    return await refreshAccessToken(session)
  } catch {
    return session
  }
}

/**
 * Revoke a refresh token on Google's side.
 *
 * Called on sign-out: clearing the cookie is not enough if the token is
 * still valid upstream. Best-effort by design — the caller logs a failure
 * and carries on with the local sign-out.
 */
export async function revokeToken(token: string): Promise<void> {
  const response = await fetch('https://oauth2.googleapis.com/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error(`Token revocation failed (${response.status})`)
  }
}
