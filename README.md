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

## Status

Pre-alpha. The plan is fully specified and versioned; the code lands in
milestones.

| Milestone | What |
|---|---|
| **M1–M6** | Core loop: seed → discover → create |
| **M7–M8** | Engine v2: canonical track identity, multi-hop, popularity prior, explainable scoring, curation controls |
| **M9–M12** | Playlist lifecycle, library, async jobs, cache, quota ledger, export, inline player |
| **M13–M14** | Platform hardening, CI/e2e/observability, OAuth verification, public launch |
| **M15–M20** | Taste profile, semantic engine v3, playlist health & auto-repair, autonomous runs, public API/CLI/MCP, offline-first local mode |

## The docs

Everything is specified before it is built:

- **[`docs/PLAN.md`](docs/PLAN.md)** — architecture, the similarity engine, quota
  model, API surface, milestones, risks, and a **pinned dependency manifest**
  (§6.1) with verified install notes.
- **[`docs/PLAN-ADDENDUM.md`](docs/PLAN-ADDENDUM.md)** — the mature tier:
  taste profiles, embeddings + co-occurrence graph, playlist health, templates,
  scheduled runs, interop, public API, offline mode, and **17 API-accuracy
  corrections** worth reading before writing a single API call.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript 6 · Tailwind CSS v4 ·
Vitest · Playwright · YouTube Data API v3

Pinned versions and the reasoning behind each one live in
[`docs/PLAN.md §6.1`](docs/PLAN.md).

## Local setup

```bash
git clone https://github.com/irgifebry/needledrop.git
cd needledrop
cp .env.example .env.local   # fill in the Google OAuth values
npm install
npm run dev
```

You need a Google Cloud project with the **YouTube Data API v3** enabled and an
OAuth client of type *Web application*. Full walkthrough:
[`docs/PLAN.md §2`](docs/PLAN.md).

## License

MIT © irgifebry
