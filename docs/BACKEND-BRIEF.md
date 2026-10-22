# Backend brief — NeedleDrop (M7 → M12)

Read this before writing code. It is the contract every backend module in this
repo is built against. The spec lives in `docs/PLAN.md` (§13–§17) and
`docs/PLAN-ADDENDUM.md`; this file is the distilled, *current* contract.

---

## 1. The stack is not the Next.js you know

Next.js **16.4.2**, React 19, TypeScript 6, Tailwind v4.

- Route handlers live in `app/api/**/route.ts` and export `GET`/`POST`/`PATCH`/`DELETE`.
- `cookies()` / `headers()` are **async**: `const store = await cookies()`.
- Dynamic route params are **async**: `export async function GET(req: Request, ctx: { params: Promise<{ id: string }> })`
  then `const { id } = await ctx.params`.
- `next lint` is **removed**. Lint with `npx eslint .`.
- `middleware.ts` is now `proxy.ts` (Node runtime only).
- `next build` no longer lints and no longer prints bundle sizes.
- `next/image` defaults changed: `qualities` must be extended explicitly
  (already `[75]` in `next.config.ts`).

Docs live in `node_modules/next/dist/docs/`. Check them if unsure.

## 2. Rules of the house

1. **No `any`.** Use `unknown` + narrowing, or a proper type.
2. **Every API route returns a stable `code` on failure.** Codes are listed in
   `lib/http/errors.ts` — import from there, do not invent new ones without
   adding them to that union.
3. **Every API response includes `unitsSpent`.** Use `ok()` / `fail()` from
   `lib/http/respond.ts`.
4. **Wrap route handlers with `withRoute()`** from `lib/http/handler.ts`. It
   handles the request id, rate limiting, quota metering, error mapping and
   structured logging. Do not re-implement those.
5. **Pure logic stays pure.** Modules under `lib/youtube/`, `lib/scoring/`,
   `lib/seed/`, `lib/export/` must not import `next/headers`, `node:*` crypto
   or perform I/O if they are meant to be unit-testable. Mark pure modules
   with a header comment (the existing files do).
6. **Never log a token, an API key or a cookie.** `lib/observability/logger.ts`
   redacts known-sensitive keys; do not bypass it.
7. **Never return a 200 with an error shape.** Use `fail(...)`.
8. **Typecheck must pass.** Run `npm run typecheck` before you finish. It is
   the hard gate — the repo must stay green.
9. **Do not edit files you do not own.** The file-ownership table below is
   absolute; another agent is writing the other files at the same time.
   If you need something from a file you do not own, import it — do not edit it.
10. **Do not add dependencies.** The manifest in `docs/PLAN.md §6.1` is
    pinned and already installed. `zod` is available. If you truly need
    another package, do not install it — write the ~20 lines yourself.

## 3. The foundation that already exists (use it, don't rebuild it)

