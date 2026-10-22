export function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return 'live'
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export function formatViews(count: number): string {
  if (count >= 1e9) return `${(count / 1e9).toFixed(1)}B views`
  if (count >= 1e6) return `${(count / 1e6).toFixed(1)}M views`
  if (count >= 1e3) return `${Math.round(count / 1e3)}K views`
  return `${count} views`
}

export function formatRelativeDate(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const years = Math.round((Date.now() - then) / (365.25 * 24 * 60 * 60 * 1000))
  if (years <= 0) return 'this year'
  if (years === 1) return 'last year'
  return `${years} years ago`
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural ?? `${singular}s`)
}
