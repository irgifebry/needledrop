# Backend architecture — NeedleDrop

The backend of `needledrop`, from the HTTP edge down to the YouTube Data
API. It is specified in `docs/PLAN.md` (§13–§17) and `docs/PLAN-ADDENDUM.md`;
this document describes **the code that exists**.

---

## 1. The shape of it

```
browser
  │
  │  POST /api/resolve   → a seed becomes a centroid of 1..50 tracks
  │  POST /api/discover  → the centroid becomes scored, explained candidates
  │  POST /api/plan      → what that would cost, without spending it
  │  POST /api/jobs      → create a playlist asynchronously, watch SSE progress
  │  POST /api/playlist  → create a playlist synchronously (short playlists)
  ▼
app/api/**/route.ts          thin routes: validate, delegate, answer
  │
  ├── lib/http/              request id · rate limit · error mapping · logging
  ├── lib/observability/     structured logs · spans · metrics
  ├── lib/cache/             Redis, with an in-process LRU when it is absent
  ├── lib/quota-ledger.ts    per-session and per-day budget enforcement
  ├── lib/jobs/              the durable-ish queue behind /api/jobs
  ├── lib/youtube/           every call to the Data API
  └── lib/{scoring,seed}/    the pure engine: canonical identity, weights, centroid
```

Two rules shape everything:

1. **The pure core stays pure.** `lib/youtube/normalize.ts`, `lib/scoring/*`,
   `lib/seed/*` and `lib/export/*` do no I/O, so the hardest logic is
   unit-testable without a network.
2. **One boundary to the outside world.** Every call to the YouTube Data API
   goes through `lib/youtube/client.ts`, so quota accounting and error
   mapping exist in exactly one place.

## 2. The request path

Every route handler is wrapped in `withRoute` (`lib/http/handler.ts`), which
gives it:

- a **request id** that follows the request through the logs,
- a **quota meter** that the handler charges every upstream call against,
- **rate limiting** (per-IP, in-process, or distributed via Upstash),
- **error mapping** — a `YouTubeError` becomes a stable `code` the UI can
  render per-case copy for,
- **structured logging** and a span for slow requests.

The response envelope is flat, so the existing client keeps working:

```jsonc
// success
{ "seeds": [...], "unitsSpent": 101, "calls": 2, "demo": false }

// failure
{ "code": "quota_exceeded", "message": "…", "unitsSpent": 0, "requestId": "req_…" }
```

`unitsSpent` is on **every** response, success or failure. The UI shows an
estimate before the user commits and reconciles it against the real number
afterwards; a missing number would make that lie.

## 3. Quota is the scarce resource

`search.list` costs 100 units. `playlistItems.insert` costs 50 units **per
item**. A 20-track playlist is roughly **1,450 units** against a daily
project quota of 10,000 — about six or seven playlists a day from scratch.

Three mechanisms keep that from being the ceiling:

| Mechanism | Where |
|---|---|
| **Cache** — `search:{q}` 30 min, `videos:{ids}` 6 h, `topic:{id}` 24 h, `playlistItems:{id}` 15 min | `lib/cache/index.ts` |
| **Query-level pre-filtering** — duration, decade and language go into the *query*, so fewer candidates are hydrated at all | `lib/youtube/discover.ts` |
| **Cheap sources first** — the trending chart (`videos.list?chart=mostPopular`) costs 1 unit, artist radio via `channels.list` costs 2; `search.list` is the last resort | `lib/youtube/discover.ts` |

The budget itself is enforced in `lib/quota-ledger.ts`: a soft per-session
budget, a global daily cap below the project quota, and a hard refusal that
tells the user what to do next.

## 4. The engine

`lib/youtube/normalize.ts` gives every track a **canonical identity**. A song
uploaded to six channels is one track: `trackKey = slug(artist)::slug(title)`.
That single fact is what makes the per-artist diversity cap *accurate* (it
counts artists, not channels) and what stops a playlist from containing the
same song three times.

