# YouTube Music Playlist Generator — Implementation Plan

**Stack:** Next.js **16.4.2** (App Router, Turbopack) · React **19.3.1** · TypeScript **6.0.3** · Tailwind CSS **4.3.3**
**Auth:** Google OAuth 2.0 → YouTube Data API v3
**Core feature:** Seed track → discover similar songs → auto-create a YouTube Music playlist
**Runtime:** Node.js **24 LTS** · npm 11 · full pinned dependency manifest in **§6.1**

> **Companion document.** `PLAN-ADDENDUM.md` specifies the next maturity tier (§21–§35): taste profile, semantic engine v3, playlist health & auto-repair, templates & sets, autonomous runs, cross-platform interop, public API/CLI/MCP, offline-first local mode, product economics, and **API-accuracy corrections** that should be applied before M13. Read §34 first if you are about to write `regions.ts`, `live.ts`, or the playlist-creation path.

---

## 0. Design Read

> Reading this as: a consumer music tool for playlist lovers, with a dark, tactile, music-app language, leaning toward deep neutral surfaces, a single warm-red accent nodding to YouTube Music's brand, and editorial sans typography.

**Dials:** `DESIGN_VARIANCE 6` · `MOTION_INTENSITY 4` · `VISUAL_DENSITY 5`

**Palette:** zinc-950 base → zinc-900 surfaces → zinc-800 borders, single accent `#FF3B47` (desaturated YouTube Music red). No purple. No gradients-as-decoration.

**Fonts:** `Geist` (display/UI) + `Geist Mono` (numbers, quota counters, video IDs).

**Theme:** Dark-first, `prefers-color-scheme: light` supported via CSS variables so both modes ship.

**Hero rule:** no fake screenshot divs. The hero's right half is the *actual* generator component, running live.

**Real visual assets:** every track row renders its real YouTube thumbnail (`snippet.thumbnails.medium/high`), so the page is never text-only.

---

## 1. How It Works (Architecture)

```
┌──────────────┐   Google OAuth    ┌────────────────────┐
│  Browser     │ ─────────────────▶│  /api/auth/google  │
│  (Next.js)   │                   │  → consent screen   │
└──────┬───────┘                   └─────────┬──────────┘
       │  /api/auth/callback ← code ──────────┘
       ▼
┌──────────────────────┐
│ Encrypted session    │  httpOnly cookie, AES-256-GCM
│ cookie (tokens +     │  key = SESSION_SECRET
│ profile)             │
└──────┬───────────────┘
       ▼
┌────────────────────────────────────────────────────────┐
│  lib/youtube/*  (YouTube Data API v3)                  │
│                                                        │
│  search.ts    → resolve seed query → videoId           │
│  similar.ts   → build + score candidate pool          │
│  playlists.ts → playlists.insert + playlistItems.insert│
└────────────────────────────────────────────────────────┘
```

### Key insight
**Discovery does not require auth.** `search.list`, `videos.list`, and `playlistItems.list` work on public data. Only *creating* a playlist needs the `youtube.force-ssl` scope. This means the discovery algorithm can be developed and tested before OAuth is even wired up — and if the user is not signed in, the app still works as a "finder" and prompts them to sign in only at the final "Create playlist" step.

---

## 2. Google Cloud Setup (one-time, ~10 min)

1. Create a GCP project.
2. Enable **YouTube Data API v3**.
3. OAuth consent screen → External.
   - Add your own Google account under **Test users**.
   - ⚠️ While the consent screen status is *Testing*, Google expires refresh tokens after **7 days**. Either publish the app (External + your account added as a test user works, but keep status *In production* for a personal app) or re-auth every week. The app also forces `prompt=consent` so a refresh token is always issued.
4. Create an **OAuth Client ID → Web application**.
   - Authorized redirect URI: `http://localhost:3000/api/auth/callback` (add the production URL too).
5. Put the values in `.env.local`:

```bash
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx
SESSION_SECRET=<openssl rand -hex 32>
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### Scopes
| Scope | Purpose |
|---|---|
| `https://www.googleapis.com/auth/youtube.force-ssl` | create playlists, add items |
| `https://www.googleapis.com/auth/youtube.readonly` | read library/playlists |
| `https://www.googleapis.com/auth/userinfo.email` | show signed-in identity |
| `https://www.googleapis.com/auth/userinfo.profile` | show signed-in name |

> **There is no `youtube.playlists` scope.** The Data API publishes exactly
> seven YouTube scopes and that is not one of them; a request naming it
> comes back as `Error 400: invalid_scope` and the *entire* sign-in fails,
> not just the playlist feature. The write side of the playlist API is
> covered by `youtube.force-ssl`, which is `youtube` with the SSL
> requirement made explicit and is what Google recommends for new
> integrations. `tests/contract/oauth-scopes.test.ts` pins the list against
> the published scopes so this cannot regress.

`youtube.force-ssl` is a **sensitive** scope: Google requires verification
before a public app can use it in production, and it grants write access
across the account, not just to playlists. There is no narrower scope for
playlist writes — `youtube.readonly` cannot create anything — so the
trade-off is inherent, not a choice. Two things keep it honest: the scope
is only requested when the user explicitly signs in, and the consent screen
names it plainly so the grant is informed.

### 2.1 Local prerequisites

| Tool | Version | Note |
|---|---|---|
| Node.js | **24 LTS** | see §6.1.1 — ESLint 10 and Vitest 5 both require it |
| npm | **11.19.1** | or pnpm 10 |
| Google Cloud CLI (`gcloud`) | latest | only for enabling the API / OAuth client non-interactively |
| `openssl` | any | to generate `SESSION_SECRET` |

```bash
node -v   # must print v24.x
npm -v    # must print 11.x
```

---

## 3. Session Management

Hand-rolled, no Auth.js dependency (keeps the setup surface small and the flow transparent).

- **Storage:** `httpOnly` + `Secure` + `SameSite=Lax` cookie holding an AES-256-GCM encrypted JSON payload.
- **Payload:** `{ accessToken, refreshToken, expiresAt, email, name, channelTitle }` — comfortably under the 4 KB cookie limit.
- **Refresh:** `lib/google-oauth.ts` refreshes the access token when `expiresAt - now < 60s`, then re-encrypts the cookie.
- **State/CSRF:** random `state` stored in a short-lived cookie, compared on callback.
- **Stateless:** no database needed, so it deploys to Vercel without any storage setup.

Files: `lib/session.ts`, `lib/google-oauth.ts`, `lib/crypto.ts`.

---

## 4. The Similarity Engine (the core of the app)

YouTube Data API v3 has **no** "similar songs" endpoint. The engine is a 6-stage pipeline built from official API primitives.

### Stage 1 — Resolve the seed
```
search.list
  ?part=snippet
  &q=<user input>
  &type=video
  &videoCategoryId=10        ← Music category
  &maxResults=8
```
Rank candidates:
- channel looks official → `"- Topic"` (auto-generated artist channel), `VEVO`, `"Official"`, `"Records"`, `"Music"`
- title contains the query tokens
- title has a music-ish shape (`Artist - Song`, `Artist – Song`, `(Official Video)`, `(Official Audio)`)

### Stage 2 — Hydrate the seed
```
videos.list
  ?part=snippet,topicDetails,contentDetails
  &id=<seedVideoId>
```
Capture: `topicId` (Wikipedia-style topic), `topicCategories`, `channelTitle`, `duration`.

### Stage 3 — Build the candidate pool
Four complementary sources, merged and de-duplicated:

| Source | Call | Why |
|---|---|---|
| A. Related videos | `search.list&relatedToVideoId=<seedId>&type=video&videoCategoryId=10&maxResults=50` | For official music videos, YouTube's "related" is genuinely music-adjacent. |
| B. Artist expansion | `search.list&q=<artist>+radio`, `q=<artist>+songs` | The artist's "mix" tracks. |
| C. Topic expansion | `search.list&q=<topicName>` using the seed's `topicDetails` | Same Wikipedia topic ⇒ same genre/artist cluster. |
| D. Curated playlists | `playlistItems.list&playlistId=<genre/tops playlist>&maxResults=50` | Official YouTube music playlists = high-quality, already-curated tracks. |

### Stage 4 — Hydrate the pool
```
videos.list
  ?part=snippet,topicDetails
  &id=<up to 50 comma-separated ids>
```
1 quota unit per call, 50 ids per call.

### Stage 5 — Filter & score
**Hard filters**
- drop the seed video itself
- drop non-music (`videoCategoryId != 10`)
- drop blocked keywords: `live`, `remix`, `cover`, `karaoke`, `instrumental`, `sped up`, `nightcore`, `lyric video`, `audio only`, `concert`, `acoustic`
  - ⤷ made configurable via toggles (user can keep live/remix versions)
- drop videos shorter than 45 s or longer than 20 min (full tracks only)
- de-duplicate by normalized `title|channel`

**Scoring**

| Signal | Weight |
|---|---|
| Same `topicId` as seed | +40 |
| Same artist as seed | +15 (or excluded outright if "hide seed artist" is on) |
| Official channel (`- Topic` / VEVO / Official) | +20 |
| Title contains the seed's artist | +10 |
| Similar title length/shape (track, not a 40-min mix) | +5 |
| Duration within ±25 % of seed | +5 |
| Already seen in pool | −∞ (dedupe) |

**Diversity enforcement**
- max 2 tracks per artist in the final list (so a playlist is not 12 songs by one artist)
- final list is re-sorted by score

### Stage 6 — Create the playlist
```
playlists.insert
  ?part=snippet,status
  body: { snippet: { title, description, tags[] }, status: { privacyStatus: "public|private|unlisted" } }
```
then

```
playlistItems.insert
  ?part=snippet
  body: { snippet: { playlistId, resourceId: { videoId, kind: "youtube#video" }, position: <n> } }
```

**Ordering:** items are inserted **sequentially** with an explicit `position`, guaranteeing the intended order (parallel insertion races and can scramble the playlist).

