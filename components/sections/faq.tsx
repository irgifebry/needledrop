import Image from 'next/image'

import { Reveal } from '@/components/reveal'

const QUESTIONS = [
  {
    question: 'Does it download any audio?',
    answer:
      'No. Nothing is fetched, stored, remixed or separated. needledrop reads titles, channels, topics, durations and thumbnails, then writes a playlist of links that YouTube Music plays for you.',
  },
  {
    question: 'How does it know what sounds similar?',
    answer:
      'The Data API has no similarity endpoint, so the engine blends four sources (related videos, the artist’s catalogue, the seed’s Wikipedia topic and the regional music chart), then scores every candidate and shows its reasons.',
  },
  {
    question: 'What does a playlist cost?',
    answer:
      'Around 1,450 units for a 20-track playlist against a daily pool of 10,000. The estimate is on screen before you commit, and a dry run costs nothing at all.',
  },
  {
    question: 'Is my playlist public?',
    answer:
      'No. New playlists default to private, so nothing you generate accidentally exposes your taste. Unlisted and public are one click away, and public asks you to confirm.',
  },
  {
    question: 'Can I use my own API key?',
    answer:
      'Yes, behind a labelled toggle. Your own key bypasses the shared project quota and is stored encrypted in your session, never logged.',
  },
  {
    question: 'Why might a track not play in YouTube Music?',
    answer:
      'Some recordings exist on YouTube but are not licensed into YouTube Music, and the public API cannot verify that. We disclose it rather than pretend, and you can remove any row before creating.',
  },
  {
    question: 'What happens to my Google data?',
    answer:
      'needledrop’s use of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements. We read YouTube metadata to build your playlist, keep your token in an encrypted cookie, and delete everything on request. No audio, no selling, no model training. The full policy is on the privacy page.',
  },
]

export function Faq() {
  return (
    <section id="faq">
      <div className="bg-paper">
        <div className="relative flex min-h-[40svh] items-end overflow-x-clip bg-mint py-[6svh] text-ink">
          <div className="shell relative">
            <Reveal>
              <h2 className="display t-mega leading-[0.9]">Questions</h2>
            </Reveal>
          </div>
          <Image
            src="/img/duke-of-earl-by-gene-chandler.jpg"
            alt="Public domain artwork for the 1961 single Duke of Earl by Gene Chandler"
            width={1370}
            height={1370}
            loading="lazy"
            className="pointer-events-none absolute right-[4vw] top-1/2 hidden w-[16vw] -translate-y-1/2 rotate-[6deg] border-4 border-ink object-cover lg:block"
          />
        </div>

        {QUESTIONS.map((entry, index) => (
          <div
            key={entry.question}
            data-chapter={index % 2 === 0 ? 'paper' : 'paper-2'}
            className={index % 2 === 0 ? 'bg-paper' : 'bg-paper-2'}
          >
            <div className="shell grid grid-cols-12 gap-[var(--gap)] py-14">
              <Reveal className="col-span-12 lg:col-span-5">
                <h3 className="t-title font-semibold leading-snug">{entry.question}</h3>
              </Reveal>
              <Reveal delay={70} className="col-span-12 lg:col-span-6 lg:col-start-7">
                <p className="max-w-[56ch] t-body leading-relaxed text-ink/75">
                  {entry.answer}
                </p>
              </Reveal>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
