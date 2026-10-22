import { describe, expect, it } from 'vitest'

import { normalizedCategories, sameGenre, sameTopic, topicCategoriesOf, topicNameFromUrl } from '@/lib/youtube/topic'

import { makeTrack } from '@/tests/helpers/fixtures'

describe('topicNameFromUrl', () => {
  it('turns a category slug into a readable name', () => {
    const name = topicNameFromUrl('https://en.wikipedia.org/wiki/Category:Indonesian_pop')

    expect(name).toContain('Indonesian Pop')
    expect(name).not.toContain('_')
  })

  it('labels a missing topic as unknown rather than inventing one', () => {
    expect(topicNameFromUrl(undefined)).toBe('Unknown topic')
    expect(topicNameFromUrl('')).toBe('Unknown topic')
  })
})

describe('topicCategoriesOf', () => {
  it('prefers the category titles the API provides', () => {
    const categories = topicCategoriesOf({
      topicDetails: {
        topicId: '/m/abc',
        topicCategoryLinks: [
          { url: 'https://en.wikipedia.org/wiki/Category:New_wave_music', title: 'New wave music' },
        ],
        topicCategories: ['https://en.wikipedia.org/wiki/Category:New_wave_music'],
      },
    })

    expect(categories).toEqual(['New wave music'])
  })

  it('falls back to the URL slug when there is no title', () => {
    const categories = topicCategoriesOf({
      topicDetails: {
        topicId: '/m/abc',
        topicCategoryLinks: [{ url: 'https://en.wikipedia.org/wiki/Category:New_wave_music' }],
      },
    })

    expect(categories).toHaveLength(1)
    expect(categories[0]).toContain('New Wave Music')
  })

  it('falls back to the plain category list when there are no links', () => {
    const categories = topicCategoriesOf({
      topicDetails: {
        topicId: '/m/abc',
        topicCategories: ['https://en.wikipedia.org/wiki/Category:Synth_pop'],
      },
    })

    expect(categories).toHaveLength(1)
    expect(categories[0]).toContain('Synth Pop')
  })

  it('returns nothing for a video without topic details', () => {
    expect(topicCategoriesOf({})).toEqual([])
  })

  it('never repeats a category', () => {
    const categories = topicCategoriesOf({
      topicDetails: {
        topicId: '/m/abc',
        topicCategoryLinks: [
          { title: 'New wave music' },
          { title: 'New wave music' },
        ],
      },
    })

    expect(categories).toEqual(['New wave music'])
  })
})

describe('sameTopic', () => {
  it('is true for two tracks with the same topic id', () => {
    const a = makeTrack({ topicId: '/m/abc' })
    const b = makeTrack({ topicId: '/m/abc' })

    expect(sameTopic(a, b)).toBe(true)
  })

  it('is false for two tracks with different topic ids', () => {
    const a = makeTrack({ topicId: '/m/abc' })
    const b = makeTrack({ topicId: '/m/def' })

    expect(sameTopic(a, b)).toBe(false)
  })

  it('is false when a topic id is missing', () => {
    const a = makeTrack({ topicId: '' })
    const b = makeTrack({ topicId: '' })

    expect(sameTopic(a, b)).toBe(false)
  })
})

describe('sameGenre', () => {
  it('is true for two tracks that share a category', () => {
    const a = makeTrack({ topicCategories: ['Indonesian pop'] })
    const b = makeTrack({ topicCategories: ['Synth-pop'] })

    expect(sameGenre(a, b)).toBe(false)
    expect(sameGenre(a, makeTrack({ topicCategories: ['indonesian pop'] }))).toBe(true)
  })

  it('is false when neither track carries a category', () => {
    expect(sameGenre(makeTrack({ topicCategories: [] }), makeTrack({ topicCategories: [] }))).toBe(false)
  })
})

describe('normalizedCategories', () => {
  it('folds the case of every category and drops the empty ones', () => {
    expect(normalizedCategories(['Indonesian Pop', '  ', 'Synth-Pop'])).toEqual([
      'indonesian pop',
      'synth-pop',
    ])
  })

  it('copes with a missing list', () => {
    expect(normalizedCategories(undefined)).toEqual([])
  })
})
