/**
 * The visitor's region (PLAN §13.1.7).
 *
 * `snippet.availableCountries` says where a video may be played. Knowing the
 * visitor's country lets the engine drop tracks that would not play for
 * them, instead of producing a playlist that silently fails to open.
 *
 * The region is **inferred**, never declared: the deployment platform sets
 * a geo header, and the browser sends the same value back as a cookie so it
 * survives the first request. An unknown region means "do not filter" —
 * guessing would be worse than admitting we do not know.
 */

const REGION_COOKIE = 'needledrop_region'

const GEO_HEADERS = [
  'x-vercel-ip-country',
  'cf-ipcountry',
  'x-country-code',
  'x-appengine-country',
]

const REGION_PATTERN = /^[A-Za-z]{2}$/

/** The two-letter country code for this request, or `null` when unknown. */
export function userRegion(request: Request): string | null {
  for (const header of GEO_HEADERS) {
    const value = request.headers.get(header)
    if (value && REGION_PATTERN.test(value.trim())) return value.trim().toUpperCase()
  }

  const cookie = request.headers.get('cookie') ?? ''
  const match = /(?:^|;\s*)needledrop_region=([A-Za-z]{2})(?:;|$)/.exec(cookie)
  if (match) return match[1].toUpperCase()

  return null
}

/**
 * The cookie to set so the region survives the next request.
 * Returns `null` when the region is unknown — there is nothing to remember.
 */
export function regionCookie(region: string | null): string | null {
  if (!region || !REGION_PATTERN.test(region)) return null
  return `${REGION_COOKIE}=${region.toUpperCase()}; Path=/; Max-Age=31536000; SameSite=Lax`
}
