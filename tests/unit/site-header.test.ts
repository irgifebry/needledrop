import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../../components/site-header.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8')
const contentHeroPages = [
  '../../app/library/page.tsx',
  '../../app/library/[playlistId]/page.tsx',
  '../../app/settings/page.tsx',
  '../../app/privacy/page.tsx',
] as const

const anchorTargets = [
  ['top', '../../components/hero.tsx'],
  ['how', '../../components/sections/how-it-works.tsx'],
  ['why', '../../components/sections/features.tsx'],
  ['faq', '../../components/sections/faq.tsx'],
] as const

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

  it('keeps every home navigation hash pointed at a real section and offset below the fixed header', () => {
    for (const [id, file] of anchorTargets) {
      const section = readFileSync(new URL(file, import.meta.url), 'utf8')
      expect(section).toContain(`id="${id}"`)
      expect(source).toContain(`#${id}`)
    }
    expect(styles).toMatch(/html\s*\{[^}]*scroll-padding-top:\s*5rem/s)
  })

  it('uses the same fixed-header spacing for every content-page hero', () => {
    for (const file of contentHeroPages) {
      const page = readFileSync(new URL(file, import.meta.url), 'utf8')
      expect(page).toContain('page-hero-content')
    }
    expect(styles).toMatch(/@utility page-hero-content\s*\{[^}]*padding-block-start:\s*calc\(5rem\s*\+\s*6svh\)/s)
  })

  it('closes the mobile menu on Escape and restores focus to its toggle', () => {
    expect(source).toContain("event.key !== 'Escape'")
    expect(source).toContain('setMenuOpen(false)')
    expect(source).toContain('menuButtonRef.current?.focus()')
  })

  it('closes the mobile menu after selecting a navigation link', () => {
    expect(source.match(/onClick=\{\(\) => setMenuOpen\(false\)\}/g)).toHaveLength(3)
  })
})
