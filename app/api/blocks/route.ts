import { z } from 'zod'

import {
  addBlock,
  getAnonId,
  listBlocks,
  removeBlock,
  removeBlockByValue,
  storeLabel,
} from '@/lib/db/repo'
import { readJson, withRoute } from '@/lib/http/handler'
import { fail, ok } from '@/lib/http/respond'

/**
 * `GET | POST | DELETE /api/blocks` — blocked artists, keywords and videos.
 *
 * A block is matched during discovery so the same unwanted track never comes
 * back. Blocks are scoped to the anonymous id in the `needledrop_anon`
 * cookie; nothing here is PII.
 *
 * The store is optional: the response always carries `"store"`, which is
 * `"memory"` when no database is configured or reachable and `"postgres"`
 * when the rows really are persisted.
 */

const Kind = z.enum(['artist', 'keyword', 'video_id'])

const Body = z.object({
  kind: Kind,
  value: z.string().trim().min(1).max(120),
})

export const GET = withRoute(
  async ({ meter }) => {
    const anonId = await getAnonId()
    const blocks = await listBlocks(anonId)

    return ok(
      { blocks },
      { store: storeLabel(), unitsSpent: meter.units, calls: meter.calls },
    )
  },
  { scope: 'blocks', limit: 60 },
)

export const POST = withRoute(
  async ({ request, meter }) => {
    const parsed = Body.safeParse(await readJson(request))
    if (!parsed.success) {
      return fail(
        'invalid_request',
        'A block needs a kind (artist, keyword or video_id) and a value.',
        400,
        { unitsSpent: meter.units, calls: meter.calls },
      )
    }

    const anonId = await getAnonId()
    const block = await addBlock(anonId, {
      kind: parsed.data.kind,
      value: parsed.data.value,
    })

    return ok(
      { block },
      { store: storeLabel(), unitsSpent: meter.units, calls: meter.calls },
    )
  },
  { scope: 'blocks', limit: 60 },
)

export const DELETE = withRoute(
  async ({ url, meter }) => {
    const id = url.searchParams.get('id')
    const rawKind = url.searchParams.get('kind')
    const value = url.searchParams.get('value')

    const anonId = await getAnonId()
    const respond = (removed: boolean) =>
      removed
        ? ok(
            { removed: true },
            { store: storeLabel(), unitsSpent: meter.units, calls: meter.calls },
          )
        : fail('not_found', 'No block with that id or value.', 404, {
            unitsSpent: meter.units,
            calls: meter.calls,
          })

    if (id) {
      return respond(await removeBlock(anonId, id))
    }

    if (!rawKind || !value) {
      return fail(
        'invalid_request',
        'Pass ?id=<block id> or ?kind=<kind>&value=<value> to remove a block.',
        400,
        { unitsSpent: meter.units, calls: meter.calls },
      )
    }

    const kind = Kind.safeParse(rawKind)
    if (!kind.success) {
      return fail(
        'invalid_request',
        'The kind must be artist, keyword or video_id.',
        400,
        { unitsSpent: meter.units, calls: meter.calls },
      )
    }

    return respond(await removeBlockByValue(anonId, kind.data, value))
  },
  { scope: 'blocks', limit: 60 },
)