**Result:** `https://music.youtube.com/playlist?list=<playlistId>`

---

## 5. Quota Budget (default 10,000 units/day)

| Operation | Cost | Notes |
|---|---|---|
| `search.list` | **100** | per call — the expensive one |
| `videos.list` | 1 | up to 50 ids per call |
| `playlistItems.list` | 1 | up to 50 items per call |
| `playlists.insert` | 50 | per playlist |
| `playlistItems.insert` | **50** | **per item** (not per request) |

Typical run (20-track playlist, 4 search + 2 videos.list):

```
search   4 × 100  =  400
videos   2 ×   1  =    2
playlist          =   50
items   20 ×  50  = 1000
                  -------
                  ≈ 1452 units
```

A 50-track playlist ≈ 3,100 units. The UI shows a **live quota estimate** before the user commits, so nobody gets surprised by `quotaExceeded`.

---

## 6. Project Structure

### 6.1 Dependency Manifest (pinned — verified against npm on 2026-10-21)

> Every version below is the **current latest on npm**, verified by querying the registry — not from memory. Re-verify before each milestone; this table is a snapshot, not a lockfile.

#### 6.1.1 Runtime baseline

| Requirement | Version | Why this exact floor |
|---|---|---|
| **Node.js** | **24 LTS** (≥ 24.0.0) | The only line satisfying all three hard floors: Next 16 needs `≥20.9`, ESLint 10 needs `^20.19 \|\| ^22.13 \|\| ≥24`, Vitest 5 needs `^22.12 \|\| ^24 \|\| ≥26`. Node 26 works locally but is not LTS — pin CI to 24. |
| **Package manager** | npm **11.19.1** (`packageManager` field) | Lockfile committed; `pnpm@10` is an equally valid swap |
| **TypeScript** | **6.0.3** | ⚠️ `typescript@7.0.2` is the latest, but `typescript-eslint@8.72.0` declares peer `typescript >=4.8.4 <6.1.0` → **TS 7 breaks the lint toolchain**. Pin 6.0.3 until typescript-eslint supports TS 7, then flip. (Next 16 requires TS ≥ 5.1 — satisfied.) |

#### 6.1.2 `package.json` — written out in full

```jsonc
{
  "name": "playlist-generator",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24.0.0", "npm": ">=11.19.0" },
  "packageManager": "npm@11.19.1",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint . --max-warnings=0",
    "lint:fix": "eslint . --fix",
    "typecheck": "tsc --noEmit",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest run --coverage",
    "e2e": "playwright test",
    "e2e:install": "playwright install --with-deps chromium",
    "mcp": "tsx mcp/server.ts",
    "cli": "tsx cli/index.ts",
    "graph:build": "tsx scripts/build-graph.ts",
    "radar": "tsx scripts/release-radar.ts",
    "prepare": "husky"
  },

  "dependencies": {
    "next": "16.4.2",
    "react": "19.3.1",
    "react-dom": "19.3.1",
    "geist": "1.8.1",

    "zod": "4.6.7",
    "jose": "6.2.13",
    "nanoid": "6.0.2",
    "p-limit": "7.3.3",
    "p-retry": "8.0.1",
    "date-fns": "4.4.0",
    "@date-fns/tz": "1.5.0",
    "rrule": "2.8.1",
    "croner": "10.0.1",

    "clsx": "2.1.1",
    "tailwind-merge": "3.7.0",
    "class-variance-authority": "0.7.1",
    "lucide-react": "1.60.0",
    "motion": "14.4.0",
    "sonner": "2.0.8",
    "next-themes": "0.4.6",
    "next-intl": "4.14.9",
    "cmdk": "1.1.1",

    "@radix-ui/react-alert-dialog": "1.2.1",
    "@radix-ui/react-avatar": "1.3.1",
    "@radix-ui/react-checkbox": "1.4.1",
    "@radix-ui/react-dialog": "1.3.1",
    "@radix-ui/react-dropdown-menu": "2.2.1",
    "@radix-ui/react-label": "2.1.17",
    "@radix-ui/react-popover": "1.3.1",
    "@radix-ui/react-progress": "1.2.1",
    "@radix-ui/react-radio-group": "1.5.1",
    "@radix-ui/react-scroll-area": "1.4.0",
    "@radix-ui/react-select": "2.4.1",
    "@radix-ui/react-separator": "1.2.0",
    "@radix-ui/react-slider": "1.6.1",
    "@radix-ui/react-switch": "1.4.1",
    "@radix-ui/react-tabs": "1.2.1",
    "@radix-ui/react-tooltip": "1.4.1",
    "@radix-ui/react-visually-hidden": "1.2.13",

    "@tanstack/react-query": "5.104.5",
    "@tanstack/react-virtual": "3.14.21",
    "@dnd-kit/core": "6.3.1",
    "@dnd-kit/modifiers": "9.0.0",
    "@dnd-kit/sortable": "10.0.0",
    "react-hook-form": "7.90.0",
    "@hookform/resolvers": "5.9.2",
    "idb": "8.0.4",

    "@serwist/next": "9.5.13",
    "@upstash/redis": "1.39.0",
    "@upstash/ratelimit": "2.2.0",
    "inngest": "4.25.0",
    "@supabase/supabase-js": "2.118.0",
    "pg": "8.23.1",
    "resend": "6.34.1",
    "@vercel/blob": "2.8.2",
    "stripe": "23.0.0",

    "@google/genai": "2.30.0",
    "@huggingface/transformers": "4.3.1",
    "@modelcontextprotocol/sdk": "1.32.1",
    "@cfworker/json-schema": "4.1.1",
    "commander": "15.0.0",

    "pino": "10.4.0",
    "@opentelemetry/api": "1.10.0",
    "@opentelemetry/sdk-node": "0.300.0",
    "@opentelemetry/exporter-trace-otlp-http": "0.300.0",
    "@opentelemetry/auto-instrumentations-node": "0.82.0",
    "@sentry/nextjs": "11.8.0",
    "@vercel/analytics": "2.0.1",
    "@vercel/speed-insights": "2.0.0",
    "sharp": "0.35.5",
    "satori": "0.63.2",
    "@resvg/resvg-js": "2.6.2"
  },

  "devDependencies": {
    "typescript": "6.0.3",
    "@types/node": "26.6.5",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "@types/pg": "8.23.1",

    "tailwindcss": "4.3.3",
    "@tailwindcss/postcss": "4.3.3",
    "@tailwindcss/cli": "4.3.3",
    "postcss": "8.5.31",
    "tw-animate-css": "1.4.0",

    "eslint": "10.13.0",
    "eslint-config-next": "16.4.2",
    "@next/eslint-plugin-next": "16.4.2",
    "@eslint/js": "10.0.1",
    "typescript-eslint": "8.72.0",
    "eslint-plugin-react-hooks": "7.1.1",
    "eslint-plugin-security": "4.2.0",
    "eslint-config-prettier": "10.1.8",
    "globals": "17.13.0",

    "prettier": "3.9.10",
    "prettier-plugin-tailwindcss": "0.8.1",

    "vitest": "5.0.5",
    "vite": "8.3.4",
    "@vitejs/plugin-react": "6.1.2",
    "@vitest/ui": "5.0.5",
    "@vitest/coverage-v8": "5.0.5",
    "@vitest/browser-preview": "5.0.5",
    "happy-dom": "21.0.4",
    "@testing-library/react": "16.3.3",
    "@testing-library/dom": "10.4.2",
    "@testing-library/user-event": "14.6.8",
    "@testing-library/jest-dom": "7.0.1",
    "fast-check": "4.10.2",
    "msw": "3.0.3",

    "@playwright/test": "1.64.1",
    "tsx": "4.23.15",
    "husky": "9.1.7",
    "lint-staged": "17.6.0",
    "@next/bundle-analyzer": "16.4.2",
    "@next/codemod": "16.4.2",
    "@serwist/cli": "9.5.13",
    "babel-plugin-react-compiler": "1.0.0",
    "pino-pretty": "13.2.0"
  }
}
```

> **Why `@serwist/next` is a dependency but `@serwist/cli` is a devDependency:** the Next integration lives in the runtime build (it wraps the service worker), the CLI only runs at build time.
> **Why `vite` is explicitly installed:** Vitest 5 declares `vite` as a **required** peer (`^6.4 || ^7 || ^8`) — it is not bundled.
> **Why `openid-client` is not listed:** the OAuth flow in §3 is hand-rolled on purpose (small, transparent setup surface). Add `openid-client@6.8.8` only if the hand-rolled flow becomes a maintenance burden.

#### 6.1.3 What each dependency is for

