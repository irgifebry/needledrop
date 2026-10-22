import { NextResponse } from 'next/server'

import { hasLiveApi, hasOAuth } from '@/lib/env'
import { clientId, clientSecret } from '@/lib/google-oauth'
import { readSession } from '@/lib/session'

/**
 * The signed-in identity, plus a snapshot of what the deployment can do.
 *
 * The client reads `signedIn`, `user` and `configured`; everything else is
 * additive so the existing header keeps working untouched.
 */
export async function GET() {
  const session = await readSession()

  if (!session) {
    return NextResponse.json({
      signedIn: false,
      user: null,
      configured: hasOAuth() && Boolean(clientId() && clientSecret()),
      liveApi: hasLiveApi(),
    })
  }

  return NextResponse.json({
    signedIn: true,
    user: { email: session.email, name: session.name },
    configured: true,
    liveApi: hasLiveApi(),
    expiresAt: session.expiresAt,
    expiresInSec: Math.max(0, Math.round((session.expiresAt - Date.now()) / 1000)),
  })
}
