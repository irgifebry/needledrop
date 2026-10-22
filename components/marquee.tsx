const ITEMS = [
  'Resolve',
  'Gather',
  'Hydrate',
  'Score',
  'Diversify',
  'Create',
  'Metadata only',
  'Quota shown first',
  'Every score explained',
]

export function Marquee() {
  const strip = [...ITEMS, ...ITEMS]

  return (
    <section data-chapter="mint" className="overflow-hidden border-y-4 border-ink bg-mint text-ink">
      <div className="marquee-track py-3" aria-hidden="true">
        {strip.map((item, index) => (
          <span key={`${item}-${index}`} className="flex items-center whitespace-nowrap">
            <span className="px-6 t-lead font-semibold">{item}</span>
            <span className="size-2 rotate-45 bg-ink" />
          </span>
        ))}
      </div>
      <p className="sr-only">
        The engine resolves a seed track, gathers candidates from four sources, hydrates them,
        scores them, diversifies the list and creates the playlist.
      </p>
    </section>
  )
}