Version classification is equally deliberate. `live`, `remix`, `acoustic`,
`instrumental`, `karaoke`, `cover`, `spedUp`, `nightcore`, `reverb` and
`unplugged` are recognised from a bracketed suffix or a trailing marker —
**not** from words inside the song title. A track called *Live* is not a live
take, and dropping it would be a bug, not caution.

Scoring (PLAN §13.1.9) is explainable by construction: every point comes with
a label and a machine-readable kind, so the UI can answer "why this track?"
instead of showing a bare number. The **breadth** slider interpolates
between a strict vector (same topic, same artist) and an exploratory one
(popularity, cross-source agreement, duration proximity).

A seed is a **centroid**, not one track (`lib/seed/centroid.ts`). Paste a
playlist URL and the centroid is up to 50 tracks; blend two seeds with
weights and it is a mixture.

## 5. Failure is a first-class path

| Situation | What happens |
|---|---|
| No `YOUTUBE_API_KEY` | The app runs against the built-in catalogue and labels every response `demo: true`. It never pretends a playlist was created on YouTube. |
| No OAuth client | Discovery still works. Only playlist creation needs a session. |
| No Redis / Postgres / Inngest | In-process fallbacks take over, and the response says which store was used. |
| Upstream 403 / 429 / 5xx | Mapped to a stable code, retried with backoff, and — after repeated failures — the circuit breaker opens instead of hammering the API. |
| A 50-track playlist | Created through `/api/jobs` with SSE progress, because 51 sequential calls take 30–60 s. |
| One insert fails mid-playlist | The partial playlist is kept and reported. The user's work is not thrown away. |

## 6. What the app will not do

- It never downloads, stores, transcodes or separates audio. Metadata and
  links only.
- It never claims a track is available in YouTube Music when the public API
  cannot prove it. Where a track may not exist in YouTube Music because of
  label restrictions, the UI says so instead of pretending.
- It never fabricates a YouTube identifier. `corpus/playlists.json` is an
  operator-verified list and starts empty on purpose.
- It never logs a token, an API key or a cookie. `lib/observability/logger.ts`
  redacts known-sensitive keys, and the code does not pass them in.

## 7. How it is verified

```
npm run typecheck   # tsc over the app *and* the test suite
npm run lint        # eslint . --max-warnings=0
npm test            # vitest run
npm run build       # next build
```

| Layer | Tool | What it covers |
|---|---|---|
| Unit | Vitest | The engine, the options parser, the quota model, the cache, the ledger, the exporters, the error envelope |
| Property | Vitest + fast-check | Invariants: the canonical key is idempotent, normalisation never empties a title, the artist cap is never exceeded, the score is deterministic |
| Contract | Vitest + inline fixtures | The Data API payload shapes, replayed, asserting the exact mapped fields — the defence against field-name drift (PLAN-ADDENDUM §34) |
| Live | `scripts/live-smoke.mjs` | One `search.list` + one `videos.list` against the real API, asserting every field the engine reads still exists. Budgeted at ~101 units; it is opt-in and needs a key |
| End to end | `npm run dev` | Every route exercised in demo mode: discovery, resolution, planning, export, the anon-scoped user data, and the auth-gated routes returning 401 |

The test suite is typechecked separately from the app (`tsconfig.test.json`),
so a broken test file fails `npm run typecheck` and `npm test` — never
`npm run build`.

CI (`.github/workflows/ci.yml`) runs lint → typecheck → test → build on
Node 24, and a budgeted live-API job only when the secret and the flag are
both present.

## 8. Where to look

| Concern | File |
|---|---|
| The API surface | `docs/PLAN.md` §15 |
| Module contracts | `docs/BACKEND-BRIEF.md` §10 |
| The engine's reasoning | `docs/PLAN.md` §13.1 |
| API-accuracy corrections | `docs/PLAN-ADDENDUM.md` §34 |
| The HTTP contract | `lib/http/handler.ts`, `lib/http/respond.ts` |
| The quota model | `lib/quota.ts`, `lib/quota-ledger.ts` |
| The upstream boundary | `lib/youtube/client.ts` |
