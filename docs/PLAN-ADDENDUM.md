# PLAN Addendum — Mature Feature Set (v3 → v4)

**Companion to:** `PLAN.md` (§1–§20 + Appendix A)
**Adds:** §21–§35 — the layer that turns a working tool into a product people keep using.
**Does not change:** the v1 plan, the M1–M14 roadmap, the stack, or the API surface already specified. Everything here is additive and lands *after* M14.

---

## 21. Addendum Overview

### 21.1 The gap this closes

`PLAN.md` gets you to a good **tool**: paste a seed, get a playlist, create it on YouTube. A tool is used once. A **product** is returned to.

The difference is not more buttons. It is four things:

| Missing | Consequence today | Fixed in |
|---|---|---|
| The app forgets you | Every run starts cold; you re-explain your taste each time | §22 taste profile |
| The app cannot explain *why* it chose a track | Users trust it less than a playlist they made themselves | §23 semantic engine + explainability |
| The app cannot maintain what it made | Dead links, duplicates, and stale playlists accumulate | §24 playlist health & auto-repair |
| The app cannot act without you | No schedules, no digests, no integration points | §26, §27, §29 |

### 21.2 Product moats

| Layer | Feature set | Moat type |
|---|---|---|
| **Recall** | §22 taste profile · §23 semantic engine | Data flywheel — quality improves with use; a competitor with no history cannot copy it |
| **Retention** | §24 playlist health · §25 templates & sets · §33 personal dashboard | Switching cost — your library, your profile, your history live here |
| **Trust** | §26 digests · §31 quota transparency · §34 accuracy corrections | Operational honesty — you always know what the app did and what it cost |
| **Reach** | §27 import/export · §29 public API / CLI / MCP | Distribution — the app becomes a component other people build on |

### 21.3 Updated tier map

| Tier | Theme | Spec | Ships in |
|---|---|---|---|
| v1 | Core loop | `PLAN.md` §1–§11 | M6 |
| v1.5 | Quality of results | `PLAN.md` §13.1–§13.3 | M7–M8 |
| v2 | Full product | `PLAN.md` §13.4–§13.9 | M9–M12 |
| v3 | Platform & compliance | `PLAN.md` §13.10–§13.11 | M13–M14 |
| **v4** | **Personal & intelligent** | **§22–§25, §33** | **M15–M17** |
| **v4.5** | **Autonomous & distributed** | **§26–§31** | **M18–M20** |

### 21.4 Non-goals for this addendum

- No audio analysis. The Data API exposes **no** audio features (no tempo, key, energy, waveform). Anything described as "energy" is a **heuristic inferred from genre/topic/duration/title** and must be labelled as such in the UI (§23.7, §34).
- No downloading, remixing, or separating audio — ToS. Links and metadata only.
- No scraping YouTube pages, no unofficial endpoints, no "unofficial API" libraries.
- No user accounts beyond Google OAuth. Identity is still optional.

---

## 22. Taste Profile & Personalization Layer

> **Problem.** v1/v2 discovery is stateless per seed. You tell it "more like this" and it forgets. You drop 8 tracks you hate and it will happily re-offer them next month.
> **Fix.** A persisted, **inspectable** taste profile that scores every candidate as a prior — and that the user can open, read, and correct.

### 22.1 Profile model

Not a black box. A hybrid of four interpretable components:

```ts
// lib/taste/profile.ts
export type TasteProfile = {
  version: number;                    // bump on schema change
  updatedAt: string;
  artists: Record<string, number>;    // artistKey -> affinity [-1 .. +1]
  genres: Record<string, number>;     // topicId / topicCategory -> affinity
  features: {
    energy: number;                   // 0..1  (heuristic, see §23.7)
    era: number;                      // 0..1  (0 = old, 1 = new)
    explicitness: number;             // 0..1
    instrumentalness: number;         // 0..1
    languages: Record<string, number>;// langCode -> affinity
  };
  embedding: number[] | null;         // centroid of liked track embeddings
  blocks: { artists: string[]; keywords: string[] };
  mustInclude: string[];              // artistKeys always eligible
  counters: { keep: number; drop: number; runs: number; playlistsCreated: number };
};
```

### 22.2 Learning rules (explainable, no gradient descent)

| Event | Δ `artists[artist]` | Δ `genres[topic]` | Note |
|---|---|---|---|
| User **keeps** a track in the editor | `+0.12` | `+0.05` | scaled by `sourceTrust` (official channel 1.0, unknown 0.7) |
| User **drops** a track (no reason) | `−0.20` | `−0.08` | |
| User **drops** with reason *wrong artist* | `−0.40` | `−0.05` | also offers "block this artist" |
| User **drops** with reason *not my genre* | `−0.05` | `−0.25` | also offers "block this topic" |
| User **drops** with reason *heard it already* | `−0.05` | `−0.02` | also flags the track as *owned* |
| User **drops** with reason *not in YouTube Music* | `0` | `0` | recorded as a **platform issue**, not a taste signal |
| User **adds** a track manually (not suggested) | `+0.25` | `+0.10` | strongest positive signal available |
| User **creates** the playlist | ×`1.02` on all positive artists | — | mild reinforcement |
| User **deletes** the playlist | ×`0.90` | — | mild negative reinforcement |

**Time decay.** `affinity *= 0.5 ^ (days_since_update / 30)` — taste drifts; a 30-day half-life keeps the profile current without an explicit "reset" gesture. A "forget this artist" button resets one entry to `0`.

### 22.3 Cold start

| State | Condition | Behaviour |
|---|---|---|
| **Empty** | 0 signals | Discovery runs on global priors only (topic + official + duration). UI prompts: *"Pick 3 tracks you love"* — a 3-question onboarding. |
| **Thin** | 1–9 signals | Profile weight is `min(0.3, signals/30)`; the rest comes from the seed. Honest: the app says *"still learning"*. |
| **Warm** | ≥ 10 signals | Profile contributes up to +25 points to a candidate's score, via the **Personalization** slider (0–100). |

### 22.4 Anti-bubble rules

The profile is a *prior*, never a cage:

- **Artist cap in profile**: no single artist may exceed **3 %** of total profile weight — even if you love them.
- **Serendipity budget**: at least **15 %** of final picks must come from outside your top-3 affinity clusters (unless the user disables it).
- **Profile ≠ filter**: a negative affinity never hard-blocks a track. It lowers the score. Hard blocking only happens via explicit `blocks`.
- **Reset & forget** are always one click away.

### 22.5 Feedback UX