| Module | What it gives you |
|---|---|
| `lib/env.ts` | `env()`, `isProduction()`, `hasLiveApi()`, `hasOAuth()`, `hasDatabase()`, `hasRedis()`, `hasJobs()`, `hasInngest()`, `envIssues()`, `assertEnv()`. Lazy, never throws at import. |
| `features/flags.ts` | `engineVersion()`, `discoveryDepth()`, `cacheEnabled()`, `jobsEnabled()`, `persistenceEnabled()`, `flagSnapshot()`. |
| `lib/observability/logger.ts` | `logger.info/warn/error/debug(message, fields)`, `newRequestId()`. |
| `lib/http/errors.ts` | `AppError`, `ErrorCode`, `statusForCode()`. |
| `lib/http/respond.ts` | `ok(data, meta)`, `fail(code, message, status, meta)`, `noContent(meta)`, `text(body, contentType, filename)`. |
| `lib/http/rate-limit.ts` | `checkRateLimit(key, limit, windowMs)`, `clientKey(request, scope)`, `checkLocalRateLimit()`. In-process by default, Upstash REST when configured. |
| `lib/http/handler.ts` | `withRoute(handler, { scope, limit, windowMs })`, `readJson(request)`. |
| `lib/http/session.ts` | `requireSession()`, `requireFreshSession()`, `optionalSession()`. |
| `lib/youtube/client.ts` | `youtubeFetch(op, params, meter, init)`, `createMeter()`, `YouTubeError`, `parseIsoDuration()`, `apiKey()`, `hasLiveApi()`. All Data API operations and their quota costs live here — do not add a second fetch wrapper. |
| `lib/youtube/types.ts` | `Track`, `Candidate`, `DiscoveryOptions`, `DEFAULT_OPTIONS`, `VersionTag`, `SourceKind`, `ScoreReason`, `SeedProfile`, `PlaylistPrivacy`, `Ordering`. |
| `lib/youtube/options.ts` | `normalizeDiscoveryOptions(input)` → a complete `DiscoveryOptions` from a v1 **or** v2 partial. Use this instead of hand-rolling option parsing. |
| `lib/quota.ts` | `UNIT_COST`, `DAILY_QUOTA`, `estimateDiscoveryUnits()`, `estimatePlaylistUnits()`, `quotaTone()`, `formatUnits()`. |
| `lib/youtube/playlists.ts` | `createPlaylist(accessToken, input, meter, onProgress?)` → `{ playlistId, playlistUrl, ordered, note? }`. `onProgress` receives `{ step, index, of }`. |

### `DiscoveryOptions` (v2 superset — read `lib/youtube/types.ts` for the full type)

```
count, breadth, depth (1|2), includeVersions[], maxPerArtist, hideSeedArtist,
includePopularity, includeLive/includeRemix/includeAcoustic (legacy aliases),
durationSec {min,max}, publishedRange {from,to}, languages[], familyMode,
regionSafeOnly, includeNewReleases, skipAlreadyInLibrary, order, shuffleSeed,
blockedArtists[], blockedKeywords[]
```

`includeVersions` is the allow-list of derivative versions
(`live | remix | acoustic | instrumental | karaoke | cover | spedUp | nightcore |
reverb | unplugged`). The legacy booleans are folded into it by
`normalizeDiscoveryOptions`. **Scoring code reads `includeVersions` only.**

## 4. The core data flow

```
seed input ──▶ resolve ──▶ SeedProfile (centroid of 1..50 tracks)
                              │
                              ▼
                        discover ──▶ Candidate[] (scored, explained, deduped)
                              │
                              ▼
                         select ──▶ ordered track list
                              │
                              ▼
                       createPlaylist ──▶ YouTube playlist
```

- **Discovery does not require auth.** Only `playlists.*` and
  `playlistItems.*` need an OAuth token. `search.list`, `videos.list`,
  `playlistItems.list`, `channels.list`, `playlists.list?mine=true` work on
  public data or with the shared API key.
- **Demo mode is sacred.** With no `YOUTUBE_API_KEY` the app must still work
  end to end against the built-in catalogue in `lib/youtube/demo.ts`, and the
  response must say `demo: true` so nobody believes a playlist was created
  on YouTube.
- **Metadata only.** Never download, store, transcode or separate audio.

## 5. Quota model (PLAN §5)

| Call | Units |
|---|---|
| `search.list` | **100** per call |
| `videos.list` | 1 (up to 50 ids) |
| `playlistItems.list` | 1 (up to 50 items) |
| `playlists.insert` | 50 |
| `playlistItems.insert` | **50 per item** |

A 20-track playlist ≈ **1,450 units**. The daily project quota is 10,000, so
roughly 6–7 full playlists per day from scratch. Cache and dry-runs are what
make that sustainable.

## 6. Error codes

`invalid_request` · `unauthorized` · `auth_required` · `auth_expired` ·
`forbidden` · `not_found` · `rate_limited` · `quota_exceeded` ·
`upstream_error` · `upstream_unavailable` · `network` · `no_results` ·
`private_video` · `deleted_video` · `region_blocked` · `conflict` ·
`playlist_failed` · `unsupported_media` · `demo_mode` · `internal_error`

