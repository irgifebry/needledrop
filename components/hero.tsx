import Image from 'next/image'
import Link from 'next/link'

import { Generator } from '@/components/generator'

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
          src="/img/daniel-caesar-son-of-spergy.jpg"
          alt="Album cover for Daniel Caesar's Son of Spergy"
          width={1000}
          height={1000}
          className="pointer-events-none absolute right-[-2vw] top-[6svh] z-10 w-[26vw] rotate-[5deg] border-4 border-ink object-cover opacity-40 sm:w-[30vw] sm:opacity-70 lg:w-[24vw] lg:opacity-100"
          loading="eager"
          fetchPriority="high"
        />
        <Image
          src="/img/frank-ocean-provider.jpg"
          alt="Album cover for Frank Ocean's Provider"
          width={1000}
          height={1000}
          className="pointer-events-none absolute right-[2vw] top-[18svh] z-10 w-[22vw] -rotate-[4deg] border-4 border-ink object-cover opacity-40 sm:w-[22vw] sm:opacity-70 xl:w-[17vw] xl:opacity-100"
          loading="eager"
        />

        <div className="relative z-20 mt-auto grid grid-cols-12 items-end gap-[var(--gap)] pt-16">
          <div className="col-span-12 pb-10 lg:col-span-4 lg:pb-0">
            <p className="max-w-[34ch] t-lead text-paper/85">
              YouTube Music has no &ldquo;songs like this&rdquo; button. We built one out of the
              endpoints that do exist, and we show you the price before you pay it.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-4">
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
