import { describe, expect, it } from 'vitest'

import { weightsFor, weightsForProfile } from '@/lib/scoring/weights'

const STRICT = {
  topic: 60,
  artist: 40,
  official: 25,
  titleMatch: 20,
  shape: 8,
  duration: 10,
  popularity: 0,
  crossSource: 0,
  genre: 12,
  recency: 0,
}

const EXPLORE = {
  topic: 15,
  artist: 5,
  official: 10,
  titleMatch: 5,
  shape: 3,
  duration: 2,
  popularity: 10,
  crossSource: 8,
  genre: 4,
  recency: 5,
}

describe('weightsFor', () => {
  it('returns the strict vector at breadth 0', () => {
    expect(weightsFor(0)).toEqual(STRICT)
  })

  it('returns the explore vector at breadth 100', () => {
    expect(weightsFor(100)).toEqual(EXPLORE)
  })

  it('lands halfway between the two vectors at breadth 50', () => {
    const middle = weightsFor(50)
    for (const key of Object.keys(STRICT) as Array<keyof typeof STRICT>) {
      expect(middle[key]).toBeCloseTo((STRICT[key] + EXPLORE[key]) / 2, 10)
    }
  })

  it('moves monotonically from strict to explore', () => {
    const widths = [0, 10, 25, 50, 75, 90, 100]
    for (const key of Object.keys(STRICT) as Array<keyof typeof STRICT>) {
      const values = widths.map((width) => weightsFor(width)[key])
      const descending = STRICT[key] > EXPLORE[key]
      for (let index = 1; index < values.length; index += 1) {
        if (descending) {
          expect(values[index]).toBeLessThanOrEqual(values[index - 1])
        } else {
          expect(values[index]).toBeGreaterThanOrEqual(values[index - 1])
        }
      }
    }
  })

  it('clamps a breadth outside the slider to the nearest end', () => {
    expect(weightsFor(-10)).toEqual(STRICT)
    expect(weightsFor(140)).toEqual(EXPLORE)
  })

  it('spends the similarity budget on topic and artist at breadth 0', () => {
    const strict = weightsFor(0)
    expect(strict.topic).toBeGreaterThan(strict.popularity)
    expect(strict.artist).toBeGreaterThan(strict.crossSource)
  })

  it('spends the budget on popularity and source diversity at breadth 100', () => {
    const explore = weightsFor(100)
    expect(explore.popularity).toBeGreaterThan(0)
    expect(explore.crossSource).toBeGreaterThan(0)
    expect(explore.topic).toBeLessThan(STRICT.topic)
  })
})

describe('weightsForProfile', () => {
  it('returns the strict preset', () => {
    expect(weightsForProfile('strict')).toEqual(STRICT)
  })

  it('returns the explore preset', () => {
    expect(weightsForProfile('explore')).toEqual(EXPLORE)
  })

  it('returns the balanced preset of the plan scoring table', () => {
    expect(weightsForProfile('balanced')).toEqual({
      topic: 40,
      artist: 15,
      official: 20,
      titleMatch: 10,
      shape: 5,
      duration: 5,
      popularity: 10,
      crossSource: 6,
      genre: 12,
      recency: 5,
    })
  })

  it('does not hand out the internal preset table itself', () => {
    const first = weightsForProfile('strict')
    first.topic = 1

    expect(weightsForProfile('strict').topic).toBe(STRICT.topic)
  })
})
