import { NextResponse } from 'next/server'

import { logger } from '@/lib/observability/logger'
import { clearSession, readSession } from '@/lib/session'
import { revokeToken } from '@/lib/google-oauth'

/**
 * Sign out.
 *
 * Clearing the cookie is not enough: the refresh token is still live on
 * Google's side. It is revoked there first, so a leaked cookie cannot be
 * replayed after the user signed out. A failure to revoke must not block the
 * sign-out — the local session is cleared either way, and the failure is
 * logged.
 */
export async function POST() {
  const session = await readSession()

  if (session?.refreshToken) {
    try {
      await revokeToken(session.refreshToken)
    } catch (error) {
      logger.warn('logout: token revocation failed', { error })
    }
  }

  await clearSession()
  return NextResponse.redirect(new URL('/', process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'))
}