## 7. API surface (PLAN §15)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/resolve` | no | Parse a seed (text / video URL / playlist URL / artist) → candidates + centroid |
| POST | `/api/discover` | no | Full pipeline → scored, explained, deduped candidates |
| POST | `/api/plan` | no | **Dry run**: cost estimate + top-N preview, no expensive calls |
| POST | `/api/jobs` | yes | Create a playlist asynchronously → `{ jobId }` |
| GET | `/api/jobs/:id` | yes | Job status snapshot |
| GET | `/api/jobs/:id/stream` | yes | SSE progress stream |
| GET | `/api/playlists` | yes | The user's playlists |
| PATCH | `/api/playlists/:id` | yes | Rename / re-describe / retag / change privacy |
| DELETE | `/api/playlists/:id` | yes | Delete a playlist |
| PATCH | `/api/playlists/:id/items` | yes | Reorder / remove items |
| GET | `/api/library` | yes | Playlists + app-generated markers + duplicate index |
| GET/POST | `/api/presets` | no | Saved configuration presets (anon-scoped) |
| GET/POST/DELETE | `/api/blocks` | no | Blocked artists / keywords |
| POST | `/api/feedback` | no | Per-track keep/drop signal |
| POST | `/api/export` | no | Render `.m3u` / `.csv` / `.json` / text |
| GET | `/api/quota` | no | Budget snapshot |
| GET | `/api/health` | no | Liveness + upstream reachability |

**Legacy endpoints stay working**: `/api/search`, `/api/similar`,
`/api/playlist` and `/api/auth/*` are consumed by the existing client. Do not
break their response shapes.

## 8. App-generated playlist lineage (PLAN §13.4)

App-generated playlists carry a machine-readable marker in the description so
the app can recognise them from the API alone — no database required:

```
<!--ytmg run=01J8X... v=2 seed=abc123 -->
```

## 9. File ownership (absolute)

| Files | Owner |
|---|---|
| `lib/env.ts`, `features/flags.ts`, `lib/observability/logger.ts` | foundation (done) |
| `lib/http/**` | foundation (done) |
| `lib/youtube/types.ts`, `lib/youtube/options.ts`, `lib/youtube/client.ts`, `lib/quota.ts` | foundation (done) |
| `lib/youtube/normalize.ts`, `lib/youtube/artist.ts`, `lib/youtube/regions.ts`, `lib/youtube/topic.ts`, `lib/scoring/**`, `lib/seed/**`, `lib/youtube/similar.ts` | **engine agent** |
| `lib/youtube/resolve.ts`, `lib/youtube/search.ts`, `app/api/resolve/route.ts` | **resolve agent** |
| `lib/cache/**`, `lib/quota-ledger.ts` | **cache agent** |
| `lib/jobs/**`, `app/api/jobs/**` | **jobs agent** |
| `lib/youtube/playlists.ts` | foundation (done — `createPlaylist` + `onProgress`) |
| `lib/youtube/playlist-lifecycle.ts`, `lib/youtube/lineage.ts`, `app/api/playlists/**`, `app/api/library/route.ts` | **lifecycle agent** |
| `lib/export/**`, `app/api/export/route.ts` | **export agent** |
| `lib/db/**`, `app/api/presets/route.ts`, `app/api/blocks/route.ts`, `app/api/feedback/route.ts` | **store agent** |
| `lib/youtube/discover.ts`, `lib/youtube/demo.ts`, `app/api/discover/route.ts`, `app/api/plan/route.ts`, `app/api/quota/route.ts` | **pipeline agent** (wave 2) |
| `app/api/health/route.ts`, `proxy.ts`, `next.config.ts` | **platform agent** (wave 2) |
| `tests/**` | **test agent** (wave 2) |
| `app/api/search/route.ts`, `app/api/similar/route.ts`, `app/api/playlist/route.ts`, `app/api/auth/**`, `components/**`, `README.md` | integration (coordinator) |

## 10. Module contracts (binding — do not change the shape without saying so)

These are the seams between the modules. If a module needs a different
shape, it must adapt **at its own boundary** rather than push the change
onto its callers.

