/**
 * Lineage markers for app-generated playlists (PLAN §13.4).
 *
 * A marker is an HTML comment hidden in a playlist description. It lets the
 * app recognise "this playlist was made by NeedleDrop" straight from the
 * YouTube API — no database, no cookies — so the marker survives a new
 * device, a cleared session and an app upgrade that forgot every run id.
 *
 * Format:
 *
 * ```
 * <!--ytmg run=01J8X... v=2 seed=abc123 -->
 * ```
 *
 * The module is deliberately pure: no I/O, no `node:*`, no `next/*`. The
 * marker is plain text, so it can be parsed by hand in a debug session.
 */

/** Opening tag of the lineage marker. Everything the app writes starts with it. */
export const LINEAGE_MARKER = '<!--ytmg'

/** The marker payload — `run` points at the generation run, `v` at the engine version. */
export type Lineage = {
  run?: string
  version?: number
  seed?: string
}

/** Input for {@link buildLineageMarker}; every field is optional. */
export type LineageInput = {
  run?: string
  version?: number
  seed?: string
}

type MarkerSpan = {
  /** Index of the first character of the marker. */
  start: number
  /** Index just past the last character of the marker. */
  end: number
  /** The text between `<!--ytmg` and `-->`. */
  body: string
}

/**
 * Locates the marker inside a description.
 *
 * A hand-rolled scan instead of a regex because the marker is written by
 * users too: a description that merely mentions `<!--ytmg` without closing it
 * must not be mistaken for a marker, and the body must not swallow a second
 * `<!--` from the user's own text.
 */
function findMarker(description: string): MarkerSpan | null {
  if (!description) return null

  const start = description.toLowerCase().indexOf(LINEAGE_MARKER)
  if (start === -1) return null

  const bodyStart = start + LINEAGE_MARKER.length
  const after = description[bodyStart]
  // `<!--ytmg` must be followed by whitespace or the closing `-->`; anything
  // else is a word that happens to start with the same letters.
  if (after !== undefined && !/[\s-]/.test(after)) return null

  const close = description.indexOf('-->', bodyStart)
  if (close === -1) return null

  return { start, end: close + 3, body: description.slice(bodyStart, close) }
}

/** Keeps a marker value from breaking out of the comment. */
function sanitizeToken(value: string): string {
  return value.replace(/\s+/g, '-').replace(/[<>]/g, '').replace(/-->/g, '')
}

/**
 * Builds the marker for a playlist description.
 *
 * The run id is what lets the UI say "v2 of <previous playlist>", so it is
 * worth writing even when nothing else is known.
 */
export function buildLineageMarker(input: LineageInput): string {
  const parts: string[] = []

  if (input.run) parts.push(`run=${sanitizeToken(input.run)}`)
  if (typeof input.version === 'number' && Number.isFinite(input.version)) {
    parts.push(`v=${Math.trunc(input.version)}`)
  }
  if (input.seed) parts.push(`seed=${sanitizeToken(input.seed)}`)

  if (parts.length === 0) return `${LINEAGE_MARKER} -->`
  return `${LINEAGE_MARKER} ${parts.join(' ')} -->`
}

/**
 * Reads the marker back out of a description.
 *
 * Returns `null` when the description carries no marker at all — that is the
 * signal the library view uses to tell "made by us" from "made by the user".
 */
export function parseLineage(description: string): Lineage | null {
  const marker = findMarker(description)
  if (!marker) return null

  const lineage: Lineage = {}

  for (const token of marker.body.trim().split(/\s+/)) {
    if (!token) continue
    const separator = token.indexOf('=')
    if (separator <= 0) continue

    const key = token.slice(0, separator).toLowerCase()
    const value = token.slice(separator + 1)
    if (!value) continue

    if (key === 'run') {
      lineage.run = value
    } else if (key === 'seed') {
      lineage.seed = value
    } else if (key === 'v' || key === 'version') {
      const version = Number.parseInt(value, 10)
      if (Number.isFinite(version)) lineage.version = version
    }
  }

  return lineage
}

/** True when the description carries a lineage marker. */
export function hasLineage(description: string): boolean {
  return findMarker(description) !== null
}

/**
 * Returns the raw marker text (`<!--ytmg … -->`) so it can be re-appended
 * verbatim after an edit. `null` when the description has no marker.
 */
export function extractLineageMarker(description: string): string | null {
  const marker = findMarker(description)
  if (!marker) return null
  return description.slice(marker.start, marker.end)
}

/**
 * Appends a marker to a description without mangling it.
 *
 * Any marker already present is removed first, so calling this twice can
 * never leave two markers behind — the second call simply replaces the first.
 */
export function appendLineage(description: string, marker: string): string {
  const base = stripLineage(description)
  if (!marker) return base
  if (!base) return marker
  return `${base}\n\n${marker}`
}

/**
 * Removes the marker and returns the user's own text.
 *
 * Used on the way in and out of an edit so the marker never shows up in a
 * text field and never gets lost by a round-trip.
 */
export function stripLineage(description: string): string {
  if (!description) return ''

  const marker = findMarker(description)
  if (!marker) return description

  const without = description.slice(0, marker.start) + description.slice(marker.end)
  return without.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}
