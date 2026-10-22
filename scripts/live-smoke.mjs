#!/usr/bin/env node
/**
 * Live API smoke test (PLAN §13.10 — "Integration: nightly CI job, real API,
 * budgeted to ≤ 500 units/run").
 *
 * Deliberately plain JavaScript with no dependencies and no transpiler: it
 * talks to the Data API with `fetch` and nothing else, so it can run in CI
 * with nothing installed but Node.
 *
 * Budget: one `search.list` (100 units) + one `videos.list` (1 unit) =
 * 101 units per run.
 *
 * Usage:
 *   YOUTUBE_API_KEY=... node scripts/live-smoke.mjs
 *   RUN_LIVE_TESTS=1 npm run test:live
 */

const API = 'https://www.googleapis.com/youtube/v3'
const QUERY = 'daft punk one more time'
const EXPECTED_CATEGORY = '10'

function fail(message) {
  console.error(`\n✗ ${message}\n`)
  process.exit(1)
}

function pass(message) {
  console.log(`✓ ${message}`)
}

const key = process.env.YOUTUBE_API_KEY
if (!key) {
  console.log('YOUTUBE_API_KEY is not set — nothing to smoke test.')
  process.exit(0)
}

const startedAt = Date.now()

console.log(`\nLive smoke test against the YouTube Data API\n`)

// 1. search.list — 100 units
const searchUrl = `${API}/search?part=snippet&type=video&videoCategoryId=${EXPECTED_CATEGORY}&maxResults=3&q=${encodeURIComponent(QUERY)}&key=${key}`

const searchResponse = await fetch(searchUrl, { cache: 'no-store' })
if (!searchResponse.ok) {
  const detail = await searchResponse.text()
  fail(`search.list responded ${searchResponse.status}\n${detail.slice(0, 400)}`)
}

const search = await searchResponse.json()
const ids = (search.items ?? [])
  .map((item) => item.id?.videoId)
  .filter(Boolean)

if (ids.length === 0) fail('search.list returned no video ids')
pass(`search.list returned ${ids.length} video ids`)

// 2. videos.list — 1 unit
const videosUrl = `${API}/videos?part=snippet,topicDetails,contentDetails,statistics,status&id=${ids.join(',')}&key=${key}`
const videosResponse = await fetch(videosUrl, { cache: 'no-store' })
if (!videosResponse.ok) {
  const detail = await videosResponse.text()
  fail(`videos.list responded ${videosResponse.status}\n${detail.slice(0, 400)}`)
}

const videos = await videosResponse.json()
const items = videos.items ?? []
if (items.length === 0) fail('videos.list returned no items')
pass(`videos.list returned ${items.length} hydrated items`)

// 3. The field names the engine depends on must still exist. Field-name drift
//    is the most likely cause of a silent discovery regression
//    (PLAN-ADDENDUM §34), so the contract is asserted, not assumed.
const first = items[0]
const required = {
  'id': first.id,
  'snippet.title': first.snippet?.title,
  'snippet.channelTitle': first.snippet?.channelTitle,
  'snippet.channelId': first.snippet?.channelId,
  'snippet.categoryId': first.snippet?.categoryId,
  'contentDetails.duration': first.contentDetails?.duration,
  'statistics.viewCount': first.statistics?.viewCount,
}
for (const [field, value] of Object.entries(required)) {
  if (value === undefined || value === null || value === '') {
    fail(`the hydrated item is missing ${field} — the field names have drifted`)
  }
}
pass('every field the engine reads is present')

if (first.snippet?.categoryId !== EXPECTED_CATEGORY) {
  fail(`expected a music category (${EXPECTED_CATEGORY}), got ${first.snippet?.categoryId}`)
}
pass('the music category filter holds')

// 4. The ISO-8601 duration must parse.
const duration = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(first.contentDetails?.duration ?? '')
if (!duration) fail(`contentDetails.duration is not ISO-8601: ${first.contentDetails?.duration}`)
pass(`contentDetails.duration parses (${first.contentDetails.duration})`)

console.log(
  `\nSmoke test passed in ${Date.now() - startedAt}ms. Cost: ~101 units of the daily 10,000.\n`,
)
