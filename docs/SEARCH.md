# The search: what the API gives, what it cannot, and what was measured

Everything here was measured against the live API, not recalled. The
numbers are the baseline the search fix is judged against.

## 1. What the Data API cannot do

**There is no "original audio" parameter.** Nothing in `search.list` says
"only music recordings". The closest is `videoCategoryId=10` ("Music"),
and that is the *uploader's* choice of category, not a fact about the
content. The Music category holds auto-generated artist tracks, official
music videos, VEVO uploads, hour-long radio streams, DJ mixes,
karaoke and reaction videos, all side by side.

**There is no "is original audio" flag anywhere in the schema.** The
`Video` resource has no such property, and `Channel` has no
"auto-generated" flag either. The only way to tell a recording from an
upload is to infer it from the fields the API does return:

| Signal | What it tells you | How well it works |
|---|---|---|
| `snippet.channelTitle` ends in `" - Topic"` | an auto-generated artist channel — the artist's own recording | the strongest single signal |
| `contentDetails.duration` | a recording is 3–7 minutes; a mix or radio stream is 25–370 | the strongest filter, and the one the fix uses |
| `snippet.liveBroadcastContent` | `live` / `upcoming` / `none` | exact, and livestreams also report `"P0D"` |
| `topicDetails.topicCategories[]` | the genre, as Wikipedia URLs | coarse, multi-label, sometimes missing |
| `snippet.tags[]` | artist, album, title | does **not** distinguish audio from video — a VEVO video and its audio twin carry the same tags |
| `status.license` | `youtube` or `creativeCommon` | useless: every sampled track was `youtube` |
| `snippet.categoryId` | the uploader's category | `10` only says the uploader chose Music |

Two fields that look usable and are not:

- **`topicDetails.topicId` does not exist.** The property is
  `topicIds[]` (an array) and it, together with `relevantTopicIds[]`, was
  deprecated in 2016 and now comes back **null on every video**. The
  live taxonomy is `topicCategories[]` only. The app's `Track.topicId`
  field is therefore always empty — `trackFromVideo` writes
  `item.topicDetails?.topicId ?? ''`, which is `''` forever.
- **`"Official Audio"` is in the title, not in the tags.** A VEVO video
  and its audio upload carry identical tags, so tags cannot separate them.

## 2. The genre taxonomies that exist

Exactly two, and neither is a free-text genre name:

1. **`search.list?topicId=`** — 15 curated music buckets, frozen in 2017
   and built on the deprecated Freebase ids. Verified live:

   | Genre | topicId | | Genre | topicId |
   |---|---|---|---|---|
   | Music | `/m/04rlf` | | Jazz | `/m/03_d0` |
   | Pop music | `/m/064t9` | | Rock music | `/m/06by7` |
   | Hip hop music | `/m/0glt670` | | Soul music | `/m/0gywn` |
   | Electronic music | `/m/02lkt` | | Independent music | `/m/05rwpb` |
   | Classical music | `/m/0ggq0m` | | Country | `/m/01lyv` |
   | Christian music | `/m/02mscn` | | Reggae | `/m/06cqb` |
   | Rhythm and blues | `/m/06j6l` | | Music of Asia | `/m/028sqc` |
   | Music of Latin America | `/m/0g293` | | | |

   **There is no "city pop" and no "lofi".** And the famous Freebase ids
   are a trap: `/m/028sqc` is Music of Asia, not Jazz. A wrong id is
   **silently accepted and ignored** — the response comes back
   unfiltered, with no error — so a mistake is a silent relevance
   regression rather than a failure.

2. **`videos.list(part=topicDetails).topicCategories[]`** — Wikipedia
   URLs, one video at a time. The only live taxonomy, and what the
   client-side genre matching works on.

`videoCategories.list` returns 31–32 categories, of which **exactly one
is music** (`10`). There is no hierarchy and no genre attribute, so
mapping a free-text genre onto a `videoCategoryId` is not possible.

## 3. What was measured

The search, before the fix. `maxResults=8`, `videoCategoryId=10`, and
nothing else:

| Query | real tracks (≤ 12 min, not live) | with `videoDuration=medium` |
|---|---|---|
| city pop | 2 / 25 | **25 / 25** |
| jazz | 1 / 25 | **24 / 25** |
| lofi hip hop | 0 / 25 | 9 / 25 |
| rock | 15 / 25 | **25 / 25** |
| pink floyd | 18 / 25 | 21 / 25 |

