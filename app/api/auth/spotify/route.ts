import { NextResponse } from 'next/server'

import { buildAuthUrl, clientId, clientSecret, randomState } from '@/lib/spotify/oauth'
import { setOAuthState } from '@/lib/session'

export async function GET() {
  if (!clientId() || !clientSecret()) {
    return NextResponse.json(
      {
        code: 'oauth_not_configured',
        message:
          'Spotify OAuth is not configured yet. Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to .env.local.',
      },
      { status: 503 },
    )
  }

  const state = randomState()
  await setOAuthState(state)
  return NextResponse.redirect(buildAuthUrl(state))
}
