-- NeedleDrop — optional persistence schema (PLAN §14.1, §13.8, milestone M11).
--
-- The app is designed to run with NO database at all: `lib/db/client.ts`
-- falls back to a bounded in-memory store and the API answers with
-- `"store": "memory"`. This file exists for the deployments that *want*
-- presets, blocks, feedback and run history to survive a restart or to sync
-- across devices.
--
-- Apply it by hand (or paste it into the Supabase SQL editor):
--
--   psql "$DATABASE_URL" -f lib/db/schema.sql
--
-- Two deliberate differences from the plan's SQL:
--
--   * `id` is `text`, not `uuid`. The app mints its own ids so the exact
--     same row shape works on the PostgREST path and in the in-process
--     fallback without requiring the uuid extension.
--   * `feedback` carries `anon_id`. The plan's table has no owner column,
--     but feedback must be readable per anonymous user and must be
--     deletable by the "delete all my data" endpoint (PLAN §13.11).
--
-- Nothing here stores PII. `anon_id` is a random, cookie-signed identifier;
-- `user_email` is only filled in for a user who has explicitly signed in
-- with Google, and it is nullable everywhere.

begin;

-- ── runs ────────────────────────────────────────────────────────────────────
-- One discovery run: what was generated, with which options, how much quota
-- it cost and which playlist (if any) came out. Backs the run-history view.
create table if not exists runs (
  id          text primary key,
  anon_id     text not null,
  user_email  text,
  seed_kind   text not null default 'profile'
                check (seed_kind in ('video', 'playlist', 'artist', 'profile')),
  seed_ref    text not null default '',
  seed_title  text,
  options     jsonb not null default '{}'::jsonb,
  track_count int  not null default 0,
  quota_used  int  not null default 0,
  playlist_id text,
  playlist_url text,
  status      text not null default 'complete',
  duration_ms int,
  created_at  timestamptz not null default now()
);

comment on table runs is
  'One discovery run: seed, normalised options, quota spent, resulting playlist. Backs the run history.';
comment on column runs.anon_id is
  'Opaque random id from the needledrop_anon cookie. Never an email, never logged.';
comment on column runs.user_email is
  'Filled in only after the user signs in with Google, so a signed-in user can find their own runs.';
comment on column runs.options is
  'The normalised DiscoveryOptions the run executed with.';
comment on column runs.quota_used is
  'YouTube Data API units spent by this run.';
comment on column runs.status is
  'complete | failed | partial — the outcome rendered in the history list.';
comment on column runs.duration_ms is
  'Wall-clock duration of the run in milliseconds.';

-- ── presets ─────────────────────────────────────────────────────────────────
-- Named saved configurations ("Focus · 25 tracks · 2015-2025 · no live").
create table if not exists presets (
  id         text primary key,
  anon_id    text not null,
  name       text not null,
  options    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (anon_id, name)
);

comment on table presets is
  'Saved discovery configurations, scoped to an anonymous id. One row per (anon_id, name).';
comment on column presets.name is
  'Human label chosen by the user, 1-60 characters.';
comment on column presets.options is
  'The DiscoveryOptions to re-apply when the preset is picked.';

-- ── blocks ──────────────────────────────────────────────────────────────────
-- Blocked artists, keywords and individual videos. Applied during discovery
-- so a user never sees the same unwanted track twice.
create table if not exists blocks (
  id         text primary key,
  anon_id    text not null,
  kind       text not null check (kind in ('artist', 'keyword', 'video_id')),
  value      text not null,
  created_at timestamptz not null default now(),
  unique (anon_id, kind, value)
);

comment on table blocks is
  'Blocked artists / keywords / video ids, scoped to an anonymous id.';
comment on column blocks.kind is
  'artist | keyword | video_id — how the value is matched during discovery.';
comment on column blocks.value is
  'The blocked value. Artists and keywords are stored lower-cased so the match is case-insensitive.';

-- ── feedback ────────────────────────────────────────────────────────────────
-- Per-track keep/drop signal. This is the data the ranking loop learns from.
create table if not exists feedback (
  id         text primary key,
  anon_id    text not null,
  run_id     text references runs (id) on delete cascade,
  video_id   text not null,
  verdict    text not null check (verdict in ('keep', 'drop')),
  reason     text,
  created_at timestamptz not null default now()
);

comment on table feedback is
  'Per-track keep/drop signals, scoped to an anonymous id. run_id links back to runs when there was one.';
comment on column feedback.verdict is
  'keep | drop — the user''s decision about this track.';
comment on column feedback.reason is
  'Optional free-text reason ("too slow", "same song"). Never required.';

-- ── quota_ledger ────────────────────────────────────────────────────────────
-- Append-only accounting of every unit spent, for the operator dashboard.
create table if not exists quota_ledger (
  id         text primary key default gen_random_uuid()::text,
  anon_id    text,
  operation  text not null,
  units      int  not null default 0,
  run_id     text references runs (id) on delete set null,
  cached     boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table quota_ledger is
  'Append-only ledger of YouTube Data API units spent, so the quota dashboard can be reconstructed.';
comment on column quota_ledger.cached is
  'True when the call was served from cache and therefore cost no units upstream.';

-- ── indexes ─────────────────────────────────────────────────────────────────
create index if not exists runs_anon_created_idx   on runs (anon_id, created_at desc);
create index if not exists quota_ledger_created_idx on quota_ledger (created_at);
create index if not exists presets_anon_idx        on presets (anon_id);
create index if not exists blocks_anon_idx         on blocks (anon_id);
create index if not exists feedback_anon_created_idx on feedback (anon_id, created_at desc);

commit;
