import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const presets = readFileSync(new URL('../../components/settings/presets-panel.tsx', import.meta.url), 'utf8')
const blocks = readFileSync(new URL('../../components/settings/blocks-panel.tsx', import.meta.url), 'utf8')
const apiKey = readFileSync(new URL('../../components/settings/api-key-panel.tsx', import.meta.url), 'utf8')
const quota = readFileSync(new URL('../../components/settings/quota-panel.tsx', import.meta.url), 'utf8')

describe('Settings panels', () => {
  it('offers retry after a failed presets load', () => {
    expect(presets).toMatch(/useEffect\(\(\) => \{[\s\S]*?fetch\('\/api\/presets'\)[\s\S]*?\}, \[loadAttempt\]\)/)
    expect(presets).toContain('Retry')
    expect(presets).toContain('setLoadAttempt((attempt) => attempt + 1)')
  })

  it.each([
    ['presets', presets, 'setPresets('],
    ['blocks', blocks, 'setBlocks('],
    ['API-key status', apiKey, 'setConfigured('],
    ['quota', quota, 'setData('],
  ])('resets %s state on retry and handles the subsequent result', (_name, source, successState) => {
    expect(source).toMatch(/function retryLoad\(\) \{\s*setLoading\(true\)\s*setError\(null\)\s*setLoadAttempt\(\(attempt\) => attempt \+ 1\)\s*\}/)
    expect(source).toContain(successState)
    expect(source).toContain('setError(')
    expect(source).toContain('setLoading(false)')
    expect(source).toContain('Retry')
    expect(source).toContain('onClick={retryLoad}')
  })

  it('does not create empty presets in Settings and directs users to Tune', () => {
    expect(presets).not.toContain("options: {}")
    expect(presets).toContain('Tune')
  })

  it('prevents duplicate removal while a preset delete is pending', () => {
    expect(presets).toContain('disabled={busy}')
    expect(presets).toContain('if (busy) return')
  })

  it('prevents duplicate removal while a block delete is pending', () => {
    expect(blocks).toContain('disabled={busy}')
    expect(blocks).toContain('if (busy) return')
  })

  it('explains quota units and separates shared and visitor key budgets', () => {
    expect(quota).toContain('YouTube Data API units')
    expect(quota).toContain('optional personal key')
    expect(quota).toContain('Retry')
  })
})
