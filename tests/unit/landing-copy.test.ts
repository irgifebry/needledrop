import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const faq = readFileSync(new URL('../../components/sections/faq.tsx', import.meta.url), 'utf8')
const features = readFileSync(new URL('../../components/sections/features.tsx', import.meta.url), 'utf8')

describe('truthful landing-page claims', () => {
  it('says user API keys are managed in Settings and used for searches', () => {
    expect(faq).toMatch(/API key.{0,120}Settings/i)
    expect(faq).toMatch(/search/i)
  })

  it('distinguishes variable discovery estimates from playlist-write costs', () => {
    expect(faq).toMatch(/discovery.{0,100}estimate/i)
    expect(faq).toMatch(/Writing to YouTube costs.{0,150}for each track inserted/i)
    expect(faq).not.toMatch(/1,450 units/)
  })

  it('explains that a playlist can be kept with fewer tracks after insertion failures', () => {
    expect(faq).toMatch(/keeps the playlist/i)
    expect(faq).toMatch(/could not be added/i)
  })

  it('makes clear demo mode uses a built-in catalogue and does not create a YouTube playlist', () => {
    expect(faq).toMatch(/demo.{0,100}(catalogue|catalog)/i)
    expect(faq).toMatch(/demo run does not create a playlist/i)
  })

  it('says public playlist creation requires confirmation', () => {
    expect(faq).toMatch(/public.{0,100}confirm/i)
  })

  it('limits the product claim to YouTube metadata and links, not audio', () => {
    expect(faq).toMatch(/reads YouTube metadata/i)
    expect(faq).not.toMatch(/Nothing is fetched/i)
    expect(features).toMatch(/metadata and links only/i)
    expect(features).toMatch(/audio.{0,30}(never|not|no)/i)
  })
})