| Group | Packages | Used by |
|---|---|---|
| **Framework** | `next@16.4.2`, `react@19.3.1`, `react-dom@19.3.1` | App Router, RSC, route handlers, SSE |
| **Styling** | `tailwindcss@4.3.3`, `@tailwindcss/postcss@4.3.3`, `tw-animate-css@1.4.0`, `postcss@8.5.31` | CSS-first `@theme` tokens (§0 palette), `prefers-color-scheme` vars |
| **Type safety** | `typescript@6.0.3`, `zod@4.6.7` | Env validation, API payload parsing, MCP tool schemas |
| **Session / auth** | `jose@6.2.13` | HMAC-signed share links (§28), share-token signing |
| **UI primitives** | `@radix-ui/*` (19 pkgs), `class-variance-authority`, `tailwind-merge`, `clsx`, `lucide-react` | `components/ui/*` (§6, §16) |
| **Motion / a11y** | `motion@14.4.0` | View transitions, list re-order animation; `prefers-reduced-motion` respected |
| **State** | `@tanstack/react-query@5.104.5`, `@tanstack/react-virtual@3.14.21` | Client fetch/cache, virtualised 200-row playlist list (§13.10) |
| **Drag & drop** | `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/modifiers` | Playlist re-order in the editor (§13.4, M9) |
| **Forms** | `react-hook-form@7.90.0`, `@hookform/resolvers@5.9.2` | Generator form, playlist settings, blocklist editor |
| **i18n / theme** | `next-intl@4.14.9`, `next-themes@0.4.6` | `messages/{id,en}.json` (§13.9), dark/light/system toggle |
| **Offline** | `idb@8.0.4`, `@serwist/next@9.5.13`, `@serwist/cli@9.5.13` | Service worker, IndexedDB, local mode (addendum §30) |
| **Scheduling** | `croner@10.0.1`, `rrule@2.8.1`, `@date-fns/tz@1.5.0` | Schedules, release radar, timezone/DST-safe firing (addendum §26) |
| **Infra** | `@upstash/redis`, `@upstash/ratelimit`, `inngest`, `@supabase/supabase-js`, `pg`, `resend`, `@vercel/blob`, `stripe` | Cache, rate limit, jobs, optional store, digests, cover storage, billing |
| **AI / graph** | `@google/genai@2.30.0`, `@huggingface/transformers@4.3.1` | Embeddings (addendum §23.1); the HF model is the offline fallback |
| **Distribution** | `@modelcontextprotocol/sdk@1.32.1`, `commander@15.0.0` | MCP server + CLI (addendum §29) |
| **Observability** | `pino`, `@opentelemetry/*`, `@sentry/nextjs`, `@vercel/analytics`, `@vercel/speed-insights` | Structured logs, traces, errors, web vitals (§13.10) |
| **Imaging** | `sharp@0.35.5`, `satori@0.63.2`, `@resvg/resvg-js@2.6.2` | Cover mosaic + OG share image (addendum §25.4, §27) |

#### 6.1.4 Breaking changes vs. the original plan (read before scaffolding)

| Was | Now | Action |
|---|---|---|
| Next.js 15 | **Next.js 16.4.2** | Turbopack is the **default** for `next dev` *and* `next build`. `experimental.turbopack` → top-level `turbopack` in `next.config.ts`. A custom `webpack` config now **fails the build** — use `--webpack` to opt out. |
| Next 15 sync `cookies()` / `headers()` / `params` / `searchParams` | Next 16 **async-only** | `await cookies()`, `await headers()`, `await props.params`, `await props.searchParams`. Use `next typegen` to get `PageProps<'/route'>` / `RouteContext` helpers. |
| `next lint` | **removed** | Lint via the ESLint CLI (`eslint .`); `next build` no longer lints; the `eslint` key in `next.config.ts` is gone. |
| `middleware.ts` | **`proxy.ts`** | Rename the file *and* the exported function. The proxy runtime is **Node.js only** — `edge` is not supported in `proxy`. |
| `serverRuntimeConfig` / `publicRuntimeConfig` | **removed** | Use env vars; read runtime-only vars in Server Components, `NEXT_PUBLIC_*` for the client. |
| `revalidateTag(tag)` | `revalidateTag(tag, profile)` | Second arg is now required (e.g. `'max'`). New `updateTag()` for read-your-writes in Server Actions. |
| `experimental.ppr` / `dynamicIO` / `useCache` | **`cacheComponents: true`** | One top-level flag replaces all three; it is not a rename — uncached data outside `<Suspense>` becomes a build error. |
| `next/image` defaults | `minimumCacheTTL` 60 s → **4 h**, `imageSizes` drops `16`, `qualities` → **`[75]`** | Thumbnails are the app's core visual; set `images.remotePatterns` for `i.ytimg.com`/`yt3.ggpht.com`, and only request quality 75 (or extend `qualities` explicitly). `images.domains` is deprecated. |
| Parallel routes | every slot needs `default.js` | Builds fail without it. |
| `next build` output | no `size` / `First Load JS` | Use Lighthouse + Vercel Analytics for bundle budgets (§13.10). |
| — | React Compiler now stable | Opt-in via `reactCompiler: true` + `babel-plugin-react-compiler@1.0.0`; slower builds, so leave it off until M13. |
| Tailwind `tailwindcss-animate` | **`tw-animate-css@1.4.0`** | The old package is v3-era. Tailwind 4.3 also adds `scrollbar-*`, `@container-size`, `zoom-*`, `tab-*`, stacked/compound `@variant`, `--default()` in `@utility`, and the `mauve/olive/mist/taupe` palettes. |
| ESLint 9 `.eslintrc` | **ESLint 10 flat config only** | `eslint.config.mjs`; `@next/eslint-plugin-next` now defaults to flat config, and `eslint-config-next@16.4.0+` supports ESLint 10. |
| Vitest 4 workspace file | **Vitest 5** | `vite` must be installed explicitly (required peer). Node floor `^22.12 \|\| ^24 \|\| ≥26`. Use `projects` instead of workspace files. |
| `framer-motion` | **`motion@14.4.0`** | Import from `motion/react`. `framer-motion` is the legacy alias. |
| `@xenova/transformers` | **`@huggingface/transformers@4.3.1`** | The Xenova package is frozen at 2.x. (Addendum §23.1.) |
| `zod` 3 | **`zod@4.6.7`** | Import from `zod` (v4 is the root export); `zod/v3` subpath if an API still expects v3 shapes. |
| MCP SDK 0.x | **`@modelcontextprotocol/sdk@1.32.1`** | `McpServer` + `StdioServerTransport`; zod v4 schemas natively. `zod-to-json-schema` is no longer needed. |
| `@hookform/resolvers` 6.0.0 | **5.9.2** | v6 declares peer `effect@^4.0.0` while `@typeschema/effect` (pulled in transitively) still wants `effect@^3.6.5` → hard `ERESOLVE` failure. v5.9.2 declares `effect@^3.10.3` and resolves cleanly. We only use the **zod** resolver, so there is no functional loss. |
| `eslint-plugin-jsx-a11y` | **dropped** | The latest (`6.10.2`) still declares peer `eslint ^3 … ^9` → incompatible with ESLint 10. `@next/eslint-plugin-next` already ships the jsx-a11y rules we care about (`alt-text`, `aria-props`, `aria-proptypes`, `role-has-required-aria-props`, `role-supports-aria-props`). If you want the full standalone rule set, pin `eslint@9.39.5` instead. |

#### 6.1.5 Install verification (performed 2026-10-21)

This manifest was **not** written from memory — it was resolved against the live npm registry and installed in a scratch directory:

```bash
npm install --package-lock-only --no-audit --no-fund
```

Result: **1491 packages resolved, install succeeds.** Two peer warnings remain, both originating inside `eslint-config-next@16.4.2`, which still depends on `eslint-plugin-jsx-a11y@^6.10.0` and `eslint-plugin-react@^7.37.0` (both declare `eslint … ^9`). npm nests `eslint@9.39.5` under `eslint-config-next` and continues — harmless, but noisy in CI logs.

**To silence the warnings:** pin `eslint@9.39.5` instead of `10.13.0`. We keep ESLint 10 because `eslint-config-next@16.4.0+` explicitly supports it.

#### 6.1.6 Install commands

```bash
nvm use 24                     # Node 24 LTS
npm install                    # installs the pinned manifest
npm run dev                    # next dev  (Turbopack)
npm run lint && npm run typecheck && npm test
```

Upgrade cadence: `npm outdated` at the start of every milestone; re-run the version check in §6.1.1 before bumping `typescript` past 6.x (wait for `typescript-eslint` to widen its peer range).

---

### 6.2 Folder layout

```
needledrop/
├── app/
│   ├── layout.tsx                  # fonts, theme tokens, shell
│   ├── globals.css                 # Tailwind v4 @theme + light/dark vars
│   ├── page.tsx                    # landing + live generator (client island)
│   └── api/
│       ├── auth/google/route.ts    # 302 → Google consent
│       ├── auth/callback/route.ts   # code → tokens → session cookie
│       ├── auth/logout/route.ts     # clear cookie
│       ├── auth/session/route.ts    # GET current identity + quota snapshot
│       ├── search/route.ts          # POST { query } → resolved seed candidates
│       ├── similar/route.ts         # POST { seedVideoId, count, options } → scored pool
│       ├── playlist/route.ts        # POST { videoIds, title, description, privacy } → playlist
│       └── playlists/route.ts       # GET user's existing playlists
├── components/
│   ├── site-header.tsx
│   ├── hero.tsx                    # split hero, no centered banner
│   ├── generator.tsx               # the real interactive form (client)
│   ├── seed-picker.tsx             # search → pick seed
│   ├── candidate-list.tsx          # scored tracks, selectable
│   ├── playlist-preview.tsx        # final tracklist + create button
│   ├── quota-meter.tsx
│   ├── sign-in-button.tsx
│   └── ui/                         # button, input, badge, skeleton, toast, empty-state
├── lib/
│   ├── env.ts                      # env validation (zod schema, fail-fast at boot)
│   ├── crypto.ts                   # AES-256-GCM seal/open
│   ├── session.ts                  # cookie read/write
│   ├── google-oauth.ts             # auth URL, code exchange, token refresh
│   ├── quota.ts                    # cost estimator
│   ├── format.ts
│   └── youtube/
│       ├── client.ts               # fetch wrapper: auth header, refresh, error mapping, quota meter
│       ├── types.ts
│       ├── search.ts
│       ├── similar.ts              # pool building + scoring (pure functions)
│       └── playlists.ts
├── tests/                          # vitest
│   └── similar.test.ts
├── scripts/                        # one-off maintenance jobs
│   ├── build-graph.ts              # co-occurrence graph rebuild (addendum §23.2)
│   └── release-radar.ts            # weekly new-release poll (addendum §26.2)
├── package.json                    # pinned manifest — see §6.1
├── eslint.config.mjs               # ESLint 10 flat config
├── vitest.config.ts
├── playwright.config.ts
├── prettier.config.mjs
├── .env.example
├── next.config.ts                  # Next 16: top-level `turbopack` key
├── postcss.config.mjs
├── tsconfig.json
└── README.md
```

