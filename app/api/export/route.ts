/**
 * POST /api/export — render a track list as a downloadable file
 * (PLAN §13.9 "Output · Export", §15).
 *
 * Zero quota: the renderers are pure and never touch YouTube, so this route
 * keeps working even when the API is down — which is exactly when a user
 * wants to save the list they already have.
 */

import { z } from 'zod'

import { parseTracksInput, renderExport } from '@/lib/export'
import { readJson, withRoute } from '@/lib/http/handler'
import { fail, ok, text } from '@/lib/http/respond'

/** The track list is capped so one request cannot render an unbounded file. */
const MAX_TRACKS = 200

const Body = z.object({
  format: z.enum(['m3u', 'csv', 'json', 'text']),
  tracks: z.array(z.unknown()).max(MAX_TRACKS),
  title: z.string().max(200).optional(),
})

export const POST = withRoute(
  async ({ request, url }) => {
    const parsed = Body.safeParse(await readJson(request))
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const field = issue?.path.join('.')
      return fail(
        'invalid_request',
        field ? `${field}: ${issue?.message ?? 'is invalid'}` : 'A format and a track list are required.',
        400,
        { unitsSpent: 0 },
      )
    }

    const tracks = parseTracksInput(parsed.data.tracks)
    if (tracks.length === 0) {
      return fail('invalid_request', 'Nothing to export.', 400, { unitsSpent: 0 })
    }

    const rendered = renderExport(parsed.data.format, tracks, {
      title: parsed.data.title,
      generatedAt: new Date().toISOString(),
    })

    // `?download=0` hands the raw file back as JSON so a client can decide
    // what to do with it (preview it, write it, hand it to another tool)
    // instead of letting the browser save it straight to disk.
    if (!wantsDownload(url)) {
      return ok(rendered, { unitsSpent: 0 })
    }

    return text(rendered.body, rendered.contentType, rendered.filename)
  },
  { scope: 'export' },
)

/** A download is the default; only an explicit opt-out returns JSON. */
function wantsDownload(url: URL): boolean {
  const value = url.searchParams.get('download')
  if (value === null) return true
  return !['0', 'false', 'no', 'off'].includes(value.toLowerCase())
}
