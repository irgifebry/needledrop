import { persistenceEnabled } from '@/features/flags'
import { logger } from '@/lib/observability/logger'

/**
 * Storage clients for the optional persistence layer (PLAN §13.8, §14.1).
 *
 * The store is a *progressive enhancement*: NeedleDrop must boot and serve
 * every request with no database at all. Two implementations live here:
 *
 *   * `MemoryDbClient` — a bounded in-process store. Always available. Data
 *     disappears when the process does, and it is per-instance, which is
 *     exactly what "the app keeps working exactly as v1 does" means.
 *   * `PostgrestDbClient` — talks to a PostgREST API (Supabase and friends)
 *     over `fetch`. There is deliberately **no** `pg` driver in this repo, so
 *     a plain `postgres://` connection string cannot be spoken to: it is
 *     reported as "no REST endpoint" and the memory store takes over.
 *
 * `getDb()` never throws. If the REST store is misconfigured or unreachable
 * the caller degrades to the memory store and the API answers with
 * `"store": "memory"` instead of a 500.
 */

export type StoreKind = 'memory' | 'rest'

/** What the API reports to the client. */
export type StoreLabel = 'memory' | 'postgres'

export type BlockKind = 'artist' | 'keyword' | 'video_id'
export type FeedbackVerdict = 'keep' | 'drop'

export type PresetRow = {
  id: string
  anon_id: string
  name: string
  options: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type BlockRow = {
  id: string
  anon_id: string
  kind: BlockKind
  value: string
  created_at: string
}

export type FeedbackRow = {
  id: string
  anon_id: string
  run_id: string | null
  video_id: string
  verdict: FeedbackVerdict
  reason: string | null
  created_at: string
}

export type RunRow = {
  id: string
  anon_id: string
  user_email: string | null
  seed_kind: string
  seed_ref: string
  seed_title: string | null
  options: Record<string, unknown>
  track_count: number
  quota_used: number
  playlist_id: string | null
  playlist_url: string | null
  status: string
  duration_ms: number | null
  created_at: string
}

export type QuotaLedgerRow = {
  id: string
  anon_id: string | null
  operation: string
  units: number
  run_id: string | null
  cached: boolean
  created_at: string
}

export type PresetInput = { name: string; options: Record<string, unknown> }
export type BlockInput = { kind: BlockKind; value: string }
export type FeedbackInput = {
  runId?: string | null
  videoId: string
  verdict: FeedbackVerdict
  reason?: string | null
}
export type RunInput = {
  id?: string
  userEmail?: string | null
  seedKind?: string
  seedRef?: string
  seedTitle?: string | null
  options?: Record<string, unknown>
  trackCount?: number
  quotaUsed?: number
  playlistId?: string | null
  playlistUrl?: string | null
  status?: string
  durationMs?: number | null
}
export type QuotaEntryInput = {
  anonId: string | null
  operation: string
  units: number
  runId?: string | null
  cached?: boolean
}

/** How many rows each table lost during a "delete all my data" wipe. */
export type DeleteCounts = {
  runs: number
  presets: number
  blocks: number
  feedback: number
  quotaLedger: number
}

/**
 * The contract every store implementation satisfies.
 *
 * `query` is the generic escape hatch; the named operations are what the
 * repository layer actually uses, because they keep the SQL surface small
 * enough to run on both a real database and an in-memory table.
 */
export type DbClient = {
  /** Read-only escape hatch over a closed set of statements (see `runRead`). */
  query<T>(sql: string, params?: unknown[]): Promise<T[]>
  /** False once the backing store has been judged unreachable. */
  available(): boolean
  /** Which physical store is serving requests right now. */
  kind: StoreKind

  listPresets(anonId: string): Promise<PresetRow[]>
  savePreset(anonId: string, input: PresetInput): Promise<PresetRow>
  deletePreset(anonId: string, id: string): Promise<boolean>
  deletePresetByName(anonId: string, name: string): Promise<boolean>

  listBlocks(anonId: string): Promise<BlockRow[]>
  addBlock(anonId: string, input: BlockInput): Promise<BlockRow>
  removeBlock(anonId: string, id: string): Promise<boolean>
  removeBlockByValue(anonId: string, kind: BlockKind, value: string): Promise<boolean>

  recordFeedback(anonId: string, input: FeedbackInput): Promise<FeedbackRow>
  listFeedback(anonId: string): Promise<FeedbackRow[]>

  recordRun(anonId: string, input: RunInput): Promise<RunRow>
  listRuns(anonId: string, limit: number): Promise<RunRow[]>

  /** Appends to the quota ledger. Used by the quota/governance layer. */
  recordQuotaUsage(entry: QuotaEntryInput): Promise<void>

  /** Wipes every row that belongs to one anonymous id. */
  deleteAll(anonId: string): Promise<DeleteCounts>
}

/** Thrown when the backing store cannot be reached or refuses the request. */
export class StoreUnavailableError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message)
    this.name = 'StoreUnavailableError'
  }
}