**Pure-function core:** `lib/youtube/similar.ts` contains no I/O — only candidate scoring/filtering. That makes the hardest logic unit-testable without hitting the network.

**Config files, mapped to the manifest:**

| File | Pins |
|---|---|
| `next.config.ts` | `turbopack` (top-level in 16), `images.remotePatterns` for `i.ytimg.com` / `yt3.ggpht.com`, `reactCompiler` (off until M13) |
| `eslint.config.mjs` | flat config: `eslint-config-next` + `typescript-eslint` + `eslint-plugin-react-hooks` + `eslint-plugin-security` + `eslint-config-prettier` |
| `vitest.config.ts` | `environment: 'happy-dom'`, `@vitejs/plugin-react`, `projects` (not workspace files — Vitest 5) |
| `postcss.config.mjs` | `@tailwindcss/postcss` + `tw-animate-css` |
| `playwright.config.ts` | `webServer: next dev`, Chromium only for CI |

---

## 7. UI Flow & States

1. **Hero (split):** left = value prop + sign-in CTA. right = the live generator card.
2. **Step 1 — Seed:** input + live search. Results show thumbnail, title, artist, duration. Radio-select one.
3. **Step 2 — Discover:** spinner→skeleton list of ~30 scored tracks, each with a score badge, artist, duration, and a checkbox. Toggles: `include live`, `include remix`, `hide seed artist`, `count` (5–50).
4. **Step 3 — Assemble:** title (auto-filled from seed), description, privacy select, live quota estimate, "Create playlist".
5. **Step 4 — Done:** success card with a thumbnail strip, the playlist link, and "Open in YouTube Music" / "Open in YouTube".

**States required for every step:** loading (skeleton, not a spinner), empty (composed, explains how to fill it), error (inline, per-field where possible), success, and a `prefers-reduced-motion` path.

**Accessibility:** labels above inputs, WCAG AA contrast on all text/buttons in both themes, focus rings, keyboard-navigable track list, `aria-live` on quota/save status.

---

## 8. Milestones

| # | Milestone | Deliverable | Depends on |
|---|---|---|---|
| **M1** | Scaffold | Next.js 16 + TS 6 + Tailwind v4, env validation, base layout, dark/light tokens, pinned manifest (§6.1) | — |
| **M2** | Discovery (no auth) | `search.ts` + `similar.ts`, unit tests, `/api/search` + `/api/similar`, working candidate list | M1 |
| **M3** | OAuth | `google-oauth.ts`, `session.ts`, 3 auth routes, sign-in UI, session endpoint | M1 |
| **M4** | Playlist creation | `playlists.ts`, `/api/playlist`, quota meter, success state | M2 + M3 |
| **M5** | Polish | all states, a11y pass, mobile pass, empty/error copy | M4 |
| **M6** | Ship | README with the full Google Cloud walkthrough, Vercel deployment, `.env.example` | M5 |

M2 is deliberately independent of M3 so the hardest part (the similarity engine) can be validated against the live API before any auth friction is introduced.

> **Scope note.** M1–M6 ship the *core loop* (seed → discover → create). The mature feature set — engine v2, full playlist lifecycle, library integration, async jobs, cache + quota governance, UX maturity, platform hardening, public-launch readiness — is specified in **§12–§20** and sequenced as **M7–M14**.
>
> **Addendum.** The next maturity tier — taste profile, semantic engine v3, playlist health & auto-repair, templates & sets, autonomous runs, cross-platform interop, public API/CLI/MCP, offline-first local mode, product economics, and **API-accuracy corrections** — is specified in **`PLAN-ADDENDUM.md` §21–§35** and sequenced as **M15–M20**. The addendum is additive: it does not change anything in §1–§20.

---

## 9. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Refresh token expires in 7 days (consent screen = Testing) | User must re-login weekly | Document it; `prompt=consent` always requests a fresh refresh token; show a clear "session expired" state |
| `search.list` costs 100 units — easy to burn the daily quota | App stops working | Quota estimator in the UI; cap search calls at 4 per discovery run; cache seed lookups in memory for 10 min |
| "Official channel" is a heuristic, not an API field | Some tracks get mislabelled | Multi-signal scoring, not a boolean; users see the channel name so they can judge |
| Some songs exist on YouTube but **not** in YouTube Music (label restrictions) | Track shows in the playlist but won't play in YT Music | Cannot be verified via public API — surfaced as a README caveat, plus a note in the UI |
| `playlistItems.insert` is 50 units **per item** | 50-track playlist = 2,500 units | Show the estimate; default to 20 tracks; warn above 30 |
| Parallel inserts scramble track order | Playlist order wrong | Sequential insertion with explicit `position` |
| YouTube changes API behaviour | Breaks discovery | Thin `client.ts` wrapper isolates API calls; `similar.ts` is pure and testable |

---

## 10. Out of Scope (v1)

- Editing/reordering existing playlists (Data API supports it; not in the first release)
- Deleting playlists
- Multi-user accounts (the session is per-browser, stateless)
- Video uploads
- AI-generated track lists (the "prompt → tracklist" mode; this could be a v2 built on top of the same discovery engine)
- Collaborative playlists

> **Re-scoped.** Everything above is *deferred*, not cancelled. See **§12.1 Maturity Roadmap** for which tier each item lands in, and **§19.1 Decision Log** for the resolved answers to the questions below.

---

## 11. Open Questions for You

