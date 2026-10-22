'use client'

import { useState } from 'react'
import Image from 'next/image'
import { ChevronDown } from 'lucide-react'

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

const PHOTO = {
  src: '/img/kazantip-popovka-crimea-technics-turntable-vinyl-turntable.jpg',
  alt: 'A Technics turntable with a record on the platter',
}

const INK: Record<Stage['ink'], string> = {
  paper: '#ffffff',
  ink: '#0b0b0b',
}

export function HowItWorks() {
  const [open, setOpen] = useState(0)

  return (
    <section id="how" data-chapter="paper-2" className="bg-paper-2 text-ink">
      <div className="shell py-[12svh]">
        <div className="grid grid-cols-12 gap-[var(--gap)]">
          <Reveal className="col-span-12 lg:col-span-6">
            <h2 className="display max-w-[11ch] t-headline leading-[0.92] tracking-[-0.02em]">
              Six stages, one API
            </h2>
          </Reveal>
          <Reveal delay={80} className="col-span-12 lg:col-span-5 lg:col-start-8">
            <p className="max-w-[46ch] t-body leading-relaxed text-ink/75">
              The YouTube Data API has no &ldquo;songs like this&rdquo; endpoint. What it does have is
              enough primitives to assemble one, if you know how to rank them.
            </p>
          </Reveal>
        </div>

        {/*
          The stack: six bars, one open. The open bar takes the lion’s share of
          the height and shows the stage; the closed ones stay as thin strips
          whose name is set flat, so nothing is ever cut off by the bar’s own
          overflow.
        */}
        <div className="mt-14 hidden flex-col gap-2 lg:flex lg:h-[600px] xl:h-[660px]">
          {STAGES.map((stage, index) => {
            const isOpen = index === open
            return (
              <button
                key={stage.name}
                type="button"
                onClick={() => setOpen(index)}
                aria-expanded={isOpen}
                className={cn(
                  'group relative basis-0 overflow-hidden text-left',
                  'transition-[flex-grow] duration-500 ease-out',
                  // The bars carry their own ink, so the focus ring is drawn in
                  // the page ink instead of the bar’s: it has to read against
                  // the paper behind the bar, not against the bar.
                  'focus-visible:outline-ink',
                  isOpen ? 'grow-[4]' : 'grow',
                )}
                style={{ backgroundColor: stage.tint, color: INK[stage.ink] }}
              >
                {isOpen ? (
                  <>
                    <div className="stage-in flex h-full w-full flex-col justify-between gap-8 p-8 lg:pr-[36%]">
                      <div className="flex items-baseline justify-between gap-6">
                        <span className="display t-mark leading-[0.9]">{stage.name}</span>
                        <span className="tnum t-small uppercase tracking-[0.2em] opacity-60">
                          Stage {String(index + 1).padStart(2, '0')}
                        </span>
                      </div>
                      <p className="max-w-[40ch] t-body leading-relaxed opacity-90">{stage.body}</p>
                    </div>

                    <div className="pointer-events-none absolute inset-y-6 right-6 hidden w-[30%] lg:block">
                      <Image
                        src={PHOTO.src}
                        alt={PHOTO.alt}
                        width={1920}
                        height={1440}
                        loading="lazy"
                        className="-rotate-2 h-full w-full border-4 border-current object-cover opacity-95"
                      />
                    </div>
                  </>
                ) : (
                  <div className="flex h-full items-center gap-5 px-6">
                    <span className="tnum t-small font-semibold opacity-55">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="display t-lead">{stage.name}</span>
                    <span className="h-px flex-1 bg-current opacity-20 transition-opacity duration-300 group-hover:opacity-45" />
                    <ChevronDown className="h-4 w-4 shrink-0 opacity-55 transition-transform duration-300 group-hover:-translate-y-0.5" strokeWidth={2} />
                  </div>
                )}
              </button>
            )
          })}
        </div>

        <div className="mt-12 flex flex-col gap-2 lg:hidden">
          {STAGES.map((stage, index) => {
            const isOpen = index === open
            return (
              <div
                key={stage.name}
                style={{ backgroundColor: stage.tint, color: INK[stage.ink] }}
              >
                <button
                  type="button"
                  onClick={() => setOpen(index)}
                  aria-expanded={isOpen}
                  className="flex h-16 w-full items-center gap-4 px-5 text-left focus-visible:outline-ink"
                >
                  <span className="tnum t-small font-semibold opacity-55">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="display t-lead">{stage.name}</span>
                  <span className="ml-auto h-px flex-1 bg-current opacity-20" />
                  <ChevronDown
                    className={cn(
                      'h-4 w-4 shrink-0 opacity-55 transition-transform duration-300',
                      isOpen && 'rotate-180',
                    )}
                    strokeWidth={2}
                  />
                </button>
                {isOpen && (
                  <p className="px-5 pb-5 t-body leading-relaxed">{stage.body}</p>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