```ts
// lib/youtube/normalize.ts
export function normalizeTitle(raw: string): NormalizedTitle
export function extractVersionTags(raw: string): VersionTag[]
export function parseArtistTitle(title: string, channelTitle: string): { artist: string; title: string }
export function trackKeyOf(artist: string, title: string): string
export function versionKeyOf(artist: string, title: string, tags: VersionTag[]): string
export function isVersionAllowed(tags: Iterable<VersionTag>, policy: { includeVersions: VersionTag[] }): boolean
export function isOfficialChannel(channelTitle: string): boolean
export function slug(value: string): string

// lib/scoring/weights.ts
export function weightsFor(breadth: number): Weights
export function weightsForProfile(profile: 'strict' | 'balanced' | 'explore'): Weights

// lib/scoring/explain.ts
export function explainScore(...): ScoreReason[]     // each reason has { label, points, kind }
export function formatViewCount(count: number): string

// lib/seed/centroid.ts
export function buildSeedProfile(tracks: Track[], kind: SeedProfile['kind'], label: string): SeedProfile
export function blendSeedProfiles(profiles: Array<{ profile: SeedProfile; weight: number }>): SeedProfile

// lib/youtube/similar.ts
export function scoreCandidate(seed: Track | SeedProfile, candidate: Track, sources: SourceKind[], options: DiscoveryOptions): { score: number; reasons: ScoreReason[] }
export function toCandidate(track: Track, seed: Track, sources: SourceKind[], options: DiscoveryOptions): Candidate
export function selectPlaylist(candidates: Candidate[], options: DiscoveryOptions, context?: SelectContext): Candidate[]
export function orderCandidates(candidates: Candidate[], options: DiscoveryOptions): Candidate[]
export type SelectContext = {
  seedVideoIds?: string[]
  seedArtistKeys?: string[]   // needed by the "hide seed artist" control
  userRegion?: string | null
  libraryVideoIds?: string[]
  libraryTrackKeys?: string[]
}

// lib/youtube/resolve.ts
export function classifySeedInput(input: string): { kind: 'video' | 'playlist' | 'artist' | 'text'; ... }
export async function resolveSeed(input: string, meter: QuotaMeter): Promise<SeedResolution>

// lib/cache/index.ts
export function getCached<T>(key: string): Promise<T | null>
export function setCached(key: string, value: unknown, ttlSeconds?: number): Promise<void>
export function withCache<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<{ value: T; hit: boolean; stale: boolean }>
export function cachedFetch<T>(operation: Operation, params: Record<string, string | number | boolean | undefined>, meter: QuotaMeter, init?: FetchInit): Promise<T>

// lib/quota-ledger.ts
export function budgetStatus(sessionId: string): BudgetStatus
export function assertWithinBudget(sessionId: string): void   // throws AppError('quota_exceeded')

// lib/youtube/playlists.ts  (foundation — do not change the signature)
export function createPlaylist(accessToken: string, input: PlaylistInput, meter: QuotaMeter, onProgress?: (p: PlaylistProgress) => void): Promise<PlaylistResult>

// lib/youtube/discover.ts  (pipeline agent)
export async function discover(seed: Track, options: DiscoveryOptions, meter: QuotaMeter, context?: DiscoverContext): Promise<Candidate[]>
export type DiscoverContext = {
  region?: string | null
  /** Canonical track keys the user already has, for library-aware dedupe. */
  libraryKeys?: Set<string>
  /** 1 or 2 hops. Overrides `options.depth` when present. */
  depth?: 1 | 2
}
```

## 12. API-accuracy corrections (PLAN-ADDENDUM §34) — these are not optional

`PLAN.md` was written before the API was verified. `PLAN-ADDENDUM.md` §34
lists 17 corrections. **The addendum wins.** The ones that change code you
are writing:

