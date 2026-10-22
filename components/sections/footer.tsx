import { ButtonLink } from '@/components/ui/button'

const BLOCK_COLOURS = ['#a7ff9c', '#ff6831', '#ffffff', '#a7ff9c', '#ff6831', '#ffffff', '#a7ff9c', '#ff6831', '#ffffff', '#a7ff9c']
const WORD = 'NEEDLEDROP'

const LINK_COLUMNS = [
  {
    title: 'Product',
    links: [
      { label: 'How it works', href: '#how' },
      { label: 'Why it works', href: '#why' },
      { label: 'Questions', href: '#faq' },
    ],
  },
  {
    title: 'Engine',
    links: [
      { label: 'Similarity scoring', href: '#why' },
      { label: 'Quota model', href: '#faq' },
      { label: 'Metadata only', href: '#faq' },
    ],
  },
  {
    title: 'Docs',
    links: [
      {
        label: 'Implementation plan',
        href: 'https://github.com/irgifebry/needledrop/blob/main/docs/PLAN.md',
      },
      {
        label: 'Feature addendum',
        href: 'https://github.com/irgifebry/needledrop/blob/main/docs/PLAN-ADDENDUM.md',
      },
    ],
  },
  {
    title: 'Project',
    links: [
      { label: 'Source code', href: 'https://github.com/irgifebry/needledrop' },
      {
        label: 'Privacy policy',
        href: '/privacy',
      },
      {
        label: 'MIT licence',
        href: 'https://github.com/irgifebry/needledrop/blob/main/LICENSE',
      },
    ],
  },
]

export function SiteFooter() {
  return (
    <footer data-chapter="ink" className="bg-ink text-paper">
      <div className="shell pt-[10svh] pb-[4svh]">
        <div className="flex h-[26svh] min-h-[220px] items-end gap-1" aria-label="needledrop">
          {WORD.split('').map((letter, index) => {
            const height = 60 + ((index * 40) / (WORD.length - 1))
            return (
              <span
                key={`${letter}-${index}`}
                aria-hidden="true"
                className="display flex flex-1 items-end justify-center pt-3 t-mark leading-[0.8] text-ink"
                style={{
                  height: `${height}%`,
                  backgroundColor: BLOCK_COLOURS[index % BLOCK_COLOURS.length],
                }}
              >
                {letter}
              </span>
            )
          })}
        </div>

        <div className="mt-16 grid grid-cols-12 gap-[var(--gap)]">
          <div className="col-span-12 grid grid-cols-2 gap-8 sm:grid-cols-4 lg:col-span-8">
            {LINK_COLUMNS.map((column) => (
              <div key={column.title} className="flex flex-col gap-2">
                <p className="t-small font-semibold">{column.title}</p>
                {column.links.map((link) => (
                  <a
                    key={link.label}
                    href={link.href}
                    className="t-small text-paper/65 transition-colors hover:text-mint"
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            ))}
          </div>

          <div className="col-span-12 flex flex-col gap-2 lg:col-span-4">
            <p className="t-small text-paper/65">
              Built on the YouTube Data API v3.
            </p>
            <p className="t-small text-paper/65">
              Metadata only. No audio is ever downloaded.
            </p>
            <a
              href="mailto:hello@needledrop.app"
              className="t-small text-paper/65 transition-colors hover:text-mint"
            >
              hello@needledrop.app
            </a>
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-6 border-t-2 border-paper/15 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="t-small text-paper/70">
            © {new Date().getFullYear()} needledrop · MIT licence
          </p>
          <ButtonLink href="#seed-input" size="sm" variant="mint">
            Drop a track
          </ButtonLink>
        </div>

        <p className="mt-6 max-w-[70ch] t-small leading-relaxed text-paper/60">
          Pictures: &ldquo;Groove and needle in close embrace from beginning to end&rdquo; by Franz van
          Duns, CC BY-SA 4.0; &ldquo;Pioneer PL-200 turntable with an aftermarket dustbug&rdquo; by
          Miroslav Vajdic, CC BY-SA 2.0; &ldquo;Das Vinyl dreht sich&rdquo; by Sulamith Sallmann, CC
          BY-SA 4.0; &ldquo;Kazantip, Popovka, Crimea, Technics turntable&rdquo; by Vyacheslav
          Argenberg, CC BY 4.0; &ldquo;Frank Sinatra — That’s Life&rdquo; by Bill George, public
          domain; &ldquo;Duke of Earl&rdquo; by Vee Jay Records, public domain; &ldquo;Queen &amp;
          David Bowie — Under Pressure&rdquo;, public domain. All via Wikimedia Commons.
        </p>
      </div>
    </footer>
  )
}
