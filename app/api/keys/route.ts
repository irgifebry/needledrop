import { z } from 'zod'

import { withRoute } from '@/lib/http/handler'
import { fail, ok } from '@/lib/http/respond'
import { clearUserApiKey, readUserApiKey, writeUserApiKey } from '@/lib/session'
import { verifyApiKey } from '@/lib/youtube/api-key'

/**
 * `POST /api/keys` — store the visitor's own YouTube API key.
 *
 * The shared project key pays for every search, and the project's daily
 * budget is a hundred searches. A key from the visitor's own Google Cloud
 * project moves their traffic onto their own quota.
 *
 * The key is verified before it is stored, with a one-unit probe rather than
 * a search, and it is kept in a sealed cookie: never logged, never rendered
 * back to the browser, and gone when the cookie is cleared.
 */

const Body = z.object({
  apiKey: z.string().min(1).max(200),
})

export const POST = withRoute(
  async ({ request, meter }) => {
    const parsed = Body.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return fail('invalid_request', 'An API key is required.', 400, {
        unitsSpent: meter.units,
        calls: meter.calls,
      })
    }

    const check = await verifyApiKey(parsed.data.apiKey, meter)
    if (!check.ok) {
      return fail('invalid_request', check.message, 400, {
        unitsSpent: meter.units,
        calls: meter.calls,
      })
    }

    await writeUserApiKey(parsed.data.apiKey.trim())

    return ok(
      { configured: true },
      { unitsSpent: meter.units, calls: meter.calls },
    )
  },
  { scope: 'keys', limit: 5 },
)

/** `DELETE /api/keys` — forget the visitor's own key. */
export const DELETE = withRoute(
  async () => {
    await clearUserApiKey()
    return ok({ configured: false })
  },
  { scope: 'keys', limit: 10 },
)

/** `GET /api/keys` — whether a key is set. The key itself is never returned. */
export const GET = withRoute(
  async () => {
    const key = await readUserApiKey()
    return ok({ configured: Boolean(key) })
  },
  { scope: 'keys', limit: 30 },
)