| # | The correction |
|---|---|
| 1 | There is **no `snippet.availableCountries`**. Region restriction is `contentDetails.regionRestriction` (`{ blocked: [...], allowed: [...] }`), and it is only present on restricted content. Absent ≠ "available everywhere" — label it *"no region restriction reported"*. `Track.availableCountries` stays in the type as a normalised projection, but it must be filled from `regionRestriction`, not invented. |
| 2 | Live detection is the free `snippet.liveBroadcastContent` ∈ `none\|upcoming\|live`, present on every snippet. `liveBroadcasts.list` only returns broadcasts that are live *right now* — it cannot detect a live version of a past song. Use it only for upcoming broadcasts, and only if asked. |
| 3 | `contentDetails.duration` is **ISO-8601** (`PT3M33S`). Use `parseIsoDuration()`. Live items are `PT0S`. |
| 4 | `playlistItems.insert` with an explicit `position` **is not strictly guaranteed** — out-of-range positions are rejected and conflicts cause appends. Insert sequentially, appending, then verify with one `playlistItems.list` (1 unit). Positions are a hint, not a guarantee. |
| 5 | `resourceId.kind` must be `youtube#video` — only videos, never playlists. |
| 8 | `related` is **not guaranteed** to be music-only. Always post-filter on `snippet.categoryId === '10'`. |
| 9 | `videos.list?chart=mostPopular&videoCategoryId=10&regionCode=ID` costs **1 unit** and yields the regional trending chart. Use it as a first-class source. |
| 10 | Artist radio via `search.list&q=<artist>+radio` costs 100 units. The cheap path is `channels.list?part=contentDetails` → `relatedPlaylists.uploads` → `playlistItems.list` = **2 units**. Use the cheap path. |
| 11 | `status.madeForKids` is generally **owner-only** and usually absent for third-party videos. Family mode must combine that best-effort field with a **title/keyword heuristic**, and say so. |
| 12 | `snippet.tags` is best-effort — optional enrichment, never a hard dependency. |
| 13 | `topicDetails` gives `topicId` + `topicCategories`; newer API versions add `topicCategoryLinks`. Read category *titles* when present, fall back to the URL slug. |
| 14 | `guideCategories.list` returns names and counts, **not playlist IDs**. A genre-playlist corpus must be an **operator-verified ID list** — see `corpus/playlists.json`. Do not fabricate playlist IDs. |
| 16 | `videos.list` costs 1 unit **per call**, not per id — batch aggressively, 50 ids per call. |
| 17 | `activities.list` returns roughly the last 90 activities per page. Cap the fetch and disclose the window. |

Two consequences for the code you write:

- **Do not invent YouTube identifiers.** A fabricated playlist id silently
  returns 404 and wastes a unit. `corpus/playlists.json` starts empty on
  purpose: it is a list an operator fills in after verifying each id. The
  code must treat it as optional and skip the curated source when it is
  empty.
- **When a field is absent, say so.** "No region restriction reported" is
  honest; "available everywhere" is a claim the API does not support.

## 13. Backwards compatibility — the existing client must keep working

The current `components/generator.tsx` calls four routes. Do not change
their response shapes:

| Route | Shape the client depends on |
|---|---|
| `POST /api/search` | `{ seeds: Track[], unitsSpent, calls }` |
| `POST /api/similar` | `{ candidates: Candidate[], unitsSpent, calls }` |
| `POST /api/playlist` | `{ demo, playlistId, playlistUrl, ordered?, note? }` |
| `GET /api/quota` | `{ demo: boolean, ... }` — **`demo` must stay** |
| `GET /api/auth/session` | `{ signedIn, user: { name, email } | null, configured }` |

`lib/youtube/discover.ts` must keep exporting
`discover(seed: Track, options: DiscoveryOptions, meter: QuotaMeter, context?: DiscoverContext): Promise<Candidate[]>`
— the legacy `/api/similar` route calls it, and the new `/api/discover`
route is a thin wrapper over the same function.

## 14. Definition of done

- `npm run typecheck` passes.
- `npx eslint <your files>` reports no errors **and no warnings** — the repo's
  lint script uses `--max-warnings=0`.
- Public functions have a short doc comment explaining *why*, not *what*.
- No `any`, no `console.log` outside `lib/observability/logger.ts`.
- Demo mode still works end to end for every route you touch.
- Your module is importable from a route handler without a server-only
  dependency unless it genuinely needs one.
- You did not change a module contract from §10. If you had to, say so
  explicitly in your report.
