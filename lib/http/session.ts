import { AppError } from '@/lib/http/errors'
import { refreshAccessToken } from '@/lib/google-oauth'
import { readSession, writeSession, type Session } from '@/lib/session'

/**
 * Session helpers for route handlers.
 *
 * `requireSession` throws an `AppError` with a stable code, which
 * `withRoute` turns into a 401 the UI can special-case.
 */

export async function requireSession(): Promise<Session> {
  const session = await readSession()
  if (!session) {
    throw new AppError('auth_required', 'Sign in with Google to continue.', 401)
  }
  return session
}

/**
 * Returns a session whose access token is valid for at least another minute,
 * re-encrypting the cookie when a refresh happened.
 */
export async function requireFreshSession(): Promise<Session> {
  const session = await requireSession()

  if (session.expiresAt - Date.now() >= 60_000) return session

  if (!session.refreshToken) {
    throw new AppError('auth_expired', 'Your session expired. Sign in again.', 401)
  }

  let refreshed: Session
  try {
    refreshed = await refreshAccessToken(session)
  } catch {
    throw new AppError('auth_expired', 'Your session expired. Sign in again.', 401)
  }

  if (refreshed.expiresAt <= Date.now()) {
    throw new AppError('auth_expired', 'Your session expired. Sign in again.', 401)
  }

  await writeSession(refreshed)
  return refreshed
}

/** The session if there is one, without throwing. */
export async function optionalSession(): Promise<Session | null> {
  return readSession()
}
