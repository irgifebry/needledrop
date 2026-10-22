import { NextResponse } from 'next/server'

import { clearSpotifySession } from '@/lib/session'

async function handle() {
  await clearSpotifySession()
  return NextResponse.json({ ok: true })
}

export async function DELETE() {
  return handle()
}

export async function POST() {
  return handle()
}