/* ── row normalisation ─────────────────────────────────────────────────────── */

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asOptionalText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0
}

function asOptionalCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null
}

function toPresetRow(raw: unknown): PresetRow {
  const row = asRecord(raw)
  const createdAt = asText(row.created_at)
  return {
    id: asText(row.id),
    anon_id: asText(row.anon_id),
    name: asText(row.name),
    options: asRecord(row.options),
    created_at: createdAt,
    updated_at: asText(row.updated_at) || createdAt,
  }
}

function toBlockRow(raw: unknown): BlockRow {
  const row = asRecord(raw)
  const kind = asText(row.kind)
  return {
    id: asText(row.id),
    anon_id: asText(row.anon_id),
    kind: kind === 'keyword' || kind === 'video_id' ? kind : 'artist',
    value: asText(row.value),
    created_at: asText(row.created_at),
  }
}

function toFeedbackRow(raw: unknown): FeedbackRow {
  const row = asRecord(raw)
  return {
    id: asText(row.id),
    anon_id: asText(row.anon_id),
    run_id: asOptionalText(row.run_id),
    video_id: asText(row.video_id),
    verdict: asText(row.verdict) === 'drop' ? 'drop' : 'keep',
    reason: asOptionalText(row.reason),
    created_at: asText(row.created_at),
  }
}

function toRunRow(raw: unknown): RunRow {
  const row = asRecord(raw)
  return {
    id: asText(row.id),
    anon_id: asText(row.anon_id),
    user_email: asOptionalText(row.user_email),
    seed_kind: asText(row.seed_kind) || 'profile',
    seed_ref: asText(row.seed_ref),
    seed_title: asOptionalText(row.seed_title),
    options: asRecord(row.options),
    track_count: asCount(row.track_count),
    quota_used: asCount(row.quota_used),
    playlist_id: asOptionalText(row.playlist_id),
    playlist_url: asOptionalText(row.playlist_url),
    status: asText(row.status) || 'complete',
    duration_ms: asOptionalCount(row.duration_ms),
    created_at: asText(row.created_at),
  }
}

/* ── the closed read set ───────────────────────────────────────────────────── */

type ReadTable = 'presets' | 'blocks' | 'feedback' | 'runs'

type ReadStatement = {
  table: ReadTable
  /** True when the statement may carry a `limit $2`. */
  limited: boolean
  pattern: RegExp
}

/**
 * The only statements `query()` understands.
 *
 * This is deliberately not a SQL engine: the repository layer uses the named
 * operations, and this exists so an ad-hoc read ("what does the store hold
 * for this id?") does not need a second code path.
 *
 * The patterns use single spaces because `parseRead` collapses whitespace
 * before matching.
 */
const READ_STATEMENTS: ReadStatement[] = [
  {
    table: 'presets',
    limited: false,
    pattern: /^select \* from presets where anon_id = \$1 order by created_at desc$/,
  },
  {
    table: 'blocks',
    limited: false,
    pattern: /^select \* from blocks where anon_id = \$1 order by created_at desc$/,
  },
  {
    table: 'feedback',
    limited: false,
    pattern: /^select \* from feedback where anon_id = \$1 order by created_at desc$/,
  },
  {
    table: 'runs',
    limited: true,
    pattern: /^select \* from runs where anon_id = \$1 order by created_at desc( limit \$2)?$/,
  },
]

function parseRead(sql: string): ReadStatement | null {
  const normalised = sql.trim().replace(/\s+/g, ' ')
  for (const statement of READ_STATEMENTS) {
    if (statement.pattern.test(normalised)) return statement
  }
  return null
}

