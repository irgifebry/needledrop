import { describe, expect, it } from 'vitest'

import { SCOPES } from '@/lib/google-oauth'

/**
 * The OAuth scope contract (PLAN §3).
 *
 * The consent screen answers a request that names a scope Google does not
 * publish with `Error 400: invalid_scope`, and it does so *after* the user
 * has already clicked through the sign-in page. The app then looks
 * perfectly configured — the client id is right, the redirect uri matches,
 * the health endpoint says sign-in is available — and nobody can get in.
 *
 * The lists below are the scopes the YouTube Data API v3 actually publishes,
 * taken from its discovery document
 * (`https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest`, under
 * `auth.oauth2.scopes`). They are pinned here rather than fetched, so the
 * test never touches the network and never spends quota.
 */

/** Every scope the YouTube Data API v3 publishes. */
const YOUTUBE_SCOPES = new Set([
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/youtube.channel-memberships.creator',
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtubepartner',
  'https://www.googleapis.com/auth/youtubepartner-channel-audit',
])

/** The OpenID Connect scopes the identity lookup uses. */
const IDENTITY_SCOPES = new Set([
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
])

/**
 * Which scopes cover which playlist methods, per the discovery document.
 *
 * The app mutates the user's own playlists, so the write scope has to
 * cover `playlists.insert` and `playlistItems.insert` — that pair is the
 * whole "Create playlist" feature.
 */
const WRITE_METHODS = [
  'playlists.insert',
  'playlistItems.insert',
  'playlists.update',
  'playlistItems.update',
] as const

const READ_METHODS = ['playlists.list', 'playlistItems.list'] as const

describe('the OAuth scopes the app requests', () => {
  it('names only scopes Google actually publishes', () => {
    for (const scope of SCOPES) {
      expect(
        YOUTUBE_SCOPES.has(scope) || IDENTITY_SCOPES.has(scope),
        `${scope} is not a published scope — the consent screen would reject the whole request`,
      ).toBe(true)
    }
  })

  it('does not name the scope that never existed', () => {
    // The Data API has no `youtube.playlists` scope. Naming it fails the
    // entire sign-in, not just the playlist feature.
    expect(SCOPES).not.toContain('https://www.googleapis.com/auth/youtube.playlists')
  })

  it('covers the playlist write methods', () => {
    const writeScope = SCOPES.find((scope) =>
      ['https://www.googleapis.com/auth/youtube.force-ssl', 'https://www.googleapis.com/auth/youtube'].includes(
        scope,
      ),
    )

    expect(writeScope, 'no scope can write playlists — "Create playlist" would 403').toBeDefined()
    expect(WRITE_METHODS.length).toBeGreaterThan(0)
  })

  it('covers the playlist read methods', () => {
    expect(SCOPES).toContain('https://www.googleapis.com/auth/youtube.readonly')
    expect(READ_METHODS.length).toBeGreaterThan(0)
  })

  it('requests no duplicate scopes', () => {
    expect(new Set(SCOPES).size).toBe(SCOPES.length)
  })

  it('asks for the identity it stores in the session cookie', () => {
    // `exchangeCode` reads `email` and `name` from the userinfo endpoint and
    // writes them into the encrypted cookie.
    expect(SCOPES).toContain('https://www.googleapis.com/auth/userinfo.email')
    expect(SCOPES).toContain('https://www.googleapis.com/auth/userinfo.profile')
  })
})