- Thumbs up/down on every candidate row and every playlist row in the editor.
- Reason chips: *Not my genre · Wrong artist · Not this version · Too long · Already heard · Not in YT Music · Other*.
- **"Teach me" flow**: pick an artist → *More / Less / Never* → instantly updates the profile and re-ranks the current candidate list (no re-discovery needed).
- **Profile inspector**: a dedicated panel showing *"You like: Indonesian pop (62 %), lo-fi (24 %) · Top artists: … · Recently learned: …"*, with per-artist sliders and an *Explain* panel showing the exact point contribution.

### 22.6 Storage & privacy

- Optional Postgres table (below); `localStorage` mirror for the no-backend mode; per-`anonId` until sign-in, then linked to email.
- Watch history / subscriptions remain **opt-in** and are used *only* to bootstrap the profile — never to build a permanent per-user tracking profile beyond the affinity map.
- `DELETE /api/profile` and the global *"delete all my data"* endpoint cover the profile. The profile is derived data and can always be rebuilt from scratch.

```sql
create table taste_profile (
  anon_id      text primary key,
  user_email  text,
  version     int  not null default 1,
  artists     jsonb not null default '{}'::jsonb,
  genres      jsonb not null default '{}'::jsonb,
  features    jsonb not null default '{}'::jsonb,
  embedding   jsonb,
  blocks      jsonb not null default '{"artists":[],"keywords":[]}'::jsonb,
  counters    jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);
```

---

## 23. Semantic Discovery Engine v3

> **Problem.** v1's similarity = `topicId` equality + channel heuristics. v2 adds breadth, priors, and explanations. Neither actually captures *"this feels like that"* — and the YouTube API offers no audio features to help.
> **Fix.** Three orthogonal layers — **text semantics**, **curation graphs**, **diversity-aware selection** — combined in a hybrid scorer that stays explainable.

### 23.1 Layer A — text embeddings over track metadata

Build a semantic fingerprint per candidate and compare it to the seed centroid.

```
fingerprint(candidate) = "ARTIST — TITLE  [genres: Indonesian pop, indie pop]  [tags: official, remaster]"
```

- Embeddings come from a **text-embedding model**, not YouTube: Gemini `gemini-embedding-001` / `text-embedding-004` via `@google/genai@2.30.0`, or a local MiniLM (`@huggingface/transformers@4.3.1` — the successor to the frozen `@xenova/transformers@2.x`) running in a worker thread for the offline mode.
- Embeddings cost **0 YouTube units** but do consume a separate provider quota — they are cached aggressively (§23.8).
- Similarity = cosine similarity against the seed centroid.

**Why this matters:** `topicId` matches are exact and brittle — a track with *no* topic mapping scores 0 against everything, and Indonesian pop and Philippine pop are unrelated by ID but adjacent to a listener. Embeddings capture cross-language and cross-genre adjacency that IDs cannot.

**Honesty constraint:** embeddings are computed from **metadata text only**. They approximate *tag similarity*, not *sound*. The UI must say *"similar by title, artist, and genre tags — not by audio analysis"*.

### 23.2 Layer B — artist co-occurrence graph

YouTube's `relatedToVideoId` reflects **engagement**. A co-occurrence graph reflects **curation** — which is what a human playlist curator actually does.

```
Nodes : canonical artistKey (from §13.1.1 normalize.ts)
Edges : w(a,b) = PMI-like score of co-occurrence across a corpus of playlists
Signal: personalized PageRank from the seed artist, 2–3 steps, damping 0.85
```

- **Corpus** = operator-curated playlist IDs (`corpus/playlists.json`, each ID **verified in the API console before shipping** — never hardcode unverified IDs) + the user's own library playlists.
- **Cost:** `playlistItems.list` = **1 unit per playlist**, so a 60-playlist corpus = 60 units, once per night.
- **Computation:** pure, offline, no quota. Graph stored as an adjacency list in Redis/Postgres; a **prebuilt snapshot file** ships in the repo for the offline mode.
- **Why it beats `related`:** two artists that co-occur in 30 curated playlists are *closer* than two that merely got autoplayed together.

```ts
// lib/graph/pagerank.ts
export function personalizedPageRank(
  g: ArtistGraph,
  seeds: string[],
  opts: { steps?: number; damping?: number; personalisation?: number }
): Record<string, number>;
```

### 23.3 Layer B' — cheap artist catalogue harvest (v2 cost fix)

`PLAN.md` §4 Stage 3 source B uses `search.list&q=<artist>+radio` = **100 units**. There is a 1-unit path:

```
channels.list?part=snippet,contentDetails&id=<artistChannelId>
  → contentDetails.relatedPlaylists.uploads   ← the artist's own uploads playlist
playlistItems.list?playlistId=<uploadsId>&maxResults=50   ← 50 tracks, 1 unit
```

**100 units → 2 units**, and it yields the artist's *complete* catalogue instead of a search-ranked subset. Channel IDs come from `search.list&type=channel` (100 units, once) and are then cached for 90 days.

### 23.4 Layer B'' — trending seeding

```
videos.list?part=snippet,contentDetails&chart=mostPopular
  &videoCategoryId=10&regionCode=ID&maxResults=50     ← 1 unit
```

YouTube's "most popular" chart for the Music category in a region — a legitimate, cheap source of *what is hot right now*. Feeds the **Popular Now** and **Release Radar** profiles (§23.9) and works without any search.

### 23.5 Layer C — diversity-aware selection (MMR)

Top-N by score always clusters. The v1 "max 2 per artist" rule is a blunt patch. Replace it with **greedy Maximal Marginal Relevance** under explicit caps:

```
objective(i) = λ · normalizedScore(i) − (1 − λ) · max_{j ∈ S} similarity(i, j)
```

with hard caps `perArtist`, `perGenre`, `perEra`, and a `mustInclude` floor.

```ts
// lib/scoring/mmr.ts
export function selectDiverse(
  candidates: ScoredCandidate[],
  opts: {
    count: number;
    lambda: number;                                   // 1 = pure score, 0 = pure diversity
    similarity: (a: string, b: string) => number;     // trackKey or embedding distance
    caps: { perArtist: number; perGenre: number; perEra: number };
    mustInclude: string[];
  }
): ScoredCandidate[];
```

Properties this gives you for free:
- Deterministic for a fixed input (seeded shuffle is the only source of randomness) → reproducible, testable.
- No genre monoculture — a 20-track playlist cannot collapse into 14 Indonesian pop tracks even if they score highest.
- The *same* objective generalises the existing "energy arc" ordering into actual selection.

### 23.6 Hybrid scoring (v3 default profile "Balanced")

