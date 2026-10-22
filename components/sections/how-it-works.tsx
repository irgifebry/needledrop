'use client'

import { useState } from 'react'
import Image from 'next/image'

import { Reveal } from '@/components/reveal'
import { cn } from '@/lib/utils'

type Stage = {
  name: string
  tint: string
  ink: 'paper' | 'ink'
  body: string
}

const STAGES: Stage[] = [
  {
    name: 'Resolve',
    tint: '#12210f',
    ink: 'paper',
    body: 'One search finds the video, its artist, its Wikipedia topic and its duration. The seed is now a profile, not just a link.',
  },
  {
    name: 'Gather',
    tint: '#1d3417',
    ink: 'paper',
    body: 'Four independent sources feed the pool: YouTube’s related videos, the artist’s own catalogue, the seed’s topic, and the regional music chart.',
  },
  {
    name: 'Hydrate',
    tint: '#2f4a23',
    ink: 'paper',
    body: 'One call per fifty candidates fills in topics, durations, view counts and channel names. Hydration costs a single unit.',
  },
  {
    name: 'Score',
    tint: '#456a3c',
    ink: 'paper',
    body: 'Topic match, official channel, title shape, duration proximity, popularity and cross-source agreement. Every point arrives with a reason attached.',
  },
  {
    name: 'Diversify',
    tint: '#6f9a63',
    ink: 'ink',
    body: 'Duplicate track keys are dropped, version tags are filtered precisely, and a per-artist cap keeps the list from collapsing into one name.',
  },
  {
    name: 'Create',
    tint: '#a7ff9c',
    ink: 'ink',
    body: 'The playlist is written, then each item is inserted in order with an explicit position, and one final read confirms the order stuck.',
  },
]

export function HowItWorks() {
  const [open, setOpen] = useState(0)

  return (
    <section id="how" data-chapter="paper-2" className="bg-paper-2 text-ink">
      <div className="shell py-[12svh]">
        <div className="grid grid-cols-12 gap-[var(--gap)]">
          <Reveal className="col-span-12 lg:col-span-5">
            <h2 className="display t-title">Six stages, one API</h2>
          </Reveal>
          <Reveal delay={80} className="col-span-12 lg:col-span-5 lg:col-start-7">
            <p className="max-w-[46ch] t-body leading-relaxed text-ink/75">
              The YouTube Data API has no &ldquo;songs like this&rdquo; endpoint. What it does have is
              enough primitives to assemble one, if you know how to rank them.
            </p>
          </Reveal>
        </div>

        <div className="mt-12 hidden h-[520px] flex-col gap-2 lg:flex">
          {STAGES.map((stage, index) => {
            const isOpen = index === open
            return (
              <button
                key={stage.name}
                type="button"
                onClick={() => setOpen(index)}
                aria-expanded={isOpen}
                className={cn(
                  'relative flex-1 overflow-hidden text-left transition-[flex-grow] duration-500 ease-out',
                  isOpen && 'flex-grow-[6]',
                )}
                style={{ backgroundColor: stage.tint, color: stage.ink === 'paper' ? '#ffffff' : '#0b0b0b' }}
              >
                {isOpen ? (
                  <div className="flex h-full w-full flex-col justify-between p-8">
                    <span className="display t-sub leading-none">{stage.name}</span>
                    <p className="max-w-[38ch] t-body leading-relaxed opacity-90">{stage.body}</p>
                    <Image
                      src="/img/kazantip-popovka-crimea-technics-turntable-vinyl-turntable.jpg"
                      alt="A Technics turntable with a record on the platter"
                      width={1920}
                      height={1440}
                      loading="lazy"
                      className="pointer-events-none absolute right-[-3%] top-1/2 hidden h-[72%] w-[36%] -translate-y-1/2 rotate-[3deg] border-4 border-current object-cover opacity-90 xl:block"
                    />
                  </div>
                ) : (
                  <span className="absolute bottom-6 left-4 origin-bottom-left -rotate-90 whitespace-nowrap t-title font-semibold">
                    {stage.name}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <div className="mt-10 flex flex-col gap-2 lg:hidden">
          {STAGES.map((stage, index) => {
            const isOpen = index === open
            return (
              <div
                key={stage.name}
                style={{ backgroundColor: stage.tint, color: stage.ink === 'paper' ? '#ffffff' : '#0b0b0b' }}
              >
                <button
                  type="button"
                  onClick={() => setOpen(index)}
                  aria-expanded={isOpen}
                  className="flex h-16 w-full items-center px-5 text-left t-lead font-semibold"
                >
                  {stage.name}
                </button>
                {isOpen && <p className="px-5 pb-5 t-body leading-relaxed">{stage.body}</p>}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
