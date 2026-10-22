import { describe, expect, it } from 'vitest'

import {
  appendLineage,
  buildLineageMarker,
  extractLineageMarker,
  hasLineage,
  parseLineage,
  stripLineage,
} from '@/lib/youtube/lineage'

const marker = buildLineageMarker({ run: '01J8XABCDEF', version: 2, seed: 'abc123' })

describe('buildLineageMarker', () => {
  it('writes the documented marker format', () => {
    expect(marker).toBe('<!--ytmg run=01J8XABCDEF v=2 seed=abc123 -->')
  })

  it('writes only the fields it was given', () => {
    expect(buildLineageMarker({ run: 'run1' })).toBe('<!--ytmg run=run1 -->')
  })

  it('keeps a value from breaking out of the comment', () => {
    const hostile = buildLineageMarker({ seed: 'a --> b' })

    expect(hostile).not.toContain('a --> b')
    expect(hostile.endsWith('-->')).toBe(true)
  })
})

describe('parseLineage', () => {
  it('reads back what the marker wrote', () => {
    expect(parseLineage(`My mix\n\n${marker}`)).toEqual({
      run: '01J8XABCDEF',
      version: 2,
      seed: 'abc123',
    })
  })

  it('returns null for a description with no marker', () => {
    expect(parseLineage('Just my mix')).toBeNull()
  })

  it('returns null for a description that only opens the comment', () => {
    expect(parseLineage('My mix <!--ytmg run=abc')).toBeNull()
  })

  it('returns null for a word that merely starts like the marker', () => {
    expect(parseLineage('ytmg is our prefix')).toBeNull()
  })

  it('ignores a token that carries no value', () => {
    expect(parseLineage('<!--ytmg run=abc seed= -->')).toEqual({ run: 'abc' })
  })
})

describe('hasLineage', () => {
  it('recognises a description the app wrote', () => {
    expect(hasLineage(`My mix\n\n${marker}`)).toBe(true)
  })

  it('does not claim a hand-written description as ours', () => {
    expect(hasLineage('My mix')).toBe(false)
  })
})

describe('extractLineageMarker', () => {
  it('returns the marker text verbatim', () => {
    expect(extractLineageMarker(`My mix\n\n${marker}`)).toBe(marker)
  })

  it('returns null when there is no marker', () => {
    expect(extractLineageMarker('My mix')).toBeNull()
  })
})

describe('appendLineage', () => {
  it('appends the marker to the user description', () => {
    const described = appendLineage('My mix', marker)

    expect(described).toContain('My mix')
    expect(described).toContain(marker)
  })

  it('does not append the marker twice', () => {
    const once = appendLineage('My mix', marker)
    const twice = appendLineage(once, marker)

    expect(twice.split('<!--ytmg').length - 1).toBe(1)
  })

  it('replaces an existing marker instead of stacking a second one', () => {
    const older = buildLineageMarker({ run: 'old-run', version: 1 })
    const replaced = appendLineage(appendLineage('My mix', older), marker)

    expect(replaced).not.toContain('old-run')
    expect(replaced).toContain(marker)
  })

  it('returns the description unchanged when there is no marker to append', () => {
    expect(appendLineage('My mix', '')).toBe('My mix')
  })
})

describe('stripLineage', () => {
  it('removes the marker and leaves the user description intact', () => {
    expect(stripLineage(`My mix\n\n${marker}`)).toBe('My mix')
  })

  it('leaves a description without a marker alone', () => {
    expect(stripLineage('My mix')).toBe('My mix')
  })

  it('round-trips with appendLineage', () => {
    const described = appendLineage('My mix', marker)

    expect(stripLineage(described)).toBe('My mix')
  })
})
