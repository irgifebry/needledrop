import { cookies } from 'next/headers'

import { open, seal } from './crypto'

const COOKIE_NAME = 'needledrop_session'
const STATE_COOKIE = 'needledrop_oauth_state'
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