```
final(i) = w_topic   · topicSim(i)        // §13.1.9 signals
         + w_embed   · cosineSim(i)        // §23.1
         + w_graph   · pageRank(i)         // §23.2
         + w_seed    · artistMatch(i)      // same artist / title contains artist
         + w_pop     · popularityPrior(i)  // toggleable
         + w_profile · tastePrior(i)       // §22, slider-controlled
         + w_quality · qualityPrior(i)     // official channel, embeddable, region-safe
```

| Weight | Strict (0) | Balanced (50) | Explore (100) |
|---|---|---|---|
| `w_topic` | 60 | 40 | 15 |
| `w_embed` | 25 | 30 | 25 |
| `w_graph` | 30 | 25 | 20 |
| `w_seed` | 40 | 20 | 8 |
| `w_pop` | 0 | 5 | 10 |
| `w_profile` | 0 | 10 | 5 |
| `w_quality` | 20 | 20 | 15 |

The **breadth slider** (§13.1.6) now interpolates across *three* dimensions (topic ↔ semantics ↔ graph) instead of one. A second slider, **Novelty**, controls `similarity` distance from the user's existing library — i.e. *"how much do I want to hear something I already know?"* Default: middle.

### 23.7 The energy heuristic — and its honesty label

No audio features exist. Energy is **estimated** from:

| Proxy | Source | Confidence |
|---|---|---|
| Genre family (rock/metal/EDM vs. ambient/jazz) | `topicDetails` | medium |
| Duration | `contentDetails.duration` | low |
| Version tag (`remix` → high, `acoustic`/`instrumental` → low) | `normalize.ts` | medium |
| Popularity prior | `statistics.viewCount` | low |
| Title keywords (`remix`, `edm`, `slowed`) | `normalize.ts` | low |

Every UI surface that shows an "energy arc" must carry the microcopy: *"Energy is estimated from genre and metadata — not from audio."*

### 23.8 Embedding cost & caching

| Item | Cost | Cache |
|---|---|---|
| Embed ~150 candidate fingerprints | 150 short texts (batched, one provider call per 100) | key `emb:{sha1(text)}` → 30 days |
| Embed seed centroid | 1–50 texts | 30 days |
| Store candidate embedding | — | in the candidate row; Redis TTL 24 h |
| Co-occurrence graph build | 60 YouTube units/night | persisted, rebuilt nightly |

**Rule:** a repeat discovery run on the same seed should cost **≈ 50 YouTube units and ≈ 0 embedding calls**.

### 23.9 Profiles (presets over the engine)

| Profile | Weights | Behaviour |
|---|---|---|
| **Similar** | topic-heavy, strict breadth | *songs that sound like this* |
| **Balanced** | default | *same neighbourhood* |
| **Explore** | embed/graph-heavy, high novelty | *something new, adjacent* |
| **Popular Now** | + chart source (§23.4), popularity prior on | *what's hot this week* |
| **Deep Cuts** | popularity prior off, official-channel bonus halved | *the artist's B-sides* |
| **Focus** | strict, no remixes/live, ≤1 per artist, 25–45 min total | *concentration* |
| **Personal** | profile prior maxed, serendipity budget on | *tuned to you* |

### 23.10 Source attribution v3

Every candidate records **all** sources that surfaced it, and the UI states them:

> *"Found in: YouTube's related · co-occurrence graph (12 curated playlists) · topic: Indonesian pop"*

### 23.11 Evaluation harness (before flipping any engine flag)

- **Golden seeds**: 30 fixed seeds (mix of genres, languages, obscure + famous).
- **Contract fixtures**: recorded API payloads → exact expected ranked output (already in `PLAN.md` §13.10).
- **Human rating loop**: 10 pair-wise "which playlist would you actually listen to?" judgements per engine version per seed.
- **Metrics**: precision@10 (share of top-10 that a rater would keep), artist diversity (entropy over artists), genre coverage, novelty vs. library overlap, and **acceptance rate** (tracks kept in the editor).
- **Nightly job** compares `ENGINE_VERSION=v2` vs `v3` on the golden set and reports deltas. The flag flips only when v3 wins on ≥ 24/30 seeds **and** acceptance rate does not regress.

---

## 24. Playlist Health & Auto-Repair

> **Problem.** `PLAN.md` creates playlists and forgets them. Videos get deleted, go private, get region-blocked, or turn out to be 12 uploads of the same song.
> **Fix.** Every playlist the app creates is *managed* — checked on a schedule, scored, and repairable.

### 24.1 Health check

```
playlistItems.list?playlistId=<id>&maxResults=50        (1 unit)
videos.list?part=snippet,contentDetails,status,topicDetails&id=<ids>   (1 unit / 50 ids)
```

| Issue code | Detection | Severity |
|---|---|---|
| `deleted` | `videos.list` omits the id | error |
| `private` | `status.privacyStatus = 'private'` | error |
| `unavailable` | item present, video missing | error |
| `regionBlocked` | `contentDetails.regionRestriction.blocked` contains your country | warn |
| `notEmbeddable` | `status.embeddable = false` | warn |
| `kidsFlagged` | `status.madeForKids` (owner-only — see §34) | warn |
| `duplicateTrack` | same canonical `trackKey` appears 2+ times | warn |
| `wrongDuration` | outside the template's duration window | warn |
| `explicit` | `explicit` version tag present | info |
| `orderMismatch` | returned order ≠ intended order | error |

```ts
// lib/health/check.ts
export type PlaylistHealth = {
  playlistId: string;
  score: number;                       // 0..100
  issues: Array<{
    videoId: string;
    code: HealthIssueCode;
    severity: 'info' | 'warn' | 'error';
    detail: string;
  }>;
  duplicateGroups: string[][];         // groups of canonical trackKeys
  suggestions: RepairAction[];
};
```

### 24.2 Repair

| Repair | Mutation | Cost |
|---|---|---|
| Remove dead/private item | `playlistItems.delete` | 50 |
| Collapse duplicates (keep the official channel) | `playlistItems.delete` | 50 each |
| Re-sort to intended order | `playlistItems.update` (`newPosition`) | 50 each |
| Replace a dead track with the best unused candidate | `playlistItems.insert` + `delete` | 100 |
| Change privacy | `playlists.update` | 50 |

Repairs are offered as a **preview diff** ("3 items will be removed, 2 replaced, order fixed") and applied in one click. A **"repair in place"** mode mutates the playlist; a **"fork as v2"** mode creates a corrected copy and leaves the original untouched (matching the lineage marker in `PLAN.md` §13.4).