async function runRead<T>(db: DbClient, sql: string, params: unknown[]): Promise<T[]> {
  const statement = parseRead(sql)
  if (!statement) {
    throw new Error(
      'Unsupported statement. The store only understands: select * from {presets|blocks|feedback|runs} where anon_id = $1 order by created_at desc.',
    )
  }
  const anonId = typeof params[0] === 'string' ? params[0] : ''
  if (statement.table === 'presets') return (await db.listPresets(anonId)) as unknown as T[]
  if (statement.table === 'blocks') return (await db.listBlocks(anonId)) as unknown as T[]
  if (statement.table === 'feedback') return (await db.listFeedback(anonId)) as unknown as T[]
  const rawLimit = statement.limited ? Number(params[1] ?? 50) : 50
  const limit = Number.isFinite(rawLimit) ? rawLimit : 50
  return (await db.listRuns(anonId, limit)) as unknown as T[]
}

/* ── the in-memory store ───────────────────────────────────────────────────── */

/**
 * A bounded table. Rows are kept in insertion order and the oldest row is
 * dropped once the cap is reached, so an unbounded process can never be
 * turned into an unbounded memory leak by a client that keeps posting.
 */
class MemoryTable<T extends { id: string; created_at: string }> {
  private readonly rows = new Map<string, { row: T; seq: number }>()
  private seq = 0

  constructor(private readonly limit: number) {}

  insert(row: T): T {
    this.seq += 1
    this.rows.set(row.id, { row, seq: this.seq })
    this.evict()
    return row
  }

  replace(id: string, row: T): T | null {
    const existing = this.rows.get(id)
    if (!existing) return null
    this.rows.set(id, { row, seq: existing.seq })
    return row
  }

  remove(id: string): boolean {
    return this.rows.delete(id)
  }

  find(predicate: (row: T) => boolean): T | undefined {
    for (const stored of this.rows.values()) {
      if (predicate(stored.row)) return stored.row
    }
    return undefined
  }

  /** Newest first; ties are broken by insertion order. */
  list(predicate?: (row: T) => boolean): T[] {
    const entries: Array<{ row: T; seq: number }> = []
    for (const stored of this.rows.values()) {
      if (!predicate || predicate(stored.row)) entries.push(stored)
    }
    entries.sort((a, b) => {
      if (a.row.created_at !== b.row.created_at) {
        return a.row.created_at < b.row.created_at ? 1 : -1
      }
      return b.seq - a.seq
    })
    return entries.map((entry) => entry.row)
  }

  removeWhere(predicate: (row: T) => boolean): number {
    let removed = 0
    for (const [id, stored] of [...this.rows.entries()]) {
      if (!predicate(stored.row)) continue
      this.rows.delete(id)
      removed += 1
    }
    return removed
  }

  private evict(): void {
    while (this.rows.size > this.limit) {
      let oldestId: string | null = null
      let oldestCreatedAt = ''
      let oldestSeq = -1
      for (const [id, stored] of this.rows) {
        const isOlder =
          oldestId === null ||
          stored.row.created_at < oldestCreatedAt ||
          (stored.row.created_at === oldestCreatedAt && stored.seq < oldestSeq)
        if (!isOlder) continue
        oldestId = id
        oldestCreatedAt = stored.row.created_at
        oldestSeq = stored.seq
      }
      if (oldestId === null) return
      this.rows.delete(oldestId)
    }
  }
}

/**
 * The always-available store.
 *
 * It is the reason the app can promise "runs with no database": every
 * operation is a Map lookup. Data is per-process and per-boot, which the
 * API reports honestly as `"store": "memory"`.
 */
export class MemoryDbClient implements DbClient {
  readonly kind: StoreKind = 'memory'

  private readonly presets = new MemoryTable<PresetRow>(200)
  private readonly blocks = new MemoryTable<BlockRow>(500)
  private readonly runs = new MemoryTable<RunRow>(200)
  private readonly feedback = new MemoryTable<FeedbackRow>(1000)
  private readonly quotaLedger = new MemoryTable<QuotaLedgerRow>(1000)

  available(): boolean {
    return true
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return runRead<T>(this, sql, params)
  }

  async listPresets(anonId: string): Promise<PresetRow[]> {
    return this.presets.list((row) => row.anon_id === anonId)
  }

  async savePreset(anonId: string, input: PresetInput): Promise<PresetRow> {
    const existing = this.presets.find(
      (row) => row.anon_id === anonId && row.name === input.name,
    )
    const now = new Date().toISOString()
    if (existing) {
      const updated = this.presets.replace(existing.id, {
        ...existing,
        options: input.options,
        updated_at: now,
      })
      return updated ?? existing
    }
    return this.presets.insert({
      id: crypto.randomUUID(),
      anon_id: anonId,
      name: input.name,
      options: input.options,
      created_at: now,
      updated_at: now,
    })
  }

