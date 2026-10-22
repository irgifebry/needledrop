import { z } from 'zod'

import {
  deletePreset,
  deletePresetByName,
  getAnonId,
  listPresets,
  savePreset,
  storeLabel,
} from '@/lib/db/repo'
import { readJson, withRoute } from '@/lib/http/handler'
import { fail, ok } from '@/lib/http/respond'

/**
 * `GET | POST | DELETE /api/presets` — saved discovery configurations.
 *
 * A preset is a named bundle of options ("Focus · 25 tracks · 2015-2025 · no
 * live"). Presets are scoped to the anonymous id in the `needledrop_anon`
 * cookie, so they work without an account and without any PII.
 *
 * The store is optional: the response always carries `"store"`, which is
 * `"memory"` when no database is configured or reachable and `"postgres"`
 * when the rows really are persisted.
 */

const Body = z.object({
  name: z.string().trim().min(1).max(60),
  /** A loose object — the shape of the options is the engine's business. */
  options: z.looseObject({}),
})

export const GET = withRoute(
  async ({ meter }) => {
    const anonId = await getAnonId()
    const presets = await listPresets(anonId)

    return ok(
      { presets },
      { store: storeLabel(), unitsSpent: meter.units, calls: meter.calls },
    )
  },
  { scope: 'presets', limit: 60 },
)

export const POST = withRoute(
  async ({ request, meter }) => {
    const parsed = Body.safeParse(await readJson(request))
    if (!parsed.success) {
      return fail(
        'invalid_request',
        'A preset needs a name of 1-60 characters and an options object.',
        400,
        { unitsSpent: meter.units, calls: meter.calls },
      )
    }

    const anonId = await getAnonId()
    const preset = await savePreset(anonId, {
      name: parsed.data.name,
      options: parsed.data.options,
    })

    return ok(
      { preset },
      { store: storeLabel(), unitsSpent: meter.units, calls: meter.calls },
    )
  },
  { scope: 'presets', limit: 60 },
)

export const DELETE = withRoute(
  async ({ url, meter }) => {
    const id = url.searchParams.get('id')
    const name = url.searchParams.get('name')
    if (!id && !name) {
      return fail(
        'invalid_request',
        'Pass ?id=<preset id> or ?name=<preset name> to remove a preset.',
        400,
        { unitsSpent: meter.units, calls: meter.calls },
      )
    }

    const anonId = await getAnonId()
    const removed = id
      ? await deletePreset(anonId, id)
      : await deletePresetByName(anonId, name ?? '')

    if (!removed) {
      return fail('not_found', 'No preset with that id or name.', 404, {
        unitsSpent: meter.units,
        calls: meter.calls,
      })
    }

    return ok(
      { removed: true },
      { store: storeLabel(), unitsSpent: meter.units, calls: meter.calls },
    )
  },
  { scope: 'presets', limit: 60 },
)
