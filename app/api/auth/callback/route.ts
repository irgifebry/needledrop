import { NextResponse } from 'next/server'

import { exchangeCode } from '@/lib/google-oauth'
import { clearOAuthState, readOAuthState, writeSession } from '@/lib/session'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const expected = await readOAuthState()

  if (!code || !state || state !== expected) {
    await clearOAuthState()
    return NextResponse.redirect(new URL('/?auth=failed', request.url))
  }

  try {
    const session = await exchangeCode(code)
    await writeSession(session)
    await clearOAuthState()
    return NextResponse.redirect(new URL('/?auth=ok', request.url))
  } catch {
    await clearOAuthState()
    return NextResponse.redirect(new URL('/?auth=failed', request.url))
  }
}