  async deletePreset(anonId: string, id: string): Promise<boolean> {
    const found = this.presets.find((row) => row.id === id && row.anon_id === anonId)
    if (!found) return false
    return this.presets.remove(found.id)
  }

  async deletePresetByName(anonId: string, name: string): Promise<boolean> {
    const found = this.presets.find(
      (row) => row.anon_id === anonId && row.name === name,
    )
    if (!found) return false
    return this.presets.remove(found.id)
  }

  async listBlocks(anonId: string): Promise<BlockRow[]> {
    return this.blocks.list((row) => row.anon_id === anonId)
  }

  async addBlock(anonId: string, input: BlockInput): Promise<BlockRow> {
    const existing = this.blocks.find(
      (row) => row.anon_id === anonId && row.kind === input.kind && row.value === input.value,
    )
    if (existing) return existing
    return this.blocks.insert({
      id: crypto.randomUUID(),
      anon_id: anonId,
      kind: input.kind,
      value: input.value,
      created_at: new Date().toISOString(),
    })
  }

  async removeBlock(anonId: string, id: string): Promise<boolean> {
    const found = this.blocks.find((row) => row.id === id && row.anon_id === anonId)
    if (!found) return false
    return this.blocks.remove(found.id)
  }

  async removeBlockByValue(
    anonId: string,
    kind: BlockKind,
    value: string,
  ): Promise<boolean> {
    const found = this.blocks.find(
      (row) => row.anon_id === anonId && row.kind === kind && row.value === value,
    )
    if (!found) return false
    return this.blocks.remove(found.id)
  }

  async recordFeedback(anonId: string, input: FeedbackInput): Promise<FeedbackRow> {
    return this.feedback.insert({
      id: crypto.randomUUID(),
      anon_id: anonId,
      run_id: input.runId ?? null,
      video_id: input.videoId,
      verdict: input.verdict,
      reason: input.reason ?? null,
      created_at: new Date().toISOString(),
    })
  }

  async listFeedback(anonId: string): Promise<FeedbackRow[]> {
    return this.feedback.list((row) => row.anon_id === anonId)
  }

  async recordRun(anonId: string, input: RunInput): Promise<RunRow> {
    return this.runs.insert({
      id: input.id ?? crypto.randomUUID(),
      anon_id: anonId,
      user_email: input.userEmail ?? null,
      seed_kind: input.seedKind ?? 'profile',
      seed_ref: input.seedRef ?? '',
      seed_title: input.seedTitle ?? null,
      options: input.options ?? {},
      track_count: input.trackCount ?? 0,
      quota_used: input.quotaUsed ?? 0,
      playlist_id: input.playlistId ?? null,
      playlist_url: input.playlistUrl ?? null,
      status: input.status ?? 'complete',
      duration_ms: input.durationMs ?? null,
      created_at: new Date().toISOString(),
    })
  }

  async listRuns(anonId: string, limit: number): Promise<RunRow[]> {
    const safeLimit = Math.max(0, Math.trunc(limit))
    return this.runs.list((row) => row.anon_id === anonId).slice(0, safeLimit)
  }

  async recordQuotaUsage(entry: QuotaEntryInput): Promise<void> {
    this.quotaLedger.insert({
      id: crypto.randomUUID(),
      anon_id: entry.anonId,
      operation: entry.operation,
      units: entry.units,
      run_id: entry.runId ?? null,
      cached: entry.cached ?? false,
      created_at: new Date().toISOString(),
    })
  }

  async deleteAll(anonId: string): Promise<DeleteCounts> {
    return {
      runs: this.runs.removeWhere((row) => row.anon_id === anonId),
      presets: this.presets.removeWhere((row) => row.anon_id === anonId),
      blocks: this.blocks.removeWhere((row) => row.anon_id === anonId),
      feedback: this.feedback.removeWhere((row) => row.anon_id === anonId),
      quotaLedger: this.quotaLedger.removeWhere((row) => row.anon_id === anonId),
    }
  }
}

/* ── the PostgREST store ───────────────────────────────────────────────────── */

const REST_TIMEOUT_MS = 8_000

type RestInit = {
  method: string
  search?: URLSearchParams
  body?: unknown
  prefer?: string
}

