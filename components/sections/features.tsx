import { Reveal } from '@/components/reveal'

type Field = 'mint' | 'ink' | 'orange' | 'grey'

type Feature = {
  chapter: Field
  field: Field
  ink: 'paper' | 'ink'
  phrase: string
  body: string
  rows: Array<{ label: string; value: string }>
  mirror?: boolean
}

const FEATURES: Feature[] = [
  {
    chapter: 'mint',
    field: 'mint',
    ink: 'ink',
    phrase: 'Cost before commit',
    body: 'Discovery estimates vary with the searches and results needed. Playlist writing adds 50 units to create it, plus 50 per track inserted; the app shows an estimate before you commit.',
    rows: [
      { label: '4 search calls', value: '400' },
      { label: '2 hydration calls', value: '2' },
      { label: 'Create the playlist', value: '50' },
      { label: '20 items inserted', value: '1000' },
    ],
  },
  {
    chapter: 'ink',
    field: 'ink',
    ink: 'paper',
    phrase: 'Every score explained',
    body: 'No black box. Same topic, official channel, similar length, found by two sources. Open any score and read the receipt.',
    rows: [
      { label: 'Same Wikipedia topic', value: '+40' },
      { label: 'Official artist channel', value: '+20' },
      { label: 'Title names the seed artist', value: '+10' },
      { label: 'Duration within 25%', value: '+5' },
    ],
    mirror: true,
  },
  {
    chapter: 'orange',
    field: 'orange',
    ink: 'ink',
    phrase: 'Live is not live',
    body: 'Version markers are read from the tag itself, not from a keyword hiding somewhere in the title.',
    rows: [
      { label: 'live · remix · acoustic', value: 'toggle' },
      { label: 'instrumental · karaoke', value: 'toggle' },
      { label: 'cover · sped up', value: 'toggle' },
      { label: 'nightcore · remaster', value: 'toggle' },
    ],
  },
  {
    chapter: 'grey',
    field: 'grey',
    ink: 'ink',
    phrase: 'Nothing downloaded',
    body: 'Metadata and links only. The playlist lives on YouTube Music, where you already listen.',
    rows: [
      { label: 'Title, channel, topic', value: 'read' },
      { label: 'Duration, publish date', value: 'read' },
      { label: 'Thumbnail, view count', value: 'read' },
      { label: 'Audio, stems, downloads', value: 'never' },
    ],
    mirror: true,
  },
]

const INK_CLASS: Record<'paper' | 'ink', string> = {
  paper: 'text-paper',
  ink: 'text-ink',
}

const FIELD_CLASS: Record<Field, string> = {
  mint: 'bg-mint',
  ink: 'bg-ink',
  orange: 'bg-orange',
  grey: 'bg-grey',
}

export function Features() {
  return (
    <section id="why">
      {FEATURES.map((feature) => (
        <div
          key={feature.phrase}
          data-chapter={feature.chapter}
          className={`relative min-h-[68svh] ${FIELD_CLASS[feature.field]} ${INK_CLASS[feature.ink]}`}
        >
          <div className="shell relative flex min-h-[68svh] flex-col py-[7svh]">
            <div className="grid grid-cols-12 gap-[var(--gap)]">
              <Reveal
                className={
                  feature.mirror
                    ? 'col-span-12 lg:col-span-4'
                    : 'col-span-12 lg:col-span-4 lg:col-start-9 lg:text-right'
                }
              >
                <p className="max-w-[36ch] t-lead">{feature.body}</p>
              </Reveal>

              <Reveal
                delay={90}
                className={
                  feature.mirror
                    ? 'col-span-12 lg:col-span-5 lg:col-start-8'
                    : 'col-span-12 lg:col-span-5'
                }
              >
                <dl className="flex flex-col">
                  {feature.rows.map((row) => (
                    <div
                      key={row.label}
                      className="flex items-baseline justify-between gap-6 border-t-2 border-current/25 py-3"
                    >
                      <dt className="t-body opacity-80">{row.label}</dt>
                      <dd className="tnum shrink-0 t-body font-semibold">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </Reveal>
            </div>

            <Reveal delay={160} className="mt-auto pt-14">
              <h2
                className={`display t-headline max-w-[14ch] ${
                  feature.mirror ? 'lg:text-right' : ''
                }`}
              >
                {feature.phrase}
              </h2>
            </Reveal>
          </div>
        </div>
      ))}
    </section>
  )
}
