import Image from 'next/image'

import { Reveal } from '@/components/reveal'

export function Intro() {
  return (
    <section data-chapter="orange" className="relative overflow-x-clip bg-orange text-ink">
      <div className="shell relative flex min-h-[84svh] flex-col justify-center py-[10svh]">
        <Reveal>
          <p className="display max-w-[44ch] t-lead leading-[1.18] tracking-[-0.01em] text-ink">
            One track you love. The next twenty, found. YouTube&rsquo;s API has no{' '}
            <span className="inline-block w-[1.6em]" aria-hidden="true" />
            songs-like-this endpoint, so we build one from the four that exist.
          </p>
        </Reveal>

        <Image
          src="/img/das-vinyl-dreht-sich.jpg"
          alt="A tonearm tracking across a black vinyl record"
          width={1920}
          height={1280}
          className="pointer-events-none absolute right-[5vw] top-[14svh] hidden w-[17vw] rotate-[4deg] border-4 border-ink object-cover lg:block"
          loading="eager"
        />
      </div>
    </section>
  )
}
