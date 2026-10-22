import { cookies } from 'next/headers'

import { open, seal } from './crypto'

const COOKIE_NAME = 'needledrop_session'
const STATE_COOKIE = 'needledrop_oauth_state'
const API_KEY_COOKIE = 'needledrop_apikey'
const MAX_AGE = 60 * 60 * 24 * 30

export type Session = {
  accessToken: string
  refreshToken: string
  expiresAt: number
  email: string
  name: string
}

export async function readSession(): Promise<Session | null> {
  const store = await cookies()
  const raw = store.get(COOKIE_NAME)?.value
  if (!raw) return null
  return open<Session>(raw)
}

export async function writeSession(session: Session): Promise<void> {
  const store = await cookies()
  store.set(COOKIE_NAME, seal(session), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE,
  })
}

export async function clearSession(): Promise<void> {
  const store = await cookies()
  store.delete(COOKIE_NAME)
}

export async function setOAuthState(state: string): Promise<void> {
  const store = await cookies()
  store.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  })
}

export async function readOAuthState(): Promise<string | null> {
  const store = await cookies()
  return store.get(STATE_COOKIE)?.value ?? null
}


export async function clearOAuthState(): Promise<void> {
  const store = await cookies()
  store.delete(STATE_COOKIE)
}

/* ── the visitor's own YouTube API key ────────────────────────────────────── */

/**
 * A visitor's own YouTube Data API key.
 *
 * The shared project key pays for every search, and the project's daily
 * budget is a hundred searches — so a visitor who brings a key from their
 * own Google Cloud project moves their traffic onto their own quota and
 * leaves the shared budget for everyone else.
 *
 * It lives in its own cookie rather than in the OAuth session, because it
 * belongs to the browser and not to the sign-in: signing in or out must not
 * silently discard it. The cookie is sealed with the same AES-256-GCM
 * envelope as the session, so the key is never stored in the clear and is
 * never logged.
 */
export type ApiKeySession = {
  apiKey: string
}

export async function readUserApiKey(): Promise<string | null> {
  const store = await cookies()
  const raw = store.get(API_KEY_COOKIE)?.value
  if (!raw) return null
  const opened = open<ApiKeySession>(raw)
  const key = opened?.apiKey
  return typeof key === 'string' && key.length > 0 ? key : null
}

export async function writeUserApiKey(apiKey: string): Promise<void> {
  const store = await cookies()
  store.set(API_KEY_COOKIE, seal({ apiKey } satisfies ApiKeySession), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE,
  })
}

export async function clearUserApiKey(): Promise<void> {
  const store = await cookies()
  store.delete(API_KEY_COOKIE)
}
