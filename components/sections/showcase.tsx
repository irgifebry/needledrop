import Image from 'next/image'

import { Reveal } from '@/components/reveal'

export function Showcase() {
  return (
    <section data-chapter="ink" className="relative overflow-hidden bg-ink text-paper">
      <div className="shell relative py-[12svh]">
        <div className="relative">
          <h2 className="display relative z-20 t-mega leading-[0.88] tracking-[-0.03em]">
            <span className="block whitespace-nowrap">Official channel</span>
            <span className="block whitespace-nowrap">Same topic</span>
          </h2>
          <p
            aria-hidden="true"
            className="display relative z-20 mt-4 whitespace-nowrap t-headline leading-[0.9] tracking-[-0.02em] text-mint"
          >
            Similar length
          </p>

          <Image
            src="/img/tyler-the-creator-chromakopia.jpg"
            alt="Album cover for Tyler, The Creator's CHROMAKOPIA"
            width={1920}
            height={768}
            className="pointer-events-none absolute right-[-4vw] top-[-4svh] z-10 w-[34vw] rotate-[-4deg] border-4 border-paper object-cover opacity-40 sm:w-[40vw] sm:opacity-70 lg:w-[46vw] lg:opacity-100"
          />
        </div>

        <div className="mt-16 grid grid-cols-12 gap-[var(--gap)]">
          <Reveal className="col-span-12 lg:col-span-5 lg:col-start-8">
            <p className="max-w-[46ch] t-lead leading-relaxed text-paper/85">
              Every track carries the signals that produced its score. Same Wikipedia topic is worth
              the most; an official artist channel, a title of similar shape and a duration within a
              quarter of the seed add to it.
            </p>
            <p className="mt-5 max-w-[46ch] t-body leading-relaxed text-paper/70">
              It is a ranking built from metadata, not from sound. The API exposes no audio
              features, so we never pretend otherwise. We show the receipt on every row so you
              can steer it.
            </p>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