`videoDuration=medium` is 4–20 minutes. It is a **server-side** filter
and it costs nothing: a search is charged 100 units per *request*, not
per result, so a wider page is free. `short` (< 4 minutes) is wrong for
music — a jazz standard runs 8–10 minutes.

Why the client-side filter is still needed: `medium` admits 11–20 minute
radio segments, and the sources that feed discovery — related videos,
artist radio, topic expansion — have no server-side filter at all.

## 4. The next refinement, and why it is not in yet

`topicId` can be combined with `q`. The documentation says **nothing**
about the combination — not that it works, not that it conflicts — but it
is applied on top of the text query, and the historic official sample
code sets both on one request.

So the genre search could be constrained server-side, with the 15 curated
buckets above, and the client-side ranking would only have to catch what
the taxonomy misses ("city pop", "lofi"). It is free.

**It is not in yet, for two reasons.**

1. **It cannot be measured right now.** The day's search quota is gone
   (see §5), so a change to the query could not be compared against the
   current behaviour on real data.
2. **The failure mode is silent.** An unsupported id is accepted and
   ignored, so a mistake in the map shows up as "the filter stopped
   working" and nothing else. It needs a self-test — one that asserts
   each id still returns topic-filtered results, and that an unknown id
   returns unfiltered ones, so the difference is visible.

If it is added, it must be wrapped: on an empty topic-filtered result
set, retry without `topicId` and fall back to the client-side ranking.
The taxonomy is frozen in 2017 and the behaviour is undocumented, so
neither of those is a promise the API makes.

## 5. The quota ceiling

**`search.list` is capped at 100 calls per day**, independent of the
10,000-unit project quota — each call costs 100 units, so the two are the
same number seen twice. `videos.list` is 1 unit per call and is **not**
part of the search cap, which is why the `chart` source is so cheap.

That makes the deployment's ceiling hard:

| What | Units | Runs per day |
|---|---|---|
| a search (`/api/search`) | 101 | ~99 |
| a discovery run, depth 1 | 202 | ~49 |
| a discovery run, depth 2 | 400 | ~25 |

**Every one of those runs is for the whole deployment, not per user.**

Three things follow, and all three are now implemented:

- **the search is cached.** Every read — `/api/search`, `/api/resolve` and
  the discovery pipeline — goes through the cache, so a seed two visitors
  type in the same afternoon is paid for once, not twice. Before this,
  `/api/search` and `/api/resolve` called the API directly and spent 100
  units on every request, however often the same query was repeated.
- **the `BYO key` the FAQ promises is implemented.** `POST /api/keys`
  verifies a key with a one-unit `videos.list` probe — never a search — and
  stores it encrypted in that browser's cookie. Every search it pays for
  comes out of the visitor's own Google Cloud project, so their traffic
  does not eat the shared budget. This is the thing that makes the product
  usable at any scale.
- **the failure reads like a limit, not a bug.** The API answers an
  exhausted search bucket with a 429 whose reason is `rateLimitExceeded`,
  not `quotaExceeded` — the same reason a per-minute throttle uses. Every
  check in the codebase used to ask for `quotaExceeded`, so none of them
  matched, and the failure surfaced as a 502 carrying a raw Google
  sentence. The reason is now normalised at the boundary, and the visitor
  gets a 429 that names the midnight-Pacific-Time reset.

What is deliberately **not** done: spreading the app's own load over
several Google Cloud projects to multiply the quota. That is a
quota-circumvention pattern, and the shared key is meant to be a shared
budget, not a private one.

## 6. The other half: what discovery does with the seed

The seed picker was the visible half. The discovery pipeline behind it
turns one seed into twenty tracks, and it has its own arithmetic:

- the **genre** signal works: 19 of 20 candidates share the seed's
  categories.
- the **artist** signal cannot: `maxPerArtist` is 2 by default, so an
  artist seed contributes at most two tracks however many of its own
  recordings are in the pool. That is the diversity cap doing its job,
  not a bug — but it means an artist query and a discovery query are
  different products, and the app only offers the second one.
- the **trending chart** contributes 50 region-popular tracks with no
  regard for the seed, which is where the off-genre mainstream pop in
  the results comes from.
- the **topic** signal — the strongest one, worth 40 points — never
  fires, because it is keyed on `topicId`, which is always empty (§1).

The last one is the cheapest to fix and the highest value: the signal
is already computed from `topicCategories`, and the topic *id* it used to
be keyed on no longer exists.
