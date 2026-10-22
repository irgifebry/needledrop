import { Reveal } from '@/components/reveal'

const TILES = [
  {
    className: 'col-span-12 lg:col-span-6',
    style: { backgroundColor: '#a7ff9c', color: '#0b0b0b' },
    figure: '10,000',
    caption: 'YouTube API units per day, shared by everyone on the project.',
  },
  {
    className: 'col-span-6 lg:col-span-3 lg:mt-[14vh]',
    style: { backgroundColor: '#0b0b0b', color: '#ffffff' },
    figure: '1,450',
    caption: 'Roughly the units for one 20-track playlist.',
  },
  {
    className: 'col-span-6 lg:col-span-3 lg:mt-[26vh]',
    style: { backgroundColor: '#ff6831', color: '#0b0b0b' },
    figure: '50',
    caption: 'The most tracks a single playlist can hold.',
  },
]

export function Stats() {
  return (
    <section data-chapter="paper" className="bg-paper text-ink">
      <div className="shell py-[12svh]">
        <div className="grid grid-cols-12 gap-2">
          <Reveal className="col-span-12 mb-6 lg:col-span-3 lg:mb-0">
            <h2 className="display t-sub leading-none lg:mt-[4vh]">The numbers, up front</h2>
          </Reveal>

          {TILES.map((tile, index) => (
            <Reveal
              key={tile.figure}
              delay={index * 80}
              className={`min-h-[38vh] ${tile.className}`}
            >
              <div
                style={tile.style}
                className="flex h-full min-h-[38vh] flex-col justify-between p-7"
              >
                <span className="tnum display t-headline leading-none">
                  {tile.figure}
                </span>
                <span className="max-w-[30ch] t-body leading-snug opacity-85">{tile.caption}</span>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