/**
 * Talks to a PostgREST API (`/rest/v1/<table>`) with plain `fetch`.
 *
 * There is no `pg` driver in this project on purpose: the store is optional
 * and the app must run without it, so the REST surface of Supabase (or any
 * other PostgREST deployment) is the only database protocol supported.
 *
 * The service-role key bypasses row-level security, so the `anon_id` filter
 * on every request is the only thing keeping users apart — never log a row's
 * `anon_id` and never hand the key to the browser.
 */
export class PostgrestDbClient implements DbClient {
  private degraded = false

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | undefined,
  ) {}

  get kind(): StoreKind {
    return this.degraded ? 'memory' : 'rest'
  }

  available(): boolean {
    return !this.degraded
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return runRead<T>(this, sql, params)
  }

  async listPresets(anonId: string): Promise<PresetRow[]> {
    const rows = await this.sendOrThrow('presets', {
      method: 'GET',
      search: new URLSearchParams({ anon_id: `eq.${anonId}`, order: 'created_at.desc' }),
    })
    return rows.map(toPresetRow)
  }

  async savePreset(anonId: string, input: PresetInput): Promise<PresetRow> {
    const now = new Date().toISOString()
    const existing = await this.sendOrThrow('presets', {
      method: 'GET',
      search: new URLSearchParams({
        anon_id: `eq.${anonId}`,
        name: `eq.${input.name}`,
        limit: '1',
      }),
    })

    const found = existing[0] ? toPresetRow(existing[0]) : null
    if (found) {
      const rows = await this.sendOrThrow('presets', {
        method: 'PATCH',
        search: new URLSearchParams({ id: `eq.${found.id}` }),
        body: { options: input.options, updated_at: now },
        prefer: 'return=representation',
      })
      if (rows[0]) return toPresetRow(rows[0])
      return { ...found, options: input.options, updated_at: now }
    }

    const row: PresetRow = {
      id: crypto.randomUUID(),
      anon_id: anonId,
      name: input.name,
      options: input.options,
      created_at: now,
      updated_at: now,
    }
    const rows = await this.sendOrThrow('presets', {
      method: 'POST',
      body: row,
      prefer: 'return=representation',
    })
    return rows[0] ? toPresetRow(rows[0]) : row
  }

  async deletePreset(anonId: string, id: string): Promise<boolean> {
    const rows = await this.sendOrThrow('presets', {
      method: 'DELETE',
      search: new URLSearchParams({ anon_id: `eq.${anonId}`, id: `eq.${id}` }),
      prefer: 'return=representation',
    })
    return rows.length > 0
  }

  async deletePresetByName(anonId: string, name: string): Promise<boolean> {
    const rows = await this.sendOrThrow('presets', {
      method: 'DELETE',
      search: new URLSearchParams({ anon_id: `eq.${anonId}`, name: `eq.${name}` }),
      prefer: 'return=representation',
    })
    return rows.length > 0
  }

  async listBlocks(anonId: string): Promise<BlockRow[]> {
    const rows = await this.sendOrThrow('blocks', {
      method: 'GET',
      search: new URLSearchParams({ anon_id: `eq.${anonId}`, order: 'created_at.desc' }),
    })
    return rows.map(toBlockRow)
  }

  async addBlock(anonId: string, input: BlockInput): Promise<BlockRow> {
    const row: BlockRow = {
      id: crypto.randomUUID(),
      anon_id: anonId,
      kind: input.kind,
      value: input.value,
      created_at: new Date().toISOString(),
    }
    const { status, rows } = await this.send('blocks', {
      method: 'POST',
      body: row,
      prefer: 'return=representation',
    })

    if (status === 409) {
      // The (anon_id, kind, value) unique key already exists: the block is
      // simply already in place, which is not an error.
      const existing = await this.sendOrThrow('blocks', {
        method: 'GET',
        search: new URLSearchParams({
          anon_id: `eq.${anonId}`,
          kind: `eq.${input.kind}`,
          value: `eq.${input.value}`,
          limit: '1',
        }),
      })
      if (existing[0]) return toBlockRow(existing[0])
      throw this.unavailable('the database refused the block but would not return it')
    }

    if (status < 200 || status >= 300) {
      throw this.unavailable(`the database answered ${status}`)
    }
    return rows[0] ? toBlockRow(rows[0]) : row
  }

  async removeBlock(anonId: string, id: string): Promise<boolean> {
    const rows = await this.sendOrThrow('blocks', {
      method: 'DELETE',
      search: new URLSearchParams({ anon_id: `eq.${anonId}`, id: `eq.${id}` }),
      prefer: 'return=representation',
    })
    return rows.length > 0
  }

  async removeBlockByValue(
    anonId: string,
    kind: BlockKind,
    value: string,
  ): Promise<boolean> {
    const rows = await this.sendOrThrow('blocks', {
      method: 'DELETE',
      search: new URLSearchParams({
        anon_id: `eq.${anonId}`,
        kind: `eq.${kind}`,
        value: `eq.${value}`,
      }),
      prefer: 'return=representation',
    })
    return rows.length > 0
  }

  async recordFeedback(anonId: string, input: FeedbackInput): Promise<FeedbackRow> {
    const row: FeedbackRow = {
      id: crypto.randomUUID(),
      anon_id: anonId,
      run_id: input.runId ?? null,
      video_id: input.videoId,
      verdict: input.verdict,
      reason: input.reason ?? null,
      created_at: new Date().toISOString(),
    }

    const first = await this.send('feedback', {
      method: 'POST',
      body: row,
      prefer: 'return=representation',
    })
    if (first.status >= 200 && first.status < 300) {
      return first.rows[0] ? toFeedbackRow(first.rows[0]) : row
    }

    if (first.status === 409 && row.run_id) {
      // The referenced run was never persisted (the app is stateless by
      // default). Keep the signal and drop the dangling link instead of
      // losing the feedback.
      const withoutRun: FeedbackRow = { ...row, run_id: null }
      const second = await this.sendOrThrow('feedback', {
        method: 'POST',
        body: withoutRun,
        prefer: 'return=representation',
      })
      return second[0] ? toFeedbackRow(second[0]) : withoutRun
    }

    throw this.unavailable(`the database answered ${first.status}`)
  }

  async listFeedback(anonId: string): Promise<FeedbackRow[]> {
    const rows = await this.sendOrThrow('feedback', {
      method: 'GET',
      search: new URLSearchParams({ anon_id: `eq.${anonId}`, order: 'created_at.desc' }),
    })
    return rows.map(toFeedbackRow)
  }

  async recordRun(anonId: string, input: RunInput): Promise<RunRow> {
    const row: RunRow = {
      id: input.id ?? crypto.randomUUID(),
      anon_id: anonId,
      user_email: input.userEmail ?? null,
      seed_kind: input.seedKind ?? 'profile',
      seed_ref: input.seedRef ?? '',
      seed_title: input.seedTitle ?? null,
      options: input.options ?? {},
      track_count: input.trackCount ?? 0,
      quota_used: input.quotaUsed ?? 0,
      playlist_id: input.playlistId ?? null,
      playlist_url: input.playlistUrl ?? null,
      status: input.status ?? 'complete',
      duration_ms: input.durationMs ?? null,
      created_at: new Date().toISOString(),
    }
    const rows = await this.sendOrThrow('runs', {
      method: 'POST',
      body: row,
      prefer: 'return=representation',
    })
    return rows[0] ? toRunRow(rows[0]) : row
  }

  async listRuns(anonId: string, limit: number): Promise<RunRow[]> {
    const safeLimit = Math.max(1, Math.min(Math.trunc(limit) || 1, 200))
    const rows = await this.sendOrThrow('runs', {
      method: 'GET',
      search: new URLSearchParams({
        anon_id: `eq.${anonId}`,
        order: 'created_at.desc',
        limit: String(safeLimit),
      }),
    })
    return rows.map(toRunRow)
  }

  async recordQuotaUsage(entry: QuotaEntryInput): Promise<void> {
    await this.sendOrThrow('quota_ledger', {
      method: 'POST',
      body: {
        anon_id: entry.anonId,
        operation: entry.operation,
        units: entry.units,
        run_id: entry.runId ?? null,
        cached: entry.cached ?? false,
      },
    })
  }

  async deleteAll(anonId: string): Promise<DeleteCounts> {
    const wipe = async (table: string): Promise<number> => {
      const rows = await this.sendOrThrow(table, {
        method: 'DELETE',
        search: new URLSearchParams({ anon_id: `eq.${anonId}` }),
        prefer: 'return=representation',
      })
      return rows.length
    }

    return {
      runs: await wipe('runs'),
      presets: await wipe('presets'),
      blocks: await wipe('blocks'),
      feedback: await wipe('feedback'),
      quotaLedger: await wipe('quota_ledger'),
    }
  }

  private async sendOrThrow(table: string, init: RestInit): Promise<unknown[]> {
    const { status, rows } = await this.send(table, init)
    if (status < 200 || status >= 300) {
      throw this.unavailable(`the database answered ${status}`)
    }
    return rows
  }

  private async send(
    table: string,
    init: RestInit,
  ): Promise<{ status: number; rows: unknown[] }> {
    const url = new URL(`${this.baseUrl}/rest/v1/${table}`)
    if (init.search) url.search = init.search.toString()

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }
    if (this.apiKey) {
      headers['apikey'] = this.apiKey
      headers['Authorization'] = `Bearer ${this.apiKey}`
    }
    if (init.prefer) headers['Prefer'] = init.prefer

    let response: Response
    try {
      response = await fetch(url, {
        method: init.method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        cache: 'no-store',
        signal: AbortSignal.timeout(REST_TIMEOUT_MS),
      })
    } catch (error) {
      throw this.unavailable('the database is unreachable', error)
    }

    const text = await response.text().catch(() => '')
    let rows: unknown[] = []
    if (text) {
      try {
        const parsed: unknown = JSON.parse(text)
        rows = Array.isArray(parsed) ? parsed : [parsed]
      } catch {
        rows = []
      }
    }
    return { status: response.status, rows }
  }

  /** Marks the client unusable so the next call goes straight to memory. */
  private unavailable(message: string, cause?: unknown): StoreUnavailableError {
    this.degraded = true
    return new StoreUnavailableError(message, cause)
  }
}