1. **Playlist count** — should the app support generating *multiple* playlists in one run (e.g. "3 mood variants"), or exactly one per seed?
2. **Discovery depth** — are you fine with the "related videos + artist radio + topic + curated playlists" blend, or do you want strict *artist-radius* similarity (only the seed artist's own songs)?
3. **Privacy default** — should new playlists default to `private` or `public`?
4. **Deploy target** — Vercel, or running locally only for now?

> Answers (with rationale) are recorded in **§19.1**. New decisions that still need your call are listed in **§19.2**.

---

## 12. Maturity Roadmap

v1 (M1–M6) proves the loop works. The features below turn a **demo** into a **product**. Each tier is independently shippable.

### 12.1 Tier map

| Tier | Theme | Features | Cost driver | Ships in |
|---|---|---|---|---|
| **v1** | Core loop | Seed → discover → create (M1–M6) | ~1,450 quota / 20-track playlist | M6 |
| **v1.5** | Quality of results | Engine v2 (canonical identity, multi-hop, popularity prior, explainable score), full curation controls, presets, blocklist | +1–3 `search.list` calls per run | M7–M8 |
| **v2** | Full product | Playlist lifecycle (edit/reorder/delete/duplicate), library page, async jobs, cache, quota ledger, rate limiting, export/share, inline player | infra: Redis + job runner | M9–M12 |
| **v3** | Platform | Optional persistence, feedback loop, CI/e2e/observability, feature flags, A/B engine, OAuth verification, public launch readiness | ops + compliance | M13–M14 |
| **v4** | Personal & intelligent | Taste profile, semantic engine v3 (embeddings + artist co-occurrence graph + MMR diversity), playlist health & auto-repair, templates & sets, personal insights | addendum §22–§25, §33 | M15–M17 |
| **v4.5** | Autonomous & distributed | Scheduled runs, release radar, digests, cross-platform interop, public API/CLI/MCP, offline-first local mode, quota economics | addendum §26–§31 | M18–M20 |

### 12.2 What v1 explicitly cannot do (and why it matters)

| Gap in v1 | Consequence | Fixed in |
|---|---|---|
| Dedupe by `title\|channel` | Same song from 5 channels = 5 identical rows | §13.1.1 canonical identity |
| One seed, one centroid | "More like this" is impossible | §13.1.6 breadth slider, §13.2 multi-seed |
| No popularity signal | Obscure uploads outrank classics | §13.1.4 popularity prior |
| Score is a black box | User can't trust or steer it | §13.1.5 explainable scoring |
| No way to remove a bad track after creation | Playlist is write-once | §13.4 playlist lifecycle |
| No dedupe against the user's library | Users get songs they already have | §13.5 library-aware dedupe |
| 50 sequential inserts = slow, no progress | "Is it stuck?" | §13.6 async jobs + SSE progress |
| Shared project quota | One heavy user burns everyone's daily quota | §13.7 quota ledger + per-user budget + BYO key |
| Stateless only | No history, no presets across devices | §13.8 optional persistence |
| Privacy = `public` default | Accidental public exposure | §19.1 decision 3 → `private` default |

---

## 13. Feature Expansion — Detailed Specs

### 13.1 Discovery Engine v2

#### 13.1.1 Canonical track identity (`lib/youtube/normalize.ts`, `lib/youtube/artist.ts`)

The single biggest quality win. A song uploaded to 6 channels is *one* track. Today v1 dedupes on raw `title|channel`, so it can't tell.

```
normalizeTitle(raw):
  1. strip bracketed groups: ( ) [ ] { } 【 】 【】 → remember their contents as "tags"
  2. classify each tag: versionTag ∈ {official, audio, video, lyric(s), visualizer,
     remaster(ed), explicit, clean, 4k, hd, hq, mv, m/v}
            versionTag ∈ {live, remix, acoustic, instrumental, karaoke, cover,
             sped up, nightcore, reverb, unplugged}
  3. strip leading/trailing separators, collapse whitespace, unify – — → "-"
  4. strip a trailing "feat. X" / "ft. X" / "with X" suffix → keep as featureArtist
  5. lowercase + NFD diacritics removal
  → { clean, versionTags:Set, featureArtist:string|null }

parseArtistTitle(title, channelTitle):
  candidates, in priority order:
    "Artist - Title"            (most common upload convention)
    "Artist | Title"
    "Artist _ Title"
    "Title by Artist"
    "Artist - Title (Official Video)"
  fallback → derive from channelTitle:
    strip " - Topic" | "VEVO" | "Official" | "Records" | "Music" suffix/prefix
  → { artist, title }

trackKey = slug(artist) + "::" + slug(title)      ← dedupe key across channels
versionKey = trackKey + "::" + versionTag         ← keeps live/remix as distinct
```

Consequences:
- One canonical `artist` per track → the "max N tracks per artist" diversity rule becomes *accurate* (today it counts channels, not artists).
- Version filtering becomes **precise** instead of keyword-blacking: a track whose only "live" marker was the word "Live" in the *song title* is no longer dropped.
- `featureArtist` lets "hide seed artist" also hide features, and lets the diversity rule count a featured artist separately.

```ts
// lib/youtube/normalize.ts  (pure, no I/O — unit-testable)
export type NormalizedTitle = {
  clean: string;
  versionTags: Set<VersionTag>;
  featureArtist: string | null;
};

export function trackKeyOf(t: { artist: string; title: string }): string;
export function isVersionAllowed(t: NormalizedTitle, policy: VersionPolicy): boolean;
```

#### 13.1.2 Multi-hop discovery

v1 = 1 hop from the seed. v2 = 2 hops, cost-capped:

```
hop 1: related(seed) ∪ artistRadio ∪ topic(seed) ∪ curated(genre)     → ~120 candidates
hop 2: related(top-3 hop-1 winners) only                              → +150 candidates
        (skip hop 2 when the daily budget is tight)
```
`DEPTH = 1 | 2` becomes a user-facing setting, with the quota delta shown next to it.

#### 13.1.3 Source attribution

Every candidate keeps *where* it came from, and the weight per source is configurable:

```ts
type SourceKind = 'related' | 'artistRadio' | 'topic' | 'curated' | 'artistChannel' | 'library';
type Candidate = {
  videoId: string; artist: string; title: string; durationSec: number;
  topicId?: string; topics?: string[]; channelTitle: string;
  viewCount?: number; likeCount?: number; publishedAt?: string;
  availableCountries?: string[]; madeForKids?: boolean; embeddable?: boolean;
  sources: SourceKind[];        // may come from several
  score: number;
  reasons: ScoreReason[];      // §13.1.5
};
```
UI: "because it appeared in *YouTube's related* **and** *topic: Indonesian pop*".

#### 13.1.4 Popularity & recency prior

`videos.list&part=statistics,contentDetails` gives `viewCount`, `likeCount`, `publishedAt`. Two extra, *toggleable* score signals:

| Signal | Formula | Points |
|---|---|---|
| Popularity | `10 * log10(1 + views) / log10(1 + 1e8)` | 0–10 |
| Engagement | `likeCount / max(1, viewCount)` → sigmoid | 0–5 |
| Recency | years since `publishedAt` (only when `includeNewReleases` on) | 0–5 |

They are **off by default** for the "pure similarity" profile and **on** for the "popular now" profile. This matters because `related` results are heavily skewed toward what YouTube currently pushes, not toward what the user would pick.

#### 13.1.5 Explainable scoring

The score becomes a list of `(label, points)` instead of a number:

```ts
type ScoreReason = { label: string; points: number };
// → [{ label: 'Same Wikipedia topic (Indonesian pop)', points: 40 },
//    { label: 'Official artist channel', points: 20 },
//    { label: 'Popular (1.2M views)', points: 9 }]
```
UI: a "Why?" popover per row. This is the difference between "AI magic" and "a tool you can steer" — and it makes the feature debuggable by the user, not just by us.

#### 13.1.6 Breadth slider (Similarity ↔ Discovery)

Two weight vectors, interpolated by a single 0–100 slider:

| Signal | Strict (0) | Explore (100) |
|---|---|---|
| Same `topicId` | +60 | +15 |
| Same artist as seed | +40 | +5 |
| Official channel | +25 | +10 |
| Popularity prior | 0 | +10 |
| Source diversity bonus | 0 | +8 |
| Duration proximity | +10 | +2 |

Strict = "songs that sound like this"; Explore = "songs in the neighbourhood". One slider, two presets at the ends.

#### 13.1.7 Availability, safety & embeddability flags

From `snippet.availableCountries`, `status.madeForKids`, `status.embeddable`, `status.license`:

- Region-blocked items get a muted "may be unavailable in your region" badge (and are skipped when `regionSafeOnly` is on).
- `embeddable === false` items are skipped by default (we embed previews and link out).
- `madeForKids` items are skipped when `familyMode` is on.
- Creative-Common items get a "CC" tag.

#### 13.1.8 Query-level pre-filtering (saves quota *and* improves quality)

`search.list` supports `publishedAfter` / `publishedBefore` / `videoDuration` / `videoCategoryId`. Apply the user's decade/duration/language constraints **to the query**, not after hydration — fewer candidates hydrated, fewer `videos.list` calls, and no need to throw work away.

| User filter | Query param |
|---|---|
| Decade 2010s | `publishedAfter=2010-01-01T00:00:00Z&publishedBefore=2019-12-31T23:59:59Z` |
| Full tracks only | `videoDuration=medium` (4–20 min) |
| Short tracks | `videoDuration=short` |
| Music only | `videoCategoryId=10` |

#### 13.1.9 Revised scoring table (v2, default "Balanced" profile)

| Signal | Points |
|---|---|
| Same `topicId` as seed | +40 |
| Same artist as seed | +15 (0 when *hide seed artist*) |
| Same `topicCategories` genre as seed | +12 |
| Official channel (`- Topic` / VEVO / Official) | +20 |
| Title contains seed artist | +10 |
| Title shape similarity (both look like single tracks) | +5 |
| Duration within ±25 % of seed | +5 |
| Popularity prior | 0–10 (toggle) |
| Cross-source agreement (found in ≥2 independent sources) | +6 |
| Duplicate canonical key | −∞ (removed) |
| Artist already at the cap (max N per artist) | −∞ (removed) |
| Region-blocked / not embeddable / kids-flagged (per policy) | −∞ (removed) |

---

### 13.2 Seed Sources — more than one text box

v1 only takes a text query. v2 accepts several seed shapes, all resolving to the same internal `SeedCentroid`:

| Source | How | API | Cost |
|---|---|---|---|
| Free text | `search.list` (as today) | 100 |
| **Paste a YouTube video URL** | parse `v=`, `youtu.be/`, `shorts/`, `live/` → `videos.list` | 1 |
| **Paste a playlist URL** | "make me one like this" → treat its items as a *centroid* of many tracks | 1 |
| **Artist name** | `search.list&type=channel` → resolve the artist's `- Topic` channel → `search.list&channelId=` | 100 + 100 |
| **Genre / mood preset** | curated official playlist IDs as a centroid | 1 |
| **"From my watch history"** (opt-in) | `activities.list` (`youtube.readonly`) | 1 |

**Centroid model.** A seed is no longer one track — it is a *profile*:

```ts
type SeedProfile = {
  videoIds: string[];          // 1..50 reference tracks
  artistWeights: Map<string, number>;
  topicIds: Set<string>;
  topicCategories: Set<string>;
  meanDurationSec: number;
};
```
A single-video seed is just a centroid of size 1. A pasted playlist becomes a centroid of up to 50 tracks — which is *dramatically* better than the current "one seed" model, and it is the closest thing the YouTube API offers to "sounds like this playlist".

**Blend mode.** The user can pick multiple seeds with weights: `Seed A 70% / Seed B 30%` → the centroid becomes a weighted mixture. This is how "I like X but a bit more like Y" gets expressed.

---

### 13.3 Curation Controls

Everything below is a first-class control with a persisted default, not a hidden constant.

| Control | Values | Notes |
|---|---|---|
| Track count | 5–50 | default 20 |
| Discovery breadth | slider 0–100 | §13.1.6 |
| Include live / remix / acoustic / instrumental / karaoke / sped-up / cover | 7 toggles | replaces the v1 keyword blocklist, now version-accurate |
| Max tracks per artist | 1 / 2 / 3 / unlimited | default 2 |
| Duration window | custom min/max seconds | also pushed into the query |
| Decade range | year → year | query-level |
| Language | multi-select from `snippet.defaultLanguage` | |
| Hide seed artist | toggle | |
| Hide tracks already in my library | toggle | §13.5 |
| Blocked artists / keywords | user list | persisted, per-user |
| Ordering | Score · Energy arc · Release date · Artist · Shuffle (seeded) | |
| Playlist privacy | private / unlisted / public | default private |
| Playlist title / description / tags | free text + auto-fill | auto-fill from centroid |

**Energy arc ordering.** Group the final list into 4 phases — *Warm-up → Build → Peak → Cooldown* — using the best available proxies (duration, popularity, source confidence, version tags: acoustic = warm-up, remix/energy = peak). It turns "a list of songs" into "a session". Purely cosmetic ordering, so it never changes *which* tracks are picked.

---

### 13.4 Playlist Lifecycle (the "mature" half of "playlist manager")

Today the app creates a playlist and that's it. A real playlist tool manages playlists.

| Action | Endpoint | Cost |
|---|---|---|
| Rename / re-describe / re-tag | `playlists.update` | 50 |
| Change privacy | `playlists.update` (status) | 50 |
| Reorder items (drag & drop) | `playlistItems.update` (newPosition) | 50 / moved item |
| Remove one item | `playlistItems.delete` | 50 |
| Delete playlist | `playlists.delete` | 50 |
| Duplicate a playlist ("v2 with tweaks") | `playlists.insert` + re-insert items | 50 + 50n |

**Lineage without a database.** App-generated playlists carry a machine-readable marker in the description:

```
<!--ytmg run=01J8X... v=2 seed=abc123 -->
```
- Lets the app recognise "my generated playlists" purely from the YouTube API (no DB required, works across devices).
- Enables **versioning**: regenerate with tweaks → new playlist, marker points to the previous run → the UI can show "v2 of <previous playlist>" and offer one-click rollback (create v1's tracklist again).

**Atomic-ish creation.** Playlist creation is a multi-request operation that can fail halfway. v2:
1. create playlist (50)
2. insert items one by one (50 each) — a failure at item 14 leaves a 13-item playlist
3. on failure → retry the failed item (idempotent via position + existing-item check), and after N failures → offer "keep partial playlist" / "delete and retry" / "resume later" (resume needs the job store, §13.6)

The client also **verifies** the final order with one `playlistItems.list` (1 unit) before declaring success — cheap insurance against ordering races.

---

### 13.5 Library Integration

- **My Playlists page** — `playlists.list&mine=true` (`youtube.readonly`, 1 unit/page). App-generated playlists are highlighted via the `<!--ytmg-->` marker; others are listed plainly.
- **Library-aware dedupe** — before creating, pull the user's existing playlists' items (`playlistItems.list`, 1 unit each, cached) and drop candidates whose canonical `trackKey` already exists. Toggle: *skip tracks I already have*.
- **Edit an existing playlist** — import any playlist into the editor, reorder, remove, then save back.
- **"Make one like this"** — from any playlist in the library: build a centroid from its items (§13.2) and run discovery.
- **Watch history / subscriptions** (opt-in, off by default, explicit disclosure): `activities.list` and `subscriptions.list` can feed the centroid for "songs like what I've been listening to". Both require `youtube.readonly` and both touch sensitive user data → opt-in, scoped, revocable, documented.

---

### 13.6 Job & Reliability Layer

**Why async:** creating a 50-track playlist = 51 sequential HTTP calls ≈ 30–60 s. That is unacceptable for a synchronous request (Vercel's 10 s function limit on Hobby makes it *impossible*). Even a 20-track playlist at ~20 calls can exceed a comfortable request budget.

```
POST /api/jobs  { seed, options, trackIds }
  → 201 { jobId, status: 'queued' }

GET /api/jobs/:id/stream        (SSE, one event per completed step)
  → { step: 'inserting', index: 14, of: 20, etaSec: 9 }
  → { step: 'done', playlistUrl, playlistId, inserted: 20 }
```

- Runner: **Inngest** or **Trigger.dev** (durable retries + visibility) with a plain in-process fallback for local dev.
- Progress UI: per-item progress, ETA, cancel button (marks the job cancelled; in-flight inserts finish, the rest are skipped).
- **Idempotency:** each job carries a client-generated `idempotencyKey`; a repeated POST with the same key returns the existing job instead of creating a second playlist (protects against double-clicks and mobile retries).
- **Resilience:** exponential backoff with jitter on 429/5xx, honour `Retry-After`; a **circuit breaker** opens after N consecutive upstream failures and the app serves cached results with a "results may be slightly stale" note.
- **Graceful degradation:** if discovery fails but we have cached candidates, serve them; if the API is fully down, the app still lets you export a hand-picked tracklist.

---

### 13.7 Quota & Cost Governance

The project's daily quota is **shared by every user**. That is the single biggest scaling constraint of the whole design, so it gets first-class treatment.

| Mechanism | Detail |
|---|---|
| **Live ledger** | Every API call writes `(operation, units, sessionId, runId)` → an exact "units spent" number per run, not an estimate |
| **Per-session budget** | Soft cap (e.g. 3,000 units/day per browser session); over it → the UI offers cached-only mode |
| **Global daily guard** | Configurable ceiling well under 10,000; when reached, discovery falls back to cache + a clear banner |
| **Dry run** | `POST /api/plan` returns the estimated cost + the top-N preview *without* calling the expensive endpoints |
| **Cost preview before commit** | v1 already shows an estimate; v2 shows estimate *and* actual, reconciled |
| **Cache** | Upstash Redis: `search:{q}` (30 min), `videos:{ids}` (6 h), `topic:{id}` (24 h), `playlistItems:{id}` (15 min) → a typical repeat run drops from ~1,450 to ~50 units |
| **Cache stampede control** | Request coalescing + `stale-while-revalidate` |
| **BYO API key (optional)** | Power users paste their own YouTube API key to bypass the shared quota. Store it encrypted per session; never log it; clearly labelled |
| **Operator dashboard** | A protected page: units/day, top operations, error rate, cache-hit rate, active sessions |

Rule of thumb to keep visible in the UI: **~1,450 units ≈ one 20-track playlist**; a 50-track playlist ≈ 3,100.

---

### 13.8 Persistence — optional upgrade from "stateless"

v1's no-database stance is a genuine feature (no signup, no PII, instant deploy). v2 keeps it as the default and adds an **opt-in** store for the things that genuinely need to be remembered across devices:

```
Supabase / Postgres (optional — app runs fully without it)
├── runs          : what was generated, with what options, quota used, resulting playlistId
├── presets       : named saved configurations ("Focus · 25 tracks · 2015-2025 · no live")
├── blocks        : blocked artists / keywords
├── feedback      : per-track keep/drop + reason
├── quota_ledger  : per-run unit accounting (analytics-grade)
└── user_settings : theme, i18n, default privacy, default count
```

Key decisions:
- **No account required.** The store is keyed by an anonymous `anonId` (signed cookie) until the user signs in with Google; then rows are linked to their email. Signing in is optional and only adds convenience.
- **Everything except `runs`/`feedback` can live in `localStorage`** for a no-backend mode. `runs` needs a server store; `feedback` needs one to be useful at all.
- **Degradation:** if the DB is unreachable, the app keeps working exactly as v1 does.

---

### 13.9 UX Maturity

| Area | Feature | Detail |
|---|---|---|
| **Preview** | Inline player | IFrame API player docked in the generator; click a row to audition without leaving the page |
| **Preview** | Keyboard shortcuts | `Space` play/pause · `←/→` prev/next · `/` focus search · `↑/↓` move selection · `Enter` add to playlist · `?` shortcut sheet |
| **Refine** | "More like these" | Select 3–5 tracks you liked → new centroid → another discovery round (the real iterative loop) |
| **Refine** | Exclude & re-rank | Remove a track → it is negatively weighted for the rest of the session (learned exclusion) |
| **Refine** | Compare | Two candidate lists side by side with per-track diff |
| **Output** | Export | `.m3u` / `.csv` / `.json` / plain text — for moving to Spotify/Apple Music via a third-party converter, and for the "playlist not in YouTube Music" caveat in §9 |
| **Output** | Copy tracklist | One click → formatted plain text for Discord/Instagram/notes |
| **Share** | Share link | Tracklist compressed into the URL fragment (`#t=...`) → shareable with **zero server storage**; the recipient sees the exact list even without the creator's account |
| **Share** | Share image | Server-rendered OG image of the playlist (cover strip + title) |
| **Install** | PWA | Installable, offline app shell, `share_target` so "share a YouTube link into the app" prefills the seed |
| **Locale** | i18n | Bahasa Indonesia + English from day one (the user base is Indonesian); copy lives in `messages/{id,en}.json` |
| **Theme** | Theme switch | Dark / Light / System toggle, persisted — v1 only follows `prefers-color-scheme` |
| **Onboarding** | 3-step interactive tour | Seed → tune → create, with a "how the scoring works" explainer |
| **Empty states** | Composed per error code | `quotaExceeded` · `authExpired` · `network` · `noResults` · `privateVideo` · `deletedVideo` · `regionBlocked` — each with a *specific* next action, not a generic "something went wrong" |
| **A11y** | Full keyboard path | Every step operable without a mouse; focus moves to the new step heading on transition; `aria-live` for quota/progress/save status; respects `prefers-reduced-motion`; screen-reader labels on the score badges and toggles |

---

### 13.10 Platform Engineering

**Testing pyramid**

| Layer | Tool | Scope |
|---|---|---|
| Unit | Vitest | `normalize.ts`, `artist.ts`, scoring, dedupe, quota estimator, export formats |
| Property-based | Vitest + fast-check | Invariants: `trackKey` is idempotent; normalize never returns empty; dedupe never exceeds the artist cap; score is deterministic for a fixed input |
| Contract | Vitest + recorded fixtures | Replay `search.list` / `videos.list` payloads from `tests/fixtures/` and assert the *exact* ranked output (golden files) — catches accidental scoring regressions |
| Integration | Nightly CI job, real API | Smoke test against the live API behind `RUN_LIVE_TESTS=1`, budgeted to ≤ 500 units/run |
| E2E | Playwright | Seed → discover → (mocked OAuth) → create → success; keyboard path; a11y snapshot |

**Tooling versions** (pinned in §6.1): `vitest@5.0.5` · `fast-check@4.10.2` · `msw@3.0.3` · `@playwright/test@1.64.1` · `eslint@10.13.0` · `typescript@6.0.3` · `prettier@3.9.10`.

**CI node matrix:** `24.x` (primary) · `26.x` (latest, non-blocking). Vitest 5 requires `^22.12 \|\| ^24 \|\| ≥26`, so **22.x is not a valid CI target** — do not add it to the matrix.

**CI/CD** — GitHub Actions: `lint` → `typecheck` → `unit` → `build` → `e2e` → preview deploy on PR; production deploy on merge to `main`; nightly live-API smoke; a scheduled dependency audit.

**Observability** — structured JSON logs (pino) with `requestId`; OpenTelemetry traces around every API call (operation, units, latency, cache hit); Sentry for errors; an uptime check on `/api/health`; a simple dashboard for the metrics in §20.

**Feature flags** — env-based, in `features/flags.ts`:
```
ENGINE_VERSION=v1|v2          // side-by-side engine comparison
DISCOVERY_DEPTH=1|2
CACHE_ENABLED=true|false
JOBS_ENABLED=true|false
PERSISTENCE_ENABLED=true|false
```
Lets engine v2 ship dark, compare output against v1 on real seeds, then flip.

**Performance budget** — cached TTFB < 300 ms · discovery round trip p95 < 4 s · LCP < 2.0 s on 4G · playlist list with 200 rows virtualised (no jank) · bundle < 150 KB gzip for the landing route.

**Security** — CSP + `X-Frame-Options` + `HSTS` headers · no token ever logged · secrets validated at boot (`lib/env.ts` fails fast) · rate limit **all** API routes (search hardest) · dependency audit in CI · `SESSION_SECRET` rotation path · tokens revoked server-side on logout (`oauth2.revoke`).

---

### 13.11 Compliance, Safety & Guardrails

| Area | Requirement |
|---|---|
| **YouTube API Terms** | Comply with the YouTube API Services Terms & Developer Policies: required attribution/branding, no bulk downloading, no separating/remixing audio into files, no permanent caching of restricted content |
| **Scope minimisation** | Only `youtube.force-ssl` + `youtube.readonly` + `userinfo.email` + `userinfo.profile`; the write scope is requested only when the user explicitly signs in, and there is no narrower scope for playlist writes |
| **OAuth verification** | Public launch requires Google OAuth verification + scope justification for `youtube.force-ssl` (a sensitive scope) — start this early (it takes days–weeks) |
| **Privacy** | Privacy policy page; "delete all my data" endpoint; token revocation on logout; watch-history access is opt-in, scoped, and revocable; no third-party analytics on unauthenticated pages without consent |
| **Copyright** | Metadata + links only; no lyrics, no downloads, no ripping; skip `embeddable=false`; respect `license` field and display CC attribution where applicable |
| **Safety** | "Family mode" skips `madeForKids` content; an optional "no explicit" heuristic filter (title/keyword based — imperfect, disclosed as such) |
| **Abuse** | Per-IP rate limits on all routes, stricter on `search.list`; Turnstile/hCaptcha on the public search endpoint if abuse appears; a hard global quota guard (§13.7) |
| **Honesty** | A clear note where a track may not exist in YouTube Music (label restrictions) — unverifiable via the public API, so we disclose rather than claim |

---

## 14. Revised Data Model

### 14.1 Optional Postgres schema (Supabase)

```sql
create table runs (
  id            uuid primary key default gen_random_uuid(),
  anon_id       text not null,
  user_email    text,
  seed_kind     text not null,           -- video | playlist | artist | profile
  seed_ref     text not null,
  seed_title    text,
  options       jsonb not null default '{}'::jsonb,
  track_count   int  not null default 0,
  quota_used    int  not null default 0,
  playlist_id   text,
  playlist_url  text,
  status        text not null default 'complete',
  duration_ms   int,
  created_at    timestamptz not null default now()
);

create table presets (
  id         uuid primary key default gen_random_uuid(),
  anon_id    text not null,
  name       text not null,
  options    jsonb not null,
  created_at timestamptz not null default now()
);

create table blocks (
  id         uuid primary key default gen_random_uuid(),
  anon_id    text not null,
  kind       text not null check (kind in ('artist','keyword','video_id')),
  value      text not null,
  created_at timestamptz not null default now(),
  unique (anon_id, kind, value)
);

create table feedback (
  id         uuid primary key default gen_random_uuid(),
  run_id     uuid references runs(id) on delete cascade,
  video_id   text not null,
  verdict    text not null check (verdict in ('keep','drop')),
  reason     text,
  created_at timestamptz not null default now()
);

create table quota_ledger (
  id         bigserial primary key,
  anon_id    text,
  operation  text not null,
  units      int  not null,
  run_id     uuid references runs(id) on delete set null,
  cached     boolean not null default false,
  created_at timestamptz not null default now()
);

create index runs_anon_created_idx   on runs (anon_id, created_at desc);
create index quota_ledger_created_idx on quota_ledger (created_at);
create index presets_anon_idx        on presets (anon_id);
```

### 14.2 Core domain types (TypeScript)

```ts
type VersionTag =
  | 'live' | 'remix' | 'acoustic' | 'instrumental' | 'karaoke' | 'cover'
  | 'spedUp' | 'nightcore' | 'reverb' | 'unplugged' | 'remaster'
  | 'official' | 'audio' | 'video' | 'lyrics' | 'visualizer'
  | 'explicit' | 'clean' | '4k' | 'hd';

type DiscoveryOptions = {
  count: number;                 // 5..50
  breadth: number;               // 0..100  (similarity ↔ discovery)
  depth: 1 | 2;
  includeVersions: VersionTag[]; // explicit allow-list
  maxPerArtist: number;          // 1 | 2 | 3 | Infinity
  durationSec?: { min: number; max: number };
  publishedRange?: { from: number; to: number };   // years
  languages?: string[];
  hideSeedArtist: boolean;
  skipAlreadyInLibrary: boolean;
  familyMode: boolean;
  regionSafeOnly: boolean;
  includePopularityPrior: boolean;
  includeNewReleases: boolean;
  order: 'score' | 'energyArc' | 'releaseDate' | 'artist' | 'shuffle';
  shuffleSeed?: number;
};

type SeedProfile = {
  kind: 'video' | 'playlist' | 'artist' | 'profile';
  videoIds: string[];
  artistWeights: Map<string, number>;
  topicIds: Set<string>;
  topicCategories: Set<string>;
  meanDurationSec: number;
};

type ScoreReason = { label: string; points: number };
```

---

## 15. Revised API Surface

| Method | Path | Purpose | Quota |
|---|---|---|---|
| POST | `/api/resolve` | Parse seed input (text / URL / playlist URL / artist) → seed candidates + centroid | 100–200 |
| POST | `/api/discover` | Full pipeline → scored, explained, deduped candidate list | 200–700 |
| POST | `/api/plan` | **Dry run**: cost estimate + top-N preview, no expensive calls | 0–2 |
| POST | `/api/jobs` | Create playlist asynchronously → `{ jobId }` | 50 + 50n |
| GET | `/api/jobs/:id` | Job status snapshot | 0 |
| GET | `/api/jobs/:id/stream` | SSE progress stream | 0 |
| GET | `/api/playlists` | User's playlists (page through `playlists.list`) | 1 |
| PATCH | `/api/playlists/:id` | Rename / re-describe / retag / change privacy | 50 |
| DELETE | `/api/playlists/:id` | Delete playlist (type-to-confirm in UI) | 50 |
| PATCH | `/api/playlists/:id/items` | Reorder / remove items | 50 |
| GET | `/api/library` | Library overview: playlists + app-generated markers + duplicate index | 1–5 |
| GET/POST | `/api/presets` | Saved configuration presets | 0 |
| GET/POST/DELETE | `/api/blocks` | Blocked artists / keywords | 0 |
| POST | `/api/feedback` | Per-track keep/drop signal | 0 |
| GET | `/api/quota` | Session budget + today's estimated usage | 0 |
| POST | `/api/export` | Render `.m3u` / `.csv` / `.json` / text | 0 |
| GET | `/api/health` | Liveness + upstream reachability (no auth) | 0 |

Conventions: all mutating routes require a valid session (except `resolve`/`discover`/`plan`); every response includes `unitsSpent`; every error returns a stable `code` (so the UI can render the per-code empty/error copy from §13.9); all routes are rate-limited.

---

## 16. Revised Project Structure

```
needledrop/
├── app/
│   ├── layout.tsx
│   ├── globals.css
│   ├── page.tsx                      # landing + live generator
│   ├── (app)/
│   │   ├── library/page.tsx          # my playlists
│   │   ├── library/[playlistId]/page.tsx   # playlist editor
│   │   ├── history/page.tsx          # past runs (needs persistence)
│   │   └── settings/page.tsx         # theme, locale, defaults, data deletion
│   └── api/
│       ├── auth/{google,callback,logout,session}/route.ts
│       ├── resolve/route.ts
│       ├── discover/route.ts
│       ├── plan/route.ts
│       ├── jobs/route.ts
│       ├── jobs/[id]/route.ts
│       ├── jobs/[id]/stream/route.ts
│       ├── playlists/route.ts
│       ├── playlists/[id]/route.ts
│       ├── playlists/[id]/items/route.ts
│       ├── library/route.ts
│       ├── presets/route.ts
│       ├── blocks/route.ts
│       ├── feedback/route.ts
│       ├── export/route.ts
│       ├── quota/route.ts
│       └── health/route.ts
├── components/
│   ├── site-header.tsx · hero.tsx · generator.tsx
│   ├── seed-picker.tsx · candidate-list.tsx · playlist-preview.tsx
│   ├── quota-meter.tsx · sign-in-button.tsx
│   ├── player/        # inline iframe player, now-playing strip, shortcuts
│   ├── controls/      # breadth slider, version toggles, filter sheet, ordering
│   ├── library/       # playlist list, item editor, drag-to-reorder
│   ├── jobs/          # progress, ETA, cancel, partial-failure recovery
│   └── ui/            # button, input, badge, skeleton, toast, sheet, tooltip
├── lib/
│   ├── env.ts · crypto.ts · session.ts · google-oauth.ts
│   ├── quota.ts · format.ts · rate-limit.ts
│   ├── youtube/
│   │   ├── client.ts · types.ts · search.ts · similar.ts · playlists.ts
│   │   ├── normalize.ts   # §13.1.1 canonical identity
│   │   ├── artist.ts      # artist/channel parsing
│   │   ├── topic.ts       # topicDetails → centroid
│   │   ├── regions.ts     # availableCountries, languages
│   │   └── live.ts        # liveBroadcasts.list → live/upcoming detection
│   ├── scoring/
│   │   ├── weights.ts     # strict ↔ explore vectors, §13.1.6
│   │   └── explain.ts     # ScoreReason generation
│   ├── seed/centroid.ts   # SeedProfile construction & blending
│   ├── cache/{redis.ts,keys.ts}
│   ├── jobs/{queue.ts,worker.ts,idempotency.ts}
│   ├── db/{schema.sql,client.ts}
│   ├── export/{m3u.ts,csv.ts,json.ts}
│   └── observability/{logger.ts,tracing.ts}
├── features/flags.ts
├── messages/{id,en}.json
├── tests/
│   ├── unit/ · contract/ · e2e/ · fixtures/ · properties/
├── .env.example · next.config.ts · postcss.config.mjs · tsconfig.json
└── README.md
```

---

## 17. Extended Roadmap (M7 – M14)

| # | Milestone | Deliverable | Depends on |
|---|---|---|---|
| **M7** | **Engine v2** | `normalize.ts` + `artist.ts` (canonical identity), multi-hop discovery, popularity/recency priors, explainable scoring, breadth slider, query-level pre-filters, golden-file tests | M6 |
| **M8** | **Curation & presets** | version toggles (7), artist cap, duration/decade/language filters, blocklist, presets, custom block/allow rules, saved defaults | M7 |
| **M9** | **Playlist lifecycle** | `playlists.update/delete`, `playlistItems.update/delete`, drag-to-reorder UI, playlist editor page, `<!--ytmg-->` lineage + versioning, library page, library-aware dedupe, seed-from-playlist centroid | M7 + M6 |
| **M10** | **Jobs, cache, quota** | async job runner + SSE progress + cancel + partial-failure recovery, Redis cache layer, quota ledger + budgets + dry-run plan endpoint, circuit breaker, rate limiting, operator dashboard | M6 |
| **M11** | **Persistence & history** | optional Postgres (Supabase) schema + repo layer, runs history page, feedback store, preset sync across devices, no-DB degradation path | M8 + M10 |
| **M12** | **UX maturity** | inline player + keyboard shortcuts, "more like these" refinement, energy-arc ordering, export (.m3u/.csv/.json), share link + OG image, PWA, i18n (id/en), theme switch, onboarding tour, per-error empty states, full a11y pass | M9 + M10 |
| **M13** | **Platform hardening** | Playwright e2e, property-based tests, CI pipeline, preview deploys, structured logging + OTel + Sentry, feature flags + engine A/B, perf budget work, security headers + secret rotation | M11 + M12 |
| **M14** | **Public launch** | Google OAuth verification (start early), privacy policy + data deletion, ToS-compliance page, load test, quota/BYO-key rollout plan, monitoring + on-call runbook, demo video + landing polish | M13 |
| **M15–M20** | **Addendum tier** | Taste profile · semantic engine v3 · playlist health & auto-repair · templates & sets · autonomous runs & release radar · interop & public API/CLI/MCP · offline-first local mode | M14 |

Dependency shape: M7 → M8 → {M9, M10} → M11 → M12 → M13 → M14. M9 and M10 can run in parallel. The M15–M20 sequence continues `M15 → M16 → M17 → {M18, M19} → M20` and is detailed in **`PLAN-ADDENDUM.md` §35.1**.

---

## 18. Updated Risk Register (additions)

| Risk | Impact | Mitigation |
|---|---|---|
| Shared 10,000-unit quota exhausted by a few users | App unusable for everyone | Per-session + global budgets, Redis cache, dry-run preview, BYO key option, quota dashboard, hard cap with cached-only mode (§13.7) |
| Sequential `playlistItems.insert` (50 units each) is slow and can partially fail | 30–60 s wait, half-created playlist | Async jobs + SSE progress, resumable job state, idempotency keys, order verification via `playlistItems.list`, partial-failure recovery UI (§13.4, §13.6) |
| Same song uploaded by many channels floods the list | Playlist feels broken | Canonical `trackKey` dedupe across channels (§13.1.1) |
| `relatedToVideoId` returns non-music or off-topic results | Poor recommendations | Category filter + topic scoring + explainable reasons + manual curation |
| Tracks unavailable in the user's region | Playlist items won't play | `availableCountries` flag, region-safe mode, UI disclosure (§13.1.7, §9) |
| OAuth verification rejected for `youtube.force-ssl` | Cannot create playlists in production | Start verification at M1, keep discovery-only mode functional, BYO key fallback, document the "export only" mode |
| API quota policy changes | Discovery breaks | Thin `client.ts` boundary, feature flags, cached-only degradation, contract tests that fail loudly |
| Explicit / NSFW content leaks into playlists | Reputation & policy risk | Family mode, keyword heuristics (disclosed as imperfect), blocklist, per-item removal in the editor |
| Storing refresh tokens in a cookie | Account compromise on XSS | AES-256-GCM + `httpOnly` + `Secure` + `SameSite=Lax`, 4 KB payload limit, never logged, revoked on logout, CSP headers |
| Users generate 100 playlists and hit quota walls | Frustration | Live estimate before commit, default 20 tracks, warn > 30, caps, dry run |
| Watch-history feature is perceived as invasive | Trust loss | Opt-in, explicit disclosure, granular revoke, delete-my-data endpoint |
| Engine v2 changes results unexpectedly | Regression | Feature flag `ENGINE_VERSION`, golden-file tests, A/B comparison on real seeds before flipping (§13.10) |

---

## 19. Decision Log

### 19.1 Resolved questions

1. **Playlist count** → Support **variants**. One run can emit 1–3 playlists from the same seed using different profiles (*Focus* / *Hype* / *Chill*) — implemented as N discovery runs with different weight vectors and filters. Each variant is an independent playlist. Cost: each extra variant ≈ +200–700 units; the UI shows the incremental cost before running. Default: 1 variant.
2. **Discovery depth** → Keep the **blended** model, but make it explicit and steerable: the source weights, the breadth slider, and the explainable reasons are all user-visible, and a strict **artist-radius** preset is one click away (seed artist only, ±20 % duration, same topic). Nobody has to guess what the engine did.
3. **Privacy default** → **`private`**. Rationale: an accidental public playlist exposes the user's taste and, on a shared project quota, a public playlist is also an invite for others to fill it. `unlisted` and `public` are one click away, and choosing `public` shows an explicit confirm. The UI also shows current privacy on every playlist card, so a private playlist never looks accidentally forgotten.
4. **Deploy target** → **Vercel** (Next.js App Router, zero-config deploy), with **Upstash Redis** (cache) and **Inngest** (jobs) as optional add-ons, plus a **Docker** path for self-hosting. The Postgres store stays optional so a fresh clone runs with zero external services.

### 19.2 Decisions still needed from you

1. **BYO API key** — ship it in the shared-quota model, or reserve it for an explicit "advanced" toggle? (Recommended: yes, but hidden behind a labelled toggle.)
2. **Persistence in v1.5** — add Postgres for `runs` + `feedback` now, or stay stateless until the feedback loop is proven? (Recommended: stay stateless through M10; add it in M11.)
3. **Launch shape** — public launch with a shared quota, or private beta first with an allow-list? (Recommended: private beta first; the shared quota makes public launch a product decision, not just a code change.)
4. **i18n scope** — Bahasa Indonesia + English only, or start with English-only to keep copy review manageable? (Recommended: ship `id` + `en` together from M12 — the primary audience is Indonesian.)
5. **Watch-history signals** — in scope at all for v2, or defer? (Recommended: defer past M12; it is the most privacy-sensitive feature in the set.)
6. **Artwork** — generate a playlist cover image? (The API gives a thumbnail strip, not a single cover; a generated cover is a nice touch but adds an image dependency and a ToS review item.) → *Partially answered in `PLAN-ADDENDUM.md` §25.4: the Data API v3 has **no** endpoint to set a custom playlist thumbnail, so generated covers stay in-app / share-image only. Recommendation: generate them in-app and offer a social export — never imply the cover is live on YouTube.*

> **Addendum decisions.** Six further decisions (embedding provider, taste-import scope, public-API access model, collaboration hosting, graph-corpus ownership, cover-art scope) are listed in **`PLAN-ADDENDUM.md` §35.5**, each with a recommendation.

---

## 20. Metrics & Instrumentation

**North star:** *playlists created per active user per week* (a created playlist is the only action that delivers the user's intent).

**Funnel:** search issued → seed resolved → discovery completed → at least one track added → playlist created → playlist opened in YouTube Music.

| Metric | Target |
|---|---|
| Seed → playlist conversion | ≥ 25 % |
| Discovery → "at least one track added" | ≥ 70 % |
| Discovery → playlist created | ≥ 40 % |
| Quota units per created playlist (20 tracks) | ≤ 1,600 |
| Cache hit rate (discovery) | ≥ 40 % |
| Discovery p95 latency | < 4 s |
| Playlist creation success (job completes) | ≥ 98 % |
| API error rate | < 1 % |
| 7-day returning users | ≥ 25 % |

**Quality proxies:** % of tracks the user keeps after generation (from the editor's removal count), the ratio of "refine" rounds to first-round playlists, and the share of playlists whose privacy the user later changes away from `private` (a signal that the default is wrong).

**Guardrails:** units/day, error rate by operation, job failure rate, % of runs served from cache, % of playlists containing a region-blocked track.

---

## Appendix A — Feature → API Cost Reference

| Feature | Calls | Cost | Runs at |
|---|---|---|---|
| Resolve text seed | 1 × `search.list` | 100 | on every search |
| Resolve URL seed | 1 × `videos.list` | 1 | on paste |
| Resolve artist seed | 1 × `search.list` (channel) + 1 × `search.list` (channelId) | 200 | on demand |
| Discovery, depth 1 | 2–4 × `search.list` + 1–2 × `videos.list` + 1 × `playlistItems.list` | 300–600 | on "Discover" |
| Discovery, depth 2 | +2–3 × `search.list` | +200–300 | optional |
| Library dedupe check | 1 × `playlistItems.list` per cached playlist | 1–5 | on create |
| Create playlist (n tracks) | `playlists.insert` + n × `playlistItems.insert` | 50 + 50n | on commit |
| Order verification | 1 × `playlistItems.list` | 1 | after create |
| Edit / reorder / remove | 50 per mutation | 50 | on demand |
| My playlists page | `playlists.list` | 1/page | on view |

**Rule of thumb:** ~1,450 units ≈ one 20-track playlist · ~3,100 units ≈ one 50-track playlist · the daily project quota of 10,000 ≈ 6–7 full 20-track playlists from scratch. Caching and dry-runs are what make a public launch viable.
