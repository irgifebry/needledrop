import Image from 'next/image'

import { ButtonLink } from '@/components/ui/button'
import { Reveal } from '@/components/reveal'

export function Cta() {
  return (
    <section data-chapter="ink" className="relative overflow-x-clip bg-ink text-paper">
      <div className="shell relative flex min-h-[86svh] flex-col justify-center py-[12svh]">
        <Reveal>
          <h2 className="display t-mega relative z-20 max-w-[15ch] tracking-[-0.03em]">
            One track in. A whole session out.
          </h2>
        </Reveal>

        <div className="pointer-events-none absolute right-[-2vw] bottom-[6svh] z-10 w-[44vw] rotate-[-5deg] border-4 border-paper opacity-40 sm:w-[40vw] sm:opacity-70 lg:bottom-auto lg:top-1/2 lg:w-[34vw] lg:-translate-y-1/2 lg:opacity-100">
          <Image
            src="/img/giveon-give-or-take.jpg"
            alt="Album cover for GIVĒON's Give Or Take"
            width={1920}
            height={1078}
            loading="lazy"
            className="drift h-full w-full object-cover"
          />
        </div>

        <div className="relative z-20 mt-16 grid grid-cols-12 items-end gap-[var(--gap)]">
          <Reveal delay={80} className="col-span-12 lg:col-span-5">
            <p className="max-w-[40ch] t-lead text-paper/70">
              No account needed to try it. Sign in only when you want the playlist to land on your
              own YouTube Music.
            </p>
          </Reveal>
          <Reveal delay={140} className="col-span-12 lg:col-span-3 lg:col-start-10">
            <ButtonLink href="/#seed-input" size="lg" block>
              Drop a track
            </ButtonLink>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
