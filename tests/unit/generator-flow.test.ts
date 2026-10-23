import { describe, expect, it } from 'vitest'

import { getSaveCta, getSaveCtaAction, parseGeneratorDraft, serializeGeneratorDraft, storeGeneratorDraft } from '@/lib/generator-flow'

describe('generator save CTA state', () => {
  it('distinguishes loading, live auth, demo, and unavailable OAuth', () => {
    expect(getSaveCta({ signedIn: null, configured: true, liveApi: true, demo: false })).toBe('loading')
    expect(getSaveCta({ signedIn: false, configured: true, liveApi: true, demo: false })).toBe('sign-in')
    expect(getSaveCta({ signedIn: true, configured: true, liveApi: true, demo: false })).toBe('create')
    expect(getSaveCta({ signedIn: false, configured: true, liveApi: false, demo: true })).toBe('demo')
    expect(getSaveCta({ signedIn: false, configured: false, liveApi: true, demo: false })).toBe('unavailable')
    expect(getSaveCta({ signedIn: false, configured: false, liveApi: false, demo: false })).toBe('demo')
  })

  it('never routes demo CTA clicks to playlist creation', () => {
    expect(getSaveCtaAction('demo')).toBe('demo')
    expect(getSaveCtaAction('create')).toBe('create')
    expect(getSaveCtaAction('sign-in')).toBe('sign-in')
    expect(getSaveCtaAction('unavailable')).toBe('none')
    expect(getSaveCtaAction('loading')).toBe('none')
  })
})

describe('generator draft snapshots', () => {
  const draft = { title: 'Night drive', description: 'Late set', privacy: 'unlisted' as const }

  it('round-trips a versioned draft', () => {
    expect(parseGeneratorDraft(serializeGeneratorDraft(draft))).toEqual(draft)
  })

  it('rejects malformed and unknown-version snapshots', () => {
    expect(parseGeneratorDraft('{')).toBeNull()
    expect(parseGeneratorDraft(JSON.stringify({ version: 2, draft }))).toBeNull()
  })

  it('stores the latest draft synchronously before leaving for OAuth', () => {
    const values = new Map<string, string>()
    const storage = {
      setItem: (key: string, value: string) => values.set(key, value),
    }

    storeGeneratorDraft(storage, draft)

    expect(parseGeneratorDraft(values.get('playlist-generator-draft') ?? '')).toEqual(draft)
  })

  it('does not block OAuth when browser storage rejects writes', () => {
    const storage = { setItem: () => { throw new Error('blocked') } }
    expect(storeGeneratorDraft(storage, draft)).toBe(false)
  })
})