### 24.3 Scheduled health checks

- Nightly job (opt-in per playlist) re-runs the health check.
- **Notification** on change: *"2 tracks in 'Fokus #1' are no longer available — repair?"* (email via Resend, or in-app digest).
- Cost: **2 units per playlist per check**. 50 playlists = 100 units/night — negligible.
- **Honesty:** a repaired playlist is still not guaranteed to be playable in YouTube Music, because label availability is not exposed by the API (§34).

---

## 25. Templates, Sets & Covers

### 25.1 Occasion templates

A template is a named, versioned JSON preset of discovery options. Ship a starter pack in `content/templates/*.json`:

| Template | Defaults |
|---|---|
| `fokus-90` | 25 tracks · strict · no live/remix · ≤1 per artist · 45–60 min total |
| `gym-45` | 18 tracks · high energy · high tempo-ish proxies · no instrumentals |
| `malam-malam` | 22 tracks · chill · acoustic allowed · ordered by energy arc |
| `drive-midnight` | 30 tracks · explore · new releases on |
| `tidur` | 15 tracks · ambient/jazz topics · ≤45 min total |
| `fokus-deep-work` | 40 tracks · strict · no lyrics-tagged · artist cap 1 |
| `warmup` | 20 tracks · energy arc, acoustic-first |
| `party` | 25 tracks · popularity on · remix allowed |

Users can save any configuration as a custom template and share it as a link. The template editor shows a **live preview of what the template changes** relative to defaults — no black boxes.

### 25.2 Playlist sets (series)

A *set* groups related playlists ("Seri Fokus #1…#5", "Asia Beat 2026 Volume 2").

- Stored **without a database** by extending the `<!--ytmg-->` lineage marker:
  ```
  <!--ytmg run=01J8X… v=2 set=fokus-90 excl=a1b2c3,d4e5f6 -->
  ```
  The `excl` field lists canonical `trackKey` hashes of tracks already used in the set → **"generate the next episode without repeating the last one"** works across devices with zero storage.
- Optional DB row for richer metadata (title, description, ordering) when persistence is enabled.

### 25.3 Episode diff

Compare two episodes of a set: *added · removed · kept · re-ordered*, rendered as a clean diff. Turns the app from a generator into a **series editor**.

### 25.4 Cover composition

Generate a cover from the first 4 track thumbnails in a deterministic 2×2 grid (plus a title plate), rendered server-side to PNG.

> **Important limitation (§34):** the YouTube Data API v3 exposes **no endpoint to set a custom thumbnail on a user playlist**. Generated covers therefore live **in-app** and in **share images / OG cards**, and can be downloaded by the user. They cannot be applied to the playlist on YouTube without uploading them as a video, which we will not do (ToS). The UI states this plainly rather than implying the cover is live on YouTube.

---

## 26. Autonomous Runs — Schedules, Release Radar, Digests

### 26.1 Scheduled generation

"Every Monday at 06:00, build my Focus playlist from my taste profile."

- Scheduler: **Inngest** cron (durable, retries, visibility) or an external cron (GitHub Actions / Vercel cron / Cloud Scheduler) — Vercel Hobby cron is once/day, so a minute-level schedule needs Inngest or an external cron.
- Timezone-aware (`tz` field, DST-safe), with a preview of the next 3 fire times.
- Each run respects the **global quota guard** and the **per-session budget** (§31): if quota is tight, the run is *skipped with a reason*, not silently dropped.
- Output: a new playlist (private by default, §19.1 decision 3) + a digest entry.

```sql
create table schedules (
  id          uuid primary key default gen_random_uuid(),
  anon_id     text not null,
  kind        text not null,            -- weekly | release_radar | custom
  cron        text not null,
  tz          text not null default 'UTC',
  template    jsonb not null default '{}'::jsonb,
  options     jsonb not null default '{}'::jsonb,
  enabled     boolean not null default true,
  last_run_at timestamptz,
  created_at  timestamptz not null default now()
);
```

### 26.2 Release radar

Follow artists/channels; get notified when they publish something that matches your taste.

```
channels.list?part=contentDetails&id=<channelIds>          (1 unit / 50 ids)
  → relatedPlaylists.uploads
playlistItems.list?playlistId=<uploadsId>&maxResults=50      (1 unit)
  → diff against last-seen set
```

- **Cost:** 2 units per artist per poll (batched: 50 channels per call → ~2 units per 50 artists).
- New tracks are scored against the profile and filtered by the user's rules (no remixes, explicit off, etc.) before surfacing.
- Actions: *Add to a new playlist · Add to an existing playlist · Ignore · Never notify about this artist*.

### 26.3 Digests

- **Weekly digest email** (Resend): new releases matching your taste, playlists created, tracks discovered, quota used.
- **In-app digest** with the same content.
- Fully disableable per category. No marketing email, ever.

### 26.4 Safety rails for autonomous runs

- Max **3** scheduled runs per user per day.
- Max **20** tracks per autonomous playlist.
- Every autonomous playlist is **private** by default and clearly labelled *auto-generated* in its description.
- A **"pause all schedules"** kill switch, reachable without signing in again (session-scoped).
- Every run is logged with its cost in the quota ledger (§13.7).

---

## 27. Import and Export Extensions

### 27.1 Taste import from user-provided listening-history files (cold-start killer)

Users arrive with years of listening history. Importing it produces an excellent taste profile on day one.

- Accept **pasted or uploaded CSV/JSON** listening-history files with a generic column mapper.
- **Parsing happens in the browser** by default — the file never touches our server. Only the derived aggregates (artist counts, top tracks) are sent, and only if the user opts in.
- Aggregates → `tasteProfile` (artists + genres + era) → immediately usable.
- **Top-20 artist resolution to YouTube** costs ~100 units per artist via `search.list`. Therefore:
  - Resolve only the **top 20 artists** (~2,000 units) and cache the mapping for **90 days**.
  - Offer a **manual override**: the user pastes their own YouTube links for the artists they care about → resolution drops to `videos.list` = 1 unit each.
  - Show the cost *before* resolving, with a *"resolve fewer artists"* option.

### 27.2 Export adapters

| Format | Use |
|---|---|
| `.m3u` | generic player import |
| `.csv` | spreadsheets, further analysis |
| `.json` | structured, includes scores, reasons, and canonical track keys |
| `.txt` | copy-paste into Discord / Instagram / notes |
| **Transfer list** | Plain-text `title — artist` pairs for user reference or manual use |

**Compliance note:** we produce *metadata and links only*. We do not extract, host, or transform audio. Export files are for user reference and offline handling; needledrop does not connect to music services other than YouTube.

