import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

import { cookies } from 'next/headers'

import { isProduction } from '@/lib/env'
import { logger } from '@/lib/observability/logger'

import {
  getDb,
  memoryDb,
  StoreUnavailableError,
  type BlockInput,
  type BlockKind,
  type BlockRow,
  type DbClient,
  type DeleteCounts,
  type FeedbackInput,
  type FeedbackRow,
  type PresetInput,
  type PresetRow,
  type QuotaEntryInput,
  type RunInput,
  type RunRow,
  type StoreLabel,
} from './client'

/**
 * The repository layer for the optional store (PLAN §13.8, §13.11).
 *
 * Every function here is scoped to an `anonId` — a random, cookie-signed
 * identifier. There is no account required and no email is ever stored by
 * default, so the store holds no PII. The id is never logged.
 *
 * Each function works against whichever store is live (PostgREST or the
 * in-memory fallback) and degrades silently: a database that is missing or
 * unreachable must never turn into a 500, because the app is designed to run
 * without one.
 */

const ANON_COOKIE = 'needledrop_anon'
/** One year. The identifier only has to outlive a browser session. */
const ANON_MAX_AGE = 60 * 60 * 24 * 365

/* ── the anonymous identifier ──────────────────────────────────────────────── */

let signingKeyCache: { source: string; key: Buffer } | null = null

/**
 * The key used to sign the anonymous cookie.
 *
 * `SESSION_SECRET` when it is configured, so the id survives a restart and a
 * redeploy. Without it we fall back to a per-process random key: the cookie
 * stays tamper-evident for the lifetime of the process, which is exactly as
 * much as the stateless (memory) store can honour anyway.
 */
function signingKey(): Buffer {
  const secret = process.env.SESSION_SECRET ?? ''
  const source = secret.length >= 32 ? secret : 'process'
  if (signingKeyCache && signingKeyCache.source === source) return signingKeyCache.key
  const key = source === 'process' ? randomBytes(32) : createHash('sha256').update(secret).digest()
  signingKeyCache = { source, key }
  return key
}

function newAnonId(): string {
  return randomBytes(18).toString('base64url')
}

function signAnonId(id: string): string {
  return createHmac('sha256', signingKey()).update(id).digest('base64url')
}

/** Returns the id inside a cookie value, or null when the signature is wrong. */
function readAnonCookie(value: string): string | null {
  const separator = value.lastIndexOf('.')
  if (separator <= 0) return null
  const id = value.slice(0, separator)
  const given = Buffer.from(value.slice(separator + 1))
  const expected = Buffer.from(signAnonId(id))
  if (given.length !== expected.length) return null
  if (!timingSafeEqual(given, expected)) return null
  return id
}

/** The cookie jar Next hands us inside a request scope. */
type CookieStore = Awaited<ReturnType<typeof cookies>>

async function writeAnonCookie(store: CookieStore, id: string): Promise<void> {
  store.set(ANON_COOKIE, `${id}.${signAnonId(id)}`, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax',
    path: '/',
    maxAge: ANON_MAX_AGE,
  })
}

/**
 * The caller's anonymous id.
 *
 * Reads the signed `needledrop_anon` cookie and mints one when it is absent
 * or fails verification. Because the cookie is httpOnly it cannot be read or
 * forged from client-side JavaScript.
 */
export async function getAnonId(): Promise<string> {
  try {
    const store = await cookies()
    const raw = store.get(ANON_COOKIE)?.value
    if (raw) {
      const existing = readAnonCookie(raw)
      if (existing) return existing
    }
    const id = newAnonId()
    writeAnonCookie(store, id)
    return id
  } catch {
    // No cookie jar (a script, a unit test, a background job): hand back an
    // id that simply is not remembered anywhere.
    return newAnonId()
  }
}

/**
 * Issues a fresh anonymous id.
 *
 * Used after "delete all my data": the old cookie must not be able to reach
 * the data that was just erased.
 */
export async function rotateAnonId(): Promise<string> {
  const id = newAnonId()
  try {
    const store = await cookies()
    writeAnonCookie(store, id)
  } catch {
    // Nothing to write to — the id stays ephemeral.
  }
  return id
}

/* ── store plumbing ────────────────────────────────────────────────────────── */

/**
 * Runs an operation against the live store and falls back to the in-memory
 * one when the database turns out to be unreachable. This is the whole
 * "degradation" promise of PLAN §13.8 in one place.
 */
async function withStore<T>(operation: (db: DbClient) => Promise<T>): Promise<T> {
  const db = getDb()
  try {
    return await operation(db)
  } catch (error) {
    if (error instanceof StoreUnavailableError) {
      logger.warn('store: the database is unavailable, using the in-memory store instead', {
        error,
      })
      return operation(memoryDb())
    }
    throw error
  }
}