/* ── client selection ──────────────────────────────────────────────────────── */

let memoryClient: MemoryDbClient | null = null
let restClient: PostgrestDbClient | null = null
let restResolved = false
const warned = new Set<string>()

function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return
  warned.add(key)
  logger.warn(`store: ${message}`)
}

/** The in-process store. Always available, never throws. */
export function memoryDb(): DbClient {
  if (!memoryClient) memoryClient = new MemoryDbClient()
  return memoryClient
}

/**
 * Turns a connection string into the base URL of a PostgREST API.
 * Returns null for anything that is not an HTTP(S) URL — a plain
 * `postgres://` string cannot be spoken to without a driver.
 */
function toRestBase(value: string): string | null {
  if (!/^https?:\/\//i.test(value)) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  let base = `${url.origin}${url.pathname}`.replace(/\/+$/, '')
  if (base.toLowerCase().endsWith('/rest/v1')) base = base.slice(0, -'/rest/v1'.length)
  return base || null
}

function restBaseUrl(): string | null {
  for (const candidate of [process.env.DATABASE_URL, process.env.SUPABASE_URL]) {
    if (!candidate) continue
    const base = toRestBase(candidate)
    if (base) return base
  }
  return null
}

function createRestClient(): PostgrestDbClient | null {
  if (!persistenceEnabled()) return null

  const base = restBaseUrl()
  if (!base) {
    const scheme = (process.env.DATABASE_URL ?? '').split(':')[0]
    warnOnce(
      'no-rest-endpoint',
      `DATABASE_URL is not a REST endpoint${
        scheme ? ` (scheme "${scheme}")` : ''
      }, so no database connection is possible. The store falls back to the in-memory store. Point DATABASE_URL at the PostgREST base URL (for example https://<project>.supabase.co) to enable persistence.`,
    )
    return null
  }

  const apiKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
  if (!apiKey) {
    warnOnce(
      'no-api-key',
      'No SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY is set. The REST store will very likely be rejected by the API and the store will fall back to memory.',
    )
  }
  return new PostgrestDbClient(base, apiKey)
}

/**
 * The best available client. Never throws, never returns null.
 *
 * When no REST endpoint is configured — the default for a fresh clone — this
 * is the in-memory store, and the API says so with `"store": "memory"`.
 */
export function getDb(): DbClient {
  try {
    if (!restResolved) {
      restResolved = true
      restClient = createRestClient()
    }
    if (restClient && restClient.available()) return restClient
  } catch (error) {
    logger.warn('store: the database client could not be created', { error })
  }
  return memoryDb()
}

/** Test seam — drops the memoised clients. */
export function resetDb(): void {
  memoryClient = null
  restClient = null
  restResolved = false
  warned.clear()
}