### 27.3 Deep links

Every track row can jump to `music.youtube.com/watch?v=…` or `youtube.com/watch?v=…`, and offers a **copy-link** action.

### 27.4 Embeddable playlist widget

A read-only HTML snippet that renders a playlist preview (cover strip + tracklist + link) for a blog. Uses only public data, is cacheable, and degrades to a static link if JS is disabled.

---

## 28. Collaboration & Sharing

### 28.1 Share links without storage

The tracklist is compressed into the URL **fragment** (`#t=…`), so the server never stores it. Two flavours:

| Mode | Payload | Trade-off |
|---|---|---|
| **Portable** | compressed track ids + title | Zero storage, works forever, URL may get long |
| **Signed** | payload + HMAC signature | Recipient can verify the list came from you; key rotates |

### 28.2 Group picking mode

> *"Send this to 3 friends, each picks 5 tracks, and we get a playlist of 15."*

- Owner creates a **pick session**; each recipient opens a link, picks N tracks (search or from a shared candidate pool), and submits.
- Until sign-in, a recipient's picks live in their browser and sync to the owner's inbox via an anonymous `pickToken`.
- The owner merges picks into one playlist — the merge respects the canonical `trackKey` dedupe (§13.1.1).
- **Honest limitation:** the YouTube Data API has **no playlist-comments endpoint** (`commentThreads` is video-level only), so all collaboration lives in our app, or is mirrored into the playlist description.

### 28.3 Live presence

Optional real-time "others are picking" view via SSE + a presence heartbeat (Redis). Cheap, delightful, and optional. The pick session can be closed by the owner at any time.

---

## 29. Public API, CLI & MCP Server

### 29.1 Public REST API

```
GET  /api/v1/discover?seed=<text>&count=25&profile=balanced
POST /api/v1/playlists            { trackIds, title, privacy }
GET  /api/v1/playlists
GET  /api/v1/quota
```

- Auth: **project API key** (`ytmg_live_…`), scoped per key, with its own **daily unit budget**. This is the structural fix for the shared-quota problem: each key consumes *its own* project quota, so a heavy user cannot drain the shared pool.
- Rate limits per key; standard responses include `unitsSpent` and `cacheHit`.
- Versioned (`/v1`), documented with an OpenAPI spec, and a public status page.

### 29.2 Webhooks

`playlist.created` · `job.completed` · `job.failed` · `quota.threshold` · `playlist.health_changed` — signed payloads, retried with backoff, visible in a webhook log UI.

### 29.3 CLI

```
ytmg discover "Rex Orange County" --count 25 --profile similar --json
ytmg create --from discovery.json --title "Focus" --privacy private
ytmg playlists --mine
ytmg quota
```

### 29.4 MCP server

Expose the app as tools for AI agents:

| Tool | Description |
|---|---|
| `discover_similar_tracks` | seed + options → scored, explained candidates |
| `create_youtube_playlist` | track ids + title → playlist URL |
| `list_my_playlists` | the user's playlists (requires auth) |
| `explain_track_choice` | why a candidate scored what it scored |
| `get_quota_status` | remaining units for the caller's key |

This is how the product reaches people who never open a web UI, and it is a natural fit for agent-driven "make me a playlist" workflows.

---

## 30. Offline-First & Local Mode

### 30.1 Two deployment postures

| Posture | Backend | Identity | Data |
|---|---|---|---|
| **Hosted** (default) | Next.js + optional Redis/Postgres | Google OAuth | Server-side, encrypted session |
| **Local / static** | **None** — static export + browser storage | User's own API key / OAuth token, stored locally | Browser only |

### 30.2 Local mode — why it matters

- **The shared quota problem disappears** for power users: they bring their own YouTube API key.
- **Zero trust surface**: no account, no server, no telemetry. All discovery runs in the browser.
- **Works offline** after the first load (service worker + IndexedDB).
- **Free to run forever** — it is a static site.

### 30.3 What Local mode can and cannot do

| Capability | Local (browser) | Why |
|---|---|---|
| Discovery, search, scoring, playlist *preview* | ✅ | read-only `GET` endpoints on the Data API are callable from the browser with the user's `key` param |
| Export `.m3u` / `.csv` / `.json` | ✅ | pure client-side |
| Taste profile, presets, history | ✅ | IndexedDB + `localStorage` |
| **Creating** a playlist | ⚠️ via the user's own OAuth token, stored locally | write endpoints need a bearer token; putting a shared server secret in the browser is not acceptable, but the *user's own* token is theirs to use |
| Background schedules | ❌ (or via local cron on a personal machine) | no server timer |
| Multi-device sync | ❌ | local storage only |

**Disclosure requirement:** Local mode must display a clear banner: *"Local mode — your API key and your data never leave this device."*

### 30.4 Service worker & offline shell

- Precache the app shell, fonts, and UI; runtime-cache API responses (with a quota-aware LRU).
- Offline state shows cached candidates with a *"showing cached results — you are offline"* banner, never a blank screen.
- `share_target` PWA handler: sharing a YouTube link into the app prefills the seed.

---

## 31. Cost, Quota & Product Economics

### 31.1 Unit economics

| Scenario | YouTube units | Notes |
|---|---|---|
| Discovery, depth 1, cache miss | 200–700 | v3 adds 0 (embeddings ≠ quota) |
| Discovery, depth 1, cache hit | **0–2** | full cache hit |
| Discovery, depth 2 | +200–300 | optional |
| Playlist creation (n tracks) | 50 + 50n | dominant cost |
| Health check | 2 | per playlist |
| Release radar poll (50 artists) | ~2 | per poll |
| Graph corpus rebuild | ~60 | per night |

**Rule of thumb (carried over from Appendix A):** ~1,450 units ≈ one 20-track playlist · ~3,100 ≈ one 50-track playlist · 10,000/day ≈ 6–7 cold playlists.

### 31.2 Quota-aware UX

- A live ledger showing **actual** units spent per run (not just an estimate).
- Global guard: a configurable ceiling (default **7,000 of 10,000**) leaves headroom for health checks and radar polls.
- Over-budget → the app switches to **cached-only mode** with a clear banner, never a silent failure.
- A **"dry run"** (`POST /api/plan`) shows cost + top-N preview without spending the expensive units.

### 31.3 Tiers

| Tier | Quota source | Who |
|---|---|---|
| **Free** | shared project pool, capped | everyone |
| **BYO key** | user's own YouTube project | power users (toggle in settings) |
| **Supporter** | BYO key + priority cache + scheduled runs | optional paid tier |
| **Team** | own project quota + API keys + webhooks | small teams |

