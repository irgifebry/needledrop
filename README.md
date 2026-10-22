<div align="center">

# needledrop

**Drop the needle on one track. Get the whole session.**

A YouTube Music playlist generator built on the YouTube Data API v3.
Metadata only — nothing is downloaded, ever.

![status](https://img.shields.io/badge/status-pre--alpha-ff3b47?style=flat-square)
![license](https://img.shields.io/badge/license-MIT-ff3b47?style=flat-square)
![next](https://img.shields.io/badge/Next.js-16.4.2-000?style=flat-square)

</div>

---

## The idea

You hear one track you love. You want the next twenty.

YouTube's API has no *"songs like this"* endpoint — so NeedleDrop builds one out
of the primitives that do exist: related videos, artist catalogues, Wikipedia
topics, curated playlists, and a co-occurrence graph of artists who keep
showing up next to each other.

Paste a track. Get a real playlist on your YouTube Music account.

## How it works

```
seed track
   │
   ├─ resolve      → find the video, its artist, its topic, its duration
   ├─ gather       → related videos · artist catalogue · topic · curated lists
   ├─ hydrate      → one videos.list call per 50 candidates
   ├─ score        → topic match · official channel · duration proximity · popularity
   ├─ diversify    → max N per artist, never a genre monoculture
   └─ create       → playlists.insert + sequential playlistItems.insert
```

## What makes it different

| | |
|---|---|
| **Quota-aware** | The estimated unit cost is shown *before* you commit. A 20-track playlist ≈ 1,450 units of the daily 10,000. |
| **Explainable** | Every score comes with reasons: *"same Wikipedia topic"*, *"official artist channel"*, *"popular — 1.2M views"*. |
| **Version-aware** | `live`, `remix`, `acoustic`, `karaoke`, `sped up` are classified precisely, not blocked by keyword. |
| **Metadata only** | No audio is fetched, stored, remixed, or separated. Links and titles, that is all. |
| **Honest** | If a track may not exist in YouTube Music (label restrictions), the UI says so instead of pretending. |

---

## The frontend

Next.js 16 (App Router) · React 19 · TypeScript 6 · Tailwind CSS v4 ·
Radix UI · Motion-free, CSS-first motion layer.

```
app/
├── layout.tsx                  # fonts, theme tokens, page shell
├── globals.css                 # Tailwind v4 @theme + the type scale
├── page.tsx                    # the landing page
└── api/
    ├── auth/{google,callback,logout,session}/route.ts
    ├── search/route.ts         # POST { query }   → seed candidates
    ├── similar/route.ts        # POST { seed, options } → scored pool
    ├── playlist/route.ts       # POST { videoIds, title, privacy } → playlist
    ├── resolve/route.ts        # POST { input }   → any seed → a centroid
    ├── discover/route.ts       # POST { seed, options } → the full pipeline
    ├── plan/route.ts           # POST { seed, options } → the cost, for free
    ├── jobs/route.ts · jobs/[id]/route.ts · jobs/[id]/stream/route.ts
    ├── playlists/route.ts · playlists/[id]/route.ts · playlists/[id]/items/route.ts
    ├── library/route.ts        # the user's playlists + duplicate index
    ├── export/route.ts         # POST { format, tracks } → .m3u / .csv / .json / text
    ├── presets/route.ts        # saved configurations
    ├── blocks/route.ts         # blocked artists and keywords
    ├── feedback/route.ts       # per-track keep/drop signal
    ├── quota/route.ts          # GET  → quota snapshot
    ├── keys/route.ts           # POST/DELETE → the visitor's own YouTube API key
    └── health/route.ts         # GET  → liveness + configuration

components/
├── hero.tsx                    # the poster + the live generator
├── generator.tsx               # seed → tune → build → create
├── site-header.tsx             # colour-by-chapter header
├── marquee.tsx · reveal.tsx · toaster.tsx
├── sections/                   # intro · features · how-it-works · showcase · stats · faq · cta · footer
└── ui/                         # button · input · badge · switch · slider · radio · popover · tooltip

lib/
├── env.ts                      # zod-validated environment, lazy and fail-soft
├── crypto.ts                   # AES-256-GCM seal/open
├── session.ts                  # encrypted cookie session
├── google-oauth.ts             # auth URL, code exchange, token refresh, revoke
├── quota.ts                    # the cost estimator
├── http/                       # handler · respond · errors · rate-limit · region · session
├── observability/              # logger · tracing · metrics
├── cache/                      # Redis, with an in-process LRU when it is absent
├── quota-ledger.ts             # per-session and per-day budget enforcement
├── jobs/                       # queue · worker · idempotency
├── db/                         # optional Postgres store, in-memory fallback
├── export/                     # m3u · csv · json · text
├── scoring/                    # the strict↔explore weight vectors (pure)
├── seed/centroid.ts            # the seed as a weighted profile (pure)
└── youtube/
    ├── client.ts               # fetch wrapper: auth header, quota meter, error mapping
    ├── types.ts · options.ts   # the domain types and the option parser
    ├── normalize.ts · artist.ts # canonical identity: artist::title, version tags (pure)
    ├── topic.ts · regions.ts   # topic categories, region restrictions (pure)
    ├── similar.ts              # scoring + diversity cap (pure, no I/O)
    ├── search.ts · resolve.ts · discover.ts · playlists.ts
    └── demo.ts                 # the offline catalogue
```

**Pure-function core.** `lib/youtube/similar.ts` holds the scoring engine and
contains no I/O, so the hardest logic is unit-testable without touching the
network. `lib/youtube/normalize.ts` derives a canonical `artist::title` key so
the same song uploaded to six channels counts as one track.

**Export needs no account.** The renderers in `lib/export/` are pure and
client-safe, so the browser can render the tracklist itself — no request, no
quota, and it keeps working when the API is down. The export row sits
alongside the create button, which is what makes the app usable for a
visitor who has not signed in: writing a playlist into a YouTube account
needs one, taking the list with you does not.

### The backend

Every route shares one envelope: a request id, a quota meter, rate limiting,
stable error codes, and `unitsSpent` on **every** response — because the UI
shows an estimate before the user commits and has to reconcile it with the
real number afterwards.

```
browser → app/api/*/route.ts
            ├── lib/http/            request id · rate limit · errors · logging
            ├── lib/cache/           Redis, or an in-process LRU when it is absent
            ├── lib/quota-ledger.ts  per-session budget · global daily cap
            ├── lib/jobs/            the queue behind /api/jobs and its SSE stream
            └── lib/youtube/         every call to the Data API, metered and mapped
```

**Quota is the scarce resource.** `search.list` costs 100 units,
`playlistItems.insert` costs 50 per item, and a 20-track playlist is ≈ 1,450
units against a daily project quota of 10,000. The project's allowance is
**100 searches a day, for the whole deployment** — the Data API gives
`search.list` a bucket of its own, and it is the first thing to run out.

Four things keep that sustainable:

- a cache (`search:{q}` 30 min, `videos:{ids}` 6 h) that every read goes
  through, so a seed two visitors type in the same afternoon is paid for
  once;
- **the visitor's own API key.** `POST /api/keys` verifies a key with a
  one-unit probe and stores it encrypted in that browser's cookie; every
  search it pays for comes out of the visitor's own Google Cloud project
  instead of the shared one. This is the escape hatch that makes the product
  usable at any scale — spreading the app's own load over several projects
  would be quota circumvention, so it is deliberately not done;
- query-level pre-filtering so fewer candidates are hydrated at all;
- cheap sources first — the trending chart costs 1 unit and artist radio
  costs 2, while `search.list` is the last resort.

When the day's budget really is gone, the app says so: a 429 with
`quota_exceeded`, naming the midnight-Pacific-Time reset, rather than a
generic upstream fault.

**Everything external is optional.** No Redis → an in-process cache with the
same TTLs. No Postgres → an in-memory store. No Inngest → an in-process job
queue. No API key → the demo catalogue. The app boots with zero
configuration and still works end to end.

**Long playlists run in the background.** A 50-track playlist is 51
sequential calls, too slow for one request. `POST /api/jobs` returns a job id
immediately, `GET /api/jobs/:id/stream` streams progress over SSE, and a
track that fails after its retries does not cost the user the other 49 — the
partial playlist is kept and reported.

See [`docs/BACKEND.md`](docs/BACKEND.md) for the architecture and
[`docs/BACKEND-BRIEF.md`](docs/BACKEND-BRIEF.md) for the module contracts.

### Demo mode

The whole flow works **without any credentials**. With no `YOUTUBE_API_KEY` the
app searches a built-in catalogue of real, public YouTube videos (verified
against the YouTube oEmbed endpoint, thumbnails served from `i.ytimg.com`) and
labels the run *Demo catalogue* so nobody is misled about what was written to
YouTube. Add a key and the same code path talks to the live Data API.

### Design

Dark-first poster typography: **Anton** for display, **Work Sans** for text, a
flat ink / mint / orange palette, square corners, and one hard offset shadow on
the generator card. Sections change ground colour at their edges and the fixed
header takes the ink of the chapter beneath it. Everything sits on one type
scale (`app/globals.css`) and every entrance animation respects
`prefers-reduced-motion`; content is never left hidden if JavaScript fails.

---

## Status

Pre-alpha. The plan is fully specified and versioned; the code lands in
milestones.

| Milestone | What | State |
|---|---|---|
| **M1–M6** | Core loop: seed → discover → create | shipped |
| **M7–M8** | Engine v2: canonical track identity, multi-hop, popularity prior, explainable scoring, curation controls | backend landed |
| **M9–M12** | Playlist lifecycle, library, async jobs, cache, quota ledger, export, inline player | backend landed · the UI for the new surfaces is next |
| **M13–M14** | Platform hardening, CI/e2e/observability, OAuth verification, public launch | observability, health and security headers landed · CI and OAuth verification still to do |
| **M15–M20** | Taste profile, semantic engine v3, playlist health & auto-repair, autonomous runs, public API/CLI/MCP, offline-first local mode | specified, not started |

## The docs

Everything is specified before it is built:

- **[`docs/PLAN.md`](docs/PLAN.md)** — architecture, the similarity engine, quota
  model, API surface, milestones, risks, and a **pinned dependency manifest**
  (§6.1) with verified install notes.
- **[`docs/PLAN-ADDENDUM.md`](docs/PLAN-ADDENDUM.md)** — the mature tier:
  taste profiles, embeddings + co-occurrence graph, playlist health, templates,
  scheduled runs, interop, public API, offline mode, and **17 API-accuracy
  corrections** worth reading before writing a single API call.
- **[`docs/BACKEND.md`](docs/BACKEND.md)** — how the backend that exists
  actually fits together, and why it is shaped that way.
- **[`docs/BACKEND-BRIEF.md`](docs/BACKEND-BRIEF.md)** — the module contracts
  and the house rules, for anyone adding to the backend.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript 6 · Tailwind CSS v4 ·
Radix UI · Zod 4 · Vitest 5 · ESLint 10 · YouTube Data API v3

Pinned versions and the reasoning behind each one live in
[`docs/PLAN.md §6.1`](docs/PLAN.md).

## Local setup

```bash
git clone https://github.com/irgifebry/needledrop.git
cd needledrop
npm install
npm run dev
```

That is enough to explore the product: it boots in demo mode with the built-in
catalogue, and every optional service (Redis, Postgres, Inngest) falls back to
an in-process implementation when it is not configured.

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint . --max-warnings=0
npm test            # vitest run
```

To go live you need a Google Cloud project with the **YouTube Data API v3**
enabled and an OAuth client of type *Web application*:

```bash
cp .env.example .env.local   # fill in the Google OAuth values
```

Full walkthrough: [`docs/PLAN.md §2`](docs/PLAN.md).

| Variable | Needed for |
|---|---|
| `YOUTUBE_API_KEY` | Live discovery instead of the demo catalogue |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Sign-in and real playlist creation |
| `SESSION_SECRET` | Encrypting the OAuth session cookie (32+ chars) |
| `NEXT_PUBLIC_APP_URL` | The OAuth redirect origin |
| `UPSTASH_REDIS_REST_URL` / `..._TOKEN` | A shared cache and distributed rate limits |
| `DATABASE_URL` | Runs history, presets, blocks and feedback |
| `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` | A durable job runner |

Everything past the first four is optional: the app degrades to an in-process
implementation and says so in the response.

## Licence

MIT © irgifebry

Photographs are from Wikimedia Commons and are credited in the page footer.
