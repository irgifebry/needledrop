import Image from 'next/image'
import Link from 'next/link'

import { Generator } from '@/components/generator'
import { ButtonLink } from '@/components/ui/button'

export function Hero() {
  return (
    <section id="top" data-chapter="ink" className="relative overflow-x-clip bg-ink text-paper">
      <div className="shell relative flex min-h-[100svh] flex-col pt-[14svh] pb-[6svh]">
        <h1 className="display t-display relative z-20 max-w-[17ch]">
          <span className="block">DROP THE NEEDLE.</span>
          <span className="block text-mint">GET THE SESSION.</span>
        </h1>

        {/* Cut-out sleeves, pasted over the type like a poster. */}
        <Image
          src="/img/queen-david-bowie-under-pressure.jpg"
          alt="Public domain single sleeve for Queen and David Bowie’s Under Pressure"
          width={1500}
          height={1500}
          className="pointer-events-none absolute right-[-2vw] top-[6svh] z-30 hidden w-[24vw] rotate-[5deg] border-4 border-ink object-cover lg:block"
          loading="eager"
          fetchPriority="high"
        />
        <Image
          src="/img/frank-sinatra-that-s-life-1966-vinyl.jpg"
          alt="Public domain cover of Frank Sinatra’s 1966 album That’s Life"
          width={1468}
          height={1419}
          className="pointer-events-none absolute right-[10vw] top-[20svh] z-30 hidden w-[17vw] -rotate-[4deg] border-4 border-ink object-cover xl:block"
          loading="eager"
        />

        <div className="relative z-20 mt-auto grid grid-cols-12 items-end gap-[var(--gap)] pt-16">
          <div className="col-span-12 pb-10 lg:col-span-4 lg:pb-0">
            <p className="max-w-[34ch] t-lead text-paper/85">
              YouTube Music has no &ldquo;songs like this&rdquo; button. We built one out of the
              endpoints that do exist, and we show you the price before you pay it.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-4">
              <ButtonLink href="/#seed-input" size="lg">
                Drop a track
              </ButtonLink>
              <Link
                href="/#how"
                className="t-small font-semibold underline decoration-mint decoration-2 underline-offset-4 hover:text-mint"
              >
                See how the engine works
              </Link>
            </div>
          </div>

          <div className="col-span-12 lg:col-span-7 lg:col-start-6">
            <Generator />
          </div>
        </div>
      </div>
    </section>
  )
}