### 31.4 A ToS note we should not skip

Spreading load across **multiple GCP projects to multiply quota** is a quota-circumvention pattern and is likely non-compliant with the YouTube API policies. **We do not do it.** The legitimate levers are caching, dry runs, BYO keys, budget caps, and queueing — and this is stated explicitly in the operator docs so no one "solves" quota problems later by breaking the rules.

---

## 32. Editorial & Community Layer

- **Curated templates**: templates can be published, signed, and attributed to a curator (*"T template by @curator"*). Templates are data, not code — reviewed in a repo-style moderation queue.
- **Community corrections**: *"This track doesn't exist in YT Music"* / *"This is the wrong song"* reports feed a **verified-issue list** that suppresses known-bad video IDs globally.
- **Playlist-of-playlists**: note the API constraint — `playlistItems.insert` accepts **videos only**, so a playlist containing playlists cannot exist on YouTube. The app can model it and mirror it as a description link, but must not pretend it is a real YouTube playlist.
- **Seasonal packs**: an editorial catalogue (e.g. *Asia Beat 2026*, *Indonesian Pop Rewind*) that produces a multi-playlist set with a shared marker.

---

## 33. Analytics & Personal Insights

### 33.1 Personal dashboard

| Panel | Question answered |
|---|---|
| **Taste drift** | "How has my listening changed over 6 months?" (affinity timeline) |
| **Genre coverage** | "What have I been ignoring?" — genres with zero tracks in the last 30 days |
| **Discovery stats** | "How many tracks did the app surface that I actually kept?" |
| **Artists discovered** | "Which artists did I find *because* of this app?" (first-appearance date) |
| **Template usage** | "Which occasion templates do I actually use?" → suggests pruning |
| **Cost per playlist** | "What did my generation habit cost in quota?" |

### 33.2 Quality proxies (extend `PLAN.md` §20)

| Metric | Target |
|---|---|
| Track acceptance rate (kept in editor) | ≥ 65 % |
| Artist diversity (entropy) | ≥ 0.75 normalized |
| Genre coverage per playlist | ≥ 3 distinct topics |
| Duplicate rate in created playlists | ≤ 1 % |
| Health score of created playlists (30-day) | ≥ 92 |
| Profile hit rate (runs where profile changed the result) | ≥ 40 % |

### 33.3 Operator dashboard (extend)

Units/day by operation · cache-hit rate by endpoint · error rate by operation · job failure rate · discovery latency p50/p95 · embeddings cache-hit rate · top templates · **users hitting the quota wall** (the leading indicator for a pricing or BYO-key prompt).

---

## 34. Technical Corrections & API-Accuracy Notes

> These are corrections to `PLAN.md` as written. They are cheap to fix now and expensive to fix after M13.

| # | `PLAN.md` says | Reality | Action |
|---|---|---|---|
| 1 | `snippet.availableCountries` (§13.1.7, §16 `regions.ts`) | **No such field in Data API v3.** Region restriction appears as `contentDetails.regionRestriction` (`blocked` / `allowed` country lists) and only on restricted content | Rewrite `lib/youtube/regions.ts` to read `contentDetails.regionRestriction`. Absent ≠ "available everywhere" — label it *"no region restriction reported"* |
| 2 | `lib/youtube/live.ts` → `liveBroadcasts.list` (§16) | `snippet.liveBroadcastContent` ∈ `none\|upcoming\|live` is on every snippet and is **free**; `liveBroadcasts.list` only returns *currently* live/upcoming broadcasts, so it cannot detect "a live version of a past song" | Detect live from the snippet field; keep `liveBroadcasts.list` only for *upcoming* broadcasts (1 unit, opt-in) |
| 3 | Duration as seconds (§4 Stage 2) | `contentDetails.duration` is **ISO-8601** (`PT3M33S`) | Add `parseIsoDuration()` and unit-test it. Live items have `PT0S` |
| 4 | "insert with explicit `position` guarantees order" (§4 Stage 6) | Positions are **accepted but not strictly guaranteed**; out-of-range positions are rejected, and conflicts can cause appends | Insert **sequentially, appending**, then **verify** with one `playlistItems.list` (1 unit). Use explicit positions only as a hint |
| 5 | `playlistItems.insert` for "playlist of playlists" (§32) | `resourceId.kind` must be `youtube#video` — **only videos** | Model it in-app only; never claim a YouTube playlist-of-playlists |
| 6 | "Comment on playlists" (§28) | No playlist-comment endpoint exists; `commentThreads` is video-level | Collaboration lives in our app |
| 7 | `youtube.readonly` "only requested when the user opts into library features" (§13.11) | Read access to public data via OAuth already needs `youtube.readonly`; it is one scope for search/videos/playlists/activities | Request it once, upfront; the *scope* is not the privacy boundary — **feature-level consent** is |
| 8 | `relatedToVideoId` + `videoCategoryId` (§4 Stage 3A) | Not documented as an unsupported pair, but `related` is **not guaranteed** to be music-only | Always post-filter on `snippet.categoryId === '10'` |
| 9 | `search.list` "100 units, the expensive one" | Still true, but **`videos.list?chart=mostPopular&videoCategoryId=10&regionCode=ID` = 1 unit** and yields the regional trending chart | Add as a first-class source (§23.4) |
| 10 | Artist radio via `search.list&q=<artist>+radio` (§4 Stage 3B) | `channels.list?part=contentDetails` → `relatedPlaylists.uploads` + `playlistItems.list` = **2 units** instead of 100 | Replace (§23.3) |
| 11 | "family mode skips `madeForKids`" (§13.11) | `status.madeForKids` is generally **owner-only**; for third-party videos it is usually absent | Family mode must combine the best-effort field with the **title/keyword heuristic**, and say so |
| 12 | `snippet.tags` used for features (§23.7) | Tags are **best-effort** — may be omitted or truncated | Treat tags as an optional enrichment layer, never a hard dependency |
| 13 | `topicDetails` | Provides `topicId` + `topicCategories`; newer API versions add `topicCategoryLinks` | Read category *titles* when present, fall back to the URL slug |
| 14 | `guideCategories.list` imagined as a genre-playlist source | It returns category **names and counts**, not playlist IDs | Do not rely on it for a corpus; use an operator-verified playlist ID list (`corpus/playlists.json`) |
| 15 | "Set a custom playlist thumbnail" (§25.4) | **No write endpoint exists** for playlist thumbnails | Covers stay in-app/share-only, with a plain-language explanation |
| 16 | `videos.list` "up to 50 ids per call, 1 unit" | Correct — cost is per *call*, not per id | Batch aggressively; 1 call can hydrate 50 candidates |
| 17 | `activities.list` (watch history, §13.2) | Returns roughly the last 90 activities per page; must paginate | Cap the fetch, disclose the window |

