import { NextResponse } from 'next/server'

import { exchangeCode } from '@/lib/spotify/oauth'
import { clearOAuthState, readOAuthState, writeSpotifySession } from '@/lib/session'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const expected = await readOAuthState()

  if (!code || !state || state !== expected) {
    await clearOAuthState()
    return NextResponse.redirect(new URL('/?spotify=failed', request.url))
  }

  try {
    const session = await exchangeCode(code)
    await writeSpotifySession(session)
    await clearOAuthState()
    return NextResponse.redirect(new URL('/settings?spotify=ok', request.url))
  } catch {
    await clearOAuthState()
    return NextResponse.redirect(new URL('/?spotify=failed', request.url))
  }
}
