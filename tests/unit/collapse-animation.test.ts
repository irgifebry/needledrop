import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../../components/sections/how-it-works.tsx', import.meta.url), 'utf8')

describe('How it works accordion animation', () => {
  it('keeps mobile stage content mounted and animates both expanded and collapsed states', () => {
    expect(source).toContain('grid-rows-[0fr]')
    expect(source).toContain('grid-rows-[1fr]')
    expect(source).toContain('aria-hidden={!isOpen}')
    expect(source).toContain('inert={!isOpen}')
  })
})