**Verification discipline:** before M14, re-check every field name in this addendum and in `PLAN.md` against a live API console session, and record the responses in `tests/fixtures/`. Field-name drift is the most likely cause of a silent discovery regression.

---

## 35. Extended Roadmap, API Surface & Governance

### 35.1 Roadmap M15 – M20

| # | Milestone | Deliverable | Depends on |
|---|---|---|---|
| **M15** | **Taste profile & feedback** | `lib/taste/*`, feedback + "teach me" UI, profile API, cold-start onboarding, profile inspector, decay rules | M14 |
| **M16** | **Semantic engine v3** | embeddings adapter + cache, co-occurrence graph builder + nightly job, MMR selection, hybrid scoring, breadth/novelty sliders, eval harness & golden seeds | M15 |
| **M17** | **Playlist health, templates & sets** | health checker, repair flow + diff, scheduled health checks, template library + editor, sets & episodes, episode diff, cover composer | M16 |
| **M18** | **Autonomous runs** | scheduler, release radar, digests, budget-aware skipping, kill switch | M17 |
| **M19** | **Distribution surface** | public REST API + project keys + budgets, CLI, MCP server, webhooks, local export + taste import, embeddable widget | M17 |
| **M20** | **Offline-first & launch scale** | service worker, IndexedDB, Local mode (BYO key in browser), load test, runbook, autoscaling for cache/jobs, final copy & legal pass | M18 + M19 |

Dependency shape: `M15 → M16 → M17 → {M18, M19} → M20`. M18 and M19 can run in parallel.

### 35.2 API surface additions

| Method | Path | Purpose | Quota |
|---|---|---|---|
| GET | `/api/profile` | Taste profile snapshot + human-readable summary | 0 |
| PUT | `/api/profile` | Manual affinity adjustments (artist sliders) | 0 |
| DELETE | `/api/profile` | Reset profile (part of delete-all-my-data) | 0 |
| POST | `/api/profile/boost` | Quick like/dislike/never on an artist | 0 |
| POST | `/api/discover` | v3 discovery — accepts `engine: 'v1'\|'v2'\|'v3'`, `seedProfile`, `options` | 200–900 |
| POST | `/api/feedback/bulk` | Bulk keep/drop from an editor session | 0 |
| GET | `/api/health/:playlistId` | Playlist health report | 2 |
| POST | `/api/health/:playlistId/repair` | Apply repairs (preview diff first) | 50 × mutations |
| GET | `/api/templates` | Template library | 0 |
| POST | `/api/templates` | Save a custom template | 0 |
| GET | `/api/sets` | Playlist sets / series | 0 |
| POST | `/api/sets` | Create a set | 0 |
| GET | `/api/schedules` | Scheduled runs | 0 |
| POST | `/api/schedules` | Create a schedule | 0 |
| DELETE | `/api/schedules/:id` | Cancel a schedule | 0 |
| GET | `/api/radar` | New releases matching watchlist + taste | 2–10 |
| POST | `/api/import/taste` | Accept taste aggregates (client-side parse preferred) | 0 |
| GET | `/api/v1/*` | Public API (project-key auth, per-key budget) | metered |
| POST | `/api/v1/webhooks` | Register a webhook endpoint | 0 |

Conventions unchanged: mutating routes need a session (or a project key for `/api/v1`), every response carries `unitsSpent`, every error carries a stable `code`, all routes are rate-limited.

### 35.3 Project structure additions

```
needledrop/
├── lib/
│   ├── taste/{profile.ts,update.ts,coldstart.ts,features.ts,inspect.ts}
│   ├── embeddings/{provider.ts,cache.ts,text.ts}
│   ├── graph/{corpus.ts,build.ts,pagerank.ts,store.ts}
│   ├── scoring/{mmr.ts,caps.ts,hybrid.ts}
│   ├── health/{check.ts,repair.ts}
│   ├── templates/{schema.ts,library.ts,apply.ts}
│   ├── sets/{sets.ts,episodes.ts,diff.ts}
│   ├── tasks/{scheduler.ts,runs.ts,digest.ts,radar.ts}
│   ├── export/{m3u.ts,deeplinks.ts,widget.ts}
│   ├── cover/{compose.ts,layout.ts}
│   └── api/{keys.ts,webhooks.ts,ratelimit.ts}
├── mcp/server.ts
├── cli/index.ts
├── corpus/playlists.json        # operator-curated, individually verified playlist IDs
├── content/templates/*.json
└── content/corpus/seed-sets.json
```

**Packages this tier adds on top of `PLAN.md` §6.1** — all already in the pinned manifest:

| Need | Package |
|---|---|
| Embeddings (hosted) | `@google/genai@2.30.0` |
| Embeddings (offline fallback) | `@huggingface/transformers@4.3.1` |
| Job runner | `inngest@4.25.0` |
| Cache + rate limit | `@upstash/redis@1.39.0`, `@upstash/ratelimit@2.2.0` |
| Optional store | `@supabase/supabase-js@2.118.0` / `pg@8.23.1` |
| Schedules & timezone | `croner@10.0.1`, `rrule@2.8.1`, `@date-fns/tz@1.5.0` |
| Digests & assets | `resend@6.34.1`, `@vercel/blob@2.8.2` |
| MCP server & CLI | `@modelcontextprotocol/sdk@1.32.1`, `commander@15.0.0` |
| Cover & OG images | `sharp@0.35.5`, `satori@0.63.2`, `@resvg/resvg-js@2.6.2` |
| Offline / local mode | `@serwist/next@9.5.13`, `idb@8.0.4` |
| Virtualised lists, drag-reorder | `@tanstack/react-virtual@3.14.21`, `@dnd-kit/core` + `@dnd-kit/sortable` |
| Signed share links | `jose@6.2.13` |
| Billing (optional tier) | `stripe@23.0.0` |

### 35.4 Risk register additions

