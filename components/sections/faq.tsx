import Image from 'next/image'

import { Reveal } from '@/components/reveal'

const QUESTIONS = [
  {
    question: 'Does it download any audio?',
    answer:
      'No audio is downloaded or processed. needledrop reads YouTube metadata such as titles, channels, topics, durations and thumbnails, then writes a playlist of links that YouTube Music plays for you.',
  },
  {
    question: 'How does it know what sounds similar?',
    answer:
      'The Data API has no similarity endpoint, so the engine blends four sources (related videos, the artist’s catalogue, the seed’s Wikipedia topic and the regional music chart), then scores every candidate and shows its reasons.',
  },
  {
    question: 'What does a playlist cost?',
    answer:
      'Discovery costs vary with the searches and results needed, and the app shows an estimate before you commit. Writing to YouTube costs 50 units to create a playlist plus 50 units for each track inserted; the actual total can vary if tracks fail or calls need retrying.',
  },
  {
    question: 'Is my playlist public?',
    answer:
      'No. New playlists default to private, so nothing you generate accidentally exposes your taste. Unlisted and public are one click away, and public asks you to confirm.',
  },
  {
    question: 'Can I use my own API key?',
    answer:
      'Yes. Add your YouTube Data API key in Settings to use it for live searches and spend your own YouTube quota. The key is stored in a sealed cookie and can be removed from Settings. Google sign-in is still used separately when you save a playlist.',
  },
  {
    question: 'What happens when the shared quota runs out?',
    answer:
      'Live searches stop when the available quota is exhausted. You can add your own YouTube Data API key in Settings to use your own quota. If a playlist write has already started, some tracks may not be added; the app reports which could not be added and keeps the playlist when possible.',
  },
  {
    question: 'What does demo mode do?',
    answer:
      'Without a live YouTube Data API key, searches use the built-in demo catalogue. You can explore the flow, but a demo run does not create a playlist on YouTube.',
  },
  {
    question: 'Why might a track not play in YouTube Music?',
    answer:
      'Some recordings exist on YouTube but are not licensed into YouTube Music, and the public API cannot verify that. We disclose it rather than pretend, and you can remove any row before creating.',
  },
  {
    question: 'What happens to my Google data?',
    answer:
      'needledrop’s use of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements. We read YouTube metadata to build your playlist and keep your token in an encrypted cookie. You can request deletion of your saved app data from the privacy page. No audio, no selling, no model training. The full policy is on the privacy page.',
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
            src="/img/kehlani-it-was-good-until-it-wasnt.jpg"
            alt="Album cover for Kehlani's It Was Good Until It Wasn't"
            width={1370}
            height={1370}
            loading="lazy"
            className="pointer-events-none absolute right-[4vw] bottom-[4svh] w-[30vw] rotate-[6deg] border-4 border-ink object-cover opacity-40 sm:w-[24vw] sm:opacity-70 lg:bottom-auto lg:top-1/2 lg:w-[16vw] lg:-translate-y-1/2 lg:opacity-100"
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