/**
 * Which store served the request: `memory` or `postgres`.
 *
 * Call it *after* the operation, because a failing request flips the store
 * into its degraded (memory) mode.
 */
export function storeLabel(): StoreLabel {
  return getDb().kind === 'rest' ? 'postgres' : 'memory'
}

/* ── presets ───────────────────────────────────────────────────────────────── */

/** Every preset saved by this anonymous id, newest first. */
export async function listPresets(anonId: string): Promise<PresetRow[]> {
  return withStore((db) => db.listPresets(anonId))
}

/**
 * Saves a preset, replacing any earlier one with the same name.
 *
 * The name is the key: re-saving "Focus" is how a user tweaks a preset
 * instead of accumulating near-duplicates.
 */
export async function savePreset(
  anonId: string,
  input: PresetInput,
): Promise<PresetRow> {
  const name = input.name.trim()
  return withStore((db) => db.savePreset(anonId, { name, options: input.options }))
}

/** Removes one preset by id. */
export async function deletePreset(anonId: string, id: string): Promise<boolean> {
  return withStore((db) => db.deletePreset(anonId, id))
}

/** Removes one preset by name — how the UI deletes "Focus". */
export async function deletePresetByName(anonId: string, name: string): Promise<boolean> {
  return withStore((db) => db.deletePresetByName(anonId, name.trim()))
}

/* ── blocks ────────────────────────────────────────────────────────────────── */

/**
 * Normalises a blocked value so the same thing cannot be blocked twice.
 *
 * Artists and keywords are matched case-insensitively during discovery, so
 * they are stored lower-cased. A YouTube video id is case-sensitive and is
 * stored verbatim.
 */
function normalizeBlockValue(kind: BlockKind, value: string): string {
  const trimmed = value.trim()
  return kind === 'video_id' ? trimmed : trimmed.toLowerCase()
}

/** Every block set by this anonymous id, newest first. */
export async function listBlocks(anonId: string): Promise<BlockRow[]> {
  return withStore((db) => db.listBlocks(anonId))
}

/** Blocks an artist, keyword or video id. Blocking the same thing twice is a no-op. */
export async function addBlock(anonId: string, input: BlockInput): Promise<BlockRow> {
  const value = normalizeBlockValue(input.kind, input.value)
  return withStore((db) => db.addBlock(anonId, { kind: input.kind, value }))
}

/** Removes one block by id. */
export async function removeBlock(anonId: string, id: string): Promise<boolean> {
  return withStore((db) => db.removeBlock(anonId, id))
}

/** Removes one block by kind and value — how the UI unblocks "Adele". */
export async function removeBlockByValue(
  anonId: string,
  kind: BlockKind,
  value: string,
): Promise<boolean> {
  return withStore((db) =>
    db.removeBlockByValue(anonId, kind, normalizeBlockValue(kind, value)),
  )
}

/* ── feedback ──────────────────────────────────────────────────────────────── */

/**
 * Records a keep/drop signal for one track.
 *
 * Feedback is the input to the ranking loop, so it is stored even when the
 * run it belongs to was never persisted.
 */
export async function recordFeedback(
  anonId: string,
  input: FeedbackInput,
): Promise<FeedbackRow> {
  return withStore((db) => db.recordFeedback(anonId, input))
}

/** Every feedback signal from this anonymous id, newest first. */
export async function listFeedback(anonId: string): Promise<FeedbackRow[]> {
  return withStore((db) => db.listFeedback(anonId))
}

/* ── runs ──────────────────────────────────────────────────────────────────── */

/** Appends one discovery run to the history. */
export async function recordRun(anonId: string, input: RunInput): Promise<RunRow> {
  return withStore((db) => db.recordRun(anonId, input))
}

/** The most recent runs of this anonymous id, newest first. */
export async function listRuns(anonId: string, limit = 20): Promise<RunRow[]> {
  return withStore((db) => db.listRuns(anonId, limit))
}

/* ── quota ledger ──────────────────────────────────────────────────────────── */

/** Appends one unit-accounting entry. Used by the quota governance layer. */
export async function recordQuotaUsage(entry: QuotaEntryInput): Promise<void> {
  await withStore((db) => db.recordQuotaUsage(entry))
}

/* ── compliance ────────────────────────────────────────────────────────────── */

/**
 * Deletes everything stored for one anonymous id (PLAN §13.11).
 *
 * This is the backend of the "delete all my data" control. It returns how
 * many rows went away per table so the UI can tell the user what happened.
 */
export async function deleteAllUserData(anonId: string): Promise<DeleteCounts> {
  return withStore((db) => db.deleteAll(anonId))
}
