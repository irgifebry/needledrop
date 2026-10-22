import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../../components/site-header.tsx', import.meta.url), 'utf8')

describe('SiteHeader mobile navigation', () => {
  it('provides an accessible menu toggle for mobile viewports', () => {
    expect(source).toContain('aria-expanded={menuOpen}')
    expect(source).toContain('aria-label={menuOpen ? \'Close navigation menu\' : \'Open navigation menu\'}')
    expect(source).toContain('md:hidden')
  })

  it('keeps the mobile menu mounted so opening and closing can animate', () => {
    expect(source).toContain('grid-rows-[0fr]')
    expect(source).toContain('grid-rows-[1fr]')
    expect(source).toContain('transition-[grid-template-rows,opacity]')
  })
})