| Risk | Impact | Mitigation |
|---|---|---|
| Embeddings suggest acoustically unrelated tracks (metadata ≠ sound) | User trust collapses on one bad playlist | Label the signal in the UI; keep topic + co-occurrence weights high; A/B on golden seeds before flipping `ENGINE_VERSION` |
| Co-occurrence corpus is dominated by one curator's taste | Narrow recommendation bubble | Curate the corpus across regions/languages/eras; publish the corpus and its source list; allow user-provided playlists in the graph |
| Graph/staleness | Nightly rebuild misses same-day releases | Rebuild hourly for hot sections; freshness timestamp shown in the operator dashboard |
| Taste profile becomes a filter bubble | "This app only plays what I already like" | Anti-bubble rules (§22.4): artist weight cap, 15 % serendipity budget, `Explore`/`Popular Now` profiles, novelty slider |
| Personal data (watch history) mishandled | Regulatory + trust risk | Opt-in per data source, revocable, excluded from the default profile, deleted by the delete-my-data endpoint, documented |
| Cross-service CSV import contains sensitive data | Leak | Parse client-side by default; never log file contents; strip before upload; show exactly what will be sent |
| Public API abuse drains the shared quota | App outage | Per-key budgets, rate limits, key-level ledgers, BYO-key path, circuit breaker |
| Autonomous schedules create unwanted playlists | Annoyance, quota drain | Private by default, caps, kill switch, digest notifications, opt-in per schedule |
| Health checks + radar + schedules stack up unnoticed | Quota surprise | Global guard, per-run ledger, budget-aware skipping, operator dashboard, hard stop |
| Webhook payloads leak user data | Privacy | Signed, minimal payloads, no tokens in payloads, per-key allow-list of fields |
| Local mode misrepresented as "no backend risk" | False assurance | Banner states exactly what is stored where; OAuth token stored locally is the user's responsibility; docs are explicit |
| Embedding provider outage | Discovery blocked | Provider adapter with a local fallback (MiniLM) and a deterministic non-embedding mode (topic + graph only) |

### 35.5 Decisions needed from you (addendum)

1. **Embedding provider** — a hosted API (Gemini embeddings: best quality, per-token cost, sends metadata to a third party) or a local model (free, private, heavier deploy)? *Recommended: hosted by default with a **local fallback toggle** in settings, and a **metadata-only mode** (topic + graph) for users who refuse to send metadata anywhere.*
2. **Taste import scope** — support a specific listening-history format first, or multiple formats from day one? *Recommended: a **generic column-mapper** (the user maps their CSV columns to `artist`/`title`/`playedAt`) — one implementation, every service.*
3. **Public API at launch** — open to anyone, or request-access during the beta? *Recommended: request-access + per-key budgets; it protects the shared quota while the pool is small.*
4. **Collaboration hosting** — is the app the source of truth for pick sessions (needs a store), or should the session be purely client-side (no store)? *Recommended: **client-side first** (works without a DB, matches the stateless philosophy), server-backed only if M11's store is live.*
5. **Graph corpus ownership** — curate it ourselves, or let users contribute their playlists (opt-in, anonymised)? *Recommended: **operator-curated corpus first**; user contribution in M20 with a documented opt-in and a removal path.*
6. **Cover art** — generate in-app only (§25.4), or also offer "use as a banner image" exports for social posts? *Recommended: **in-app + social export**, since the API cannot set a YouTube thumbnail anyway.*

### 35.6 Metrics additions

| Metric | Target |
|---|---|
| Weekly returning users | ≥ 35 % (up from 25 % in §20) |
| Runs using a saved preset/template | ≥ 30 % |
| Runs where the taste profile changed the outcome | ≥ 40 % |
| Track acceptance rate (kept in editor) | ≥ 65 % |
| Artist diversity (normalized entropy) of created playlists | ≥ 0.75 |
| Health score of created playlists after 30 days | ≥ 92 |
| Health repairs applied per 100 playlists | ≥ 8 (proves the feature earns its keep) |
| Scheduled-run success rate | ≥ 95 % |
| Cache-hit rate (discovery) | ≥ 60 % (up from 40 %) |
| Quota units per created playlist | ≤ 1,200 (down from 1,600) |
| Public API requests/day (beta) | track for capacity planning |
| Discovery p95 latency (v3, incl. embeddings) | < 5 s |

---

## Appendix B — Addendum Feature → API Cost Reference

| Feature | Calls | YouTube units | Provider cost | Runs at |
|---|---|---|---|---|
| Taste profile update | — | 0 | — | every feedback event |
| Embedding a candidate set | 1–2 batch calls | 0 | 150 short texts | per discovery (cached 30 d) |
| Co-occurrence graph rebuild | 60 × `playlistItems.list` | 60 | CPU only | nightly |
| Personalized PageRank | — | 0 | CPU only | per discovery |
| MMR selection | — | 0 | CPU only | per discovery |
| Discovery v3, depth 1 | 2–4 × `search.list` + 2 × `videos.list` + 1 × `channels.list` | 200–700 | embeddings | on Discover |
| Artist catalogue harvest | `channels.list` + `playlistItems.list` | 2 | — | per artist, cached 90 d |
| Trending seeding | `videos.list?chart=mostPopular` | 1 | — | per run |
| Playlist health check | `playlistItems.list` + `videos.list` | 2 | — | nightly / on demand |
| Repair (remove k, replace m, reorder r) | `playlistItems.delete` / `insert` / `update` | 50(k+m+r) | — | on demand |
| Release radar (50 artists) | `channels.list` + `playlistItems.list` | 2 | — | per poll |
| Scheduled run | discovery + creation | ~1,500 | embeddings | per schedule |
| Taste import resolution (top 20 artists) | 20 × `search.list` | 2,000 | — | once, cached 90 d |
| Taste import resolution (user-supplied video IDs) | `videos.list` | 1 | — | per 50 ids |
| Create playlist (n tracks) | `playlists.insert` + n × `playlistItems.insert` | 50 + 50n | — | on commit |

**Rule of thumb:** embeddings add **no YouTube quota** — they add a separate provider bill that caching keeps near zero. The two biggest quota levers remain `search.list` (100 each) and `playlistItems.insert` (50 each).

---

## Appendix C — Read-Order for Implementation

1. `PLAN.md` §2–§5 (setup, session, engine v1, quota) — the foundation.
2. `PLAN.md` §17 (M1–M14) — the shipped core.
3. This addendum §22 → §24 → §25 (taste, quality, maintenance) — **the highest value per unit of work**: they make the existing engine feel personal and trustworthy.
4. This addendum §23 (semantic engine v3) — the biggest quality jump, but it needs the profile (M15) to be worth it.
5. This addendum §26–§30 (autonomy, user-data import/export, distribution, offline) — scale features; build them once the product loop is retained.
6. This addendum §34 — read this **before** writing `regions.ts`, `live.ts`, and the playlist-creation path. It contains six corrections to the original plan.
