import { NextResponse } from 'next/server'

import type { ErrorCode } from './errors'

/**
 * Response helpers (PLAN §15 conventions).
 *
 * Every response carries `unitsSpent` so the UI can reconcile the estimate it
 * showed before the click with what the call actually cost. Successful
 * payloads stay flat — `{ seeds, unitsSpent, calls }` — so the existing
 * client keeps working unchanged.
 */

export type ResponseMeta = {
  unitsSpent?: number
  calls?: number
  requestId?: string
  demo?: boolean
  [key: string]: unknown
}

export function ok<T extends Record<string, unknown>>(
  data: T,
  meta: ResponseMeta = {},
): NextResponse {
  return NextResponse.json({ ...data, ...meta })
}

export function fail(
  code: ErrorCode,
  message: string,
  status: number,
  meta: ResponseMeta = {},
): NextResponse {
  return NextResponse.json({ code, message, ...meta }, { status })
}

export function noContent(meta: ResponseMeta = {}): NextResponse {
  return NextResponse.json({ ok: true, ...meta })
}

/** Text response for exports (`.m3u`, `.csv`, …). */
export function text(body: string, contentType: string, filename?: string): NextResponse {
  const headers: Record<string, string> = { 'Content-Type': contentType }
  if (filename) headers['Content-Disposition'] = `attachment; filename="${filename}"`
  return new NextResponse(body, { status: 200, headers })
}
