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
          src="/img/sza-ctrl.jpg"
          alt="Album cover for SZA's Ctrl"
          width={1920}
          height={1280}
          className="pointer-events-none absolute right-[4vw] bottom-[8svh] w-[30vw] rotate-[4deg] border-4 border-ink object-cover opacity-40 sm:w-[28vw] sm:opacity-70 lg:bottom-auto lg:top-[14svh] lg:w-[17vw] lg:opacity-100"
          loading="eager"
        />
      </div>
    </section>
  )
}
