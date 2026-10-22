import { NextResponse } from 'next/server'

import { buildAuthUrl, clientId, clientSecret, randomState } from '@/lib/google-oauth'
import { setOAuthState } from '@/lib/session'

/**
 * Start the Google OAuth flow.
 *
 * The `state` is a random value stored in a short-lived cookie and compared
 * on the callback, which is what stops a third party from feeding us a code
 * of their own.
 */
export async function GET() {
  if (!clientId() || !clientSecret()) {
    return NextResponse.json(
      {
        code: 'oauth_not_configured',
        message:
          'Google OAuth is not configured yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.local to switch the app from demo mode to live.',
      },
      { status: 503 },
    )
  }

  const state = randomState()
  await setOAuthState(state)
  return NextResponse.redirect(buildAuthUrl(state))
}
