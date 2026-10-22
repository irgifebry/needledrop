import { describe, expect, it } from 'vitest'

import { needsGoogleSignIn } from '@/lib/youtube/create-auth'

describe('needsGoogleSignIn', () => {
  it('requires Google only when saving to YouTube outside demo mode', () => {
    expect(needsGoogleSignIn(false, false)).toBe(true)
    expect(needsGoogleSignIn(true, false)).toBe(false)
    expect(needsGoogleSignIn(false, true)).toBe(false)
  })
})
