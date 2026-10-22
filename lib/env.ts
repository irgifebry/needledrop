import { z } from 'zod'

/**
 * Environment validation (PLAN §13.10, §6.2).
 *
 * The app must boot with **zero** configuration — no API key, no OAuth
 * client, no database — and simply run in demo mode. So validation never
 * throws at import time; it is lazy and reports problems instead of
 * exploding. In production the handful of secrets that are genuinely required
 * are escalated to hard failures.
 */

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /** Shared-project YouTube Data API key. Absent ⇒ demo catalogue. */
  YOUTUBE_API_KEY: z.string().min(1).optional(),
  /** Per-user BYO key (encrypted in the session cookie). */
  NEXT_PUBLIC_YOUTUBE_API_KEY: z.string().min(1).optional(),

  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  /** 32+ chars. Used to derive the AES-256-GCM session key. */
  SESSION_SECRET: z.string().min(32).optional(),
  NEXT_PUBLIC_APP_URL: z.string().default('http://localhost:3000'),

  /** Optional Postgres store (runs / presets / blocks / feedback). */
  DATABASE_URL: z.string().min(1).optional(),
  /** Optional Redis (REST) cache. */
  UPSTASH_REDIS_REST_URL: z.url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
  /** Optional durable job runner. */
  INNGEST_EVENT_KEY: z.string().min(1).optional(),
  INNGEST_SIGNING_KEY: z.string().min(1).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),

  /** Feature flags (PLAN §13.10). */
  ENGINE_VERSION: z.enum(['v1', 'v2']).default('v2'),
  DISCOVERY_DEPTH: z.coerce.number().int().min(1).max(2).default(2),
  CACHE_ENABLED: z.enum(['true', 'false']).default('true'),
  JOBS_ENABLED: z.enum(['true', 'false']).default('true'),
  PERSISTENCE_ENABLED: z.enum(['true', 'false']).default('true'),

  /** Quota governance (PLAN §13.7). */
  DAILY_QUOTA: z.coerce.number().int().positive().default(10_000),
  /** Global ceiling, kept below the project quota on purpose. */
  GLOBAL_DAILY_CAP: z.coerce.number().int().positive().default(9_000),
  /** Soft per-session budget. */
  SESSION_DAILY_BUDGET: z.coerce.number().int().positive().default(3_000),
  /** Requests per window, per IP, per route scope. */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(30),
})

export type Env = z.infer<typeof EnvSchema>

let cached: Env | null = null

function rawEnv(): Record<string, string | undefined> {
  return {
    NODE_ENV: process.env.NODE_ENV,
    YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY,
    NEXT_PUBLIC_YOUTUBE_API_KEY: process.env.NEXT_PUBLIC_YOUTUBE_API_KEY,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    SESSION_SECRET: process.env.SESSION_SECRET,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    DATABASE_URL: process.env.DATABASE_URL,
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
    INNGEST_EVENT_KEY: process.env.INNGEST_EVENT_KEY,
    INNGEST_SIGNING_KEY: process.env.INNGEST_SIGNING_KEY,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    ENGINE_VERSION: process.env.ENGINE_VERSION,
    DISCOVERY_DEPTH: process.env.DISCOVERY_DEPTH,
    CACHE_ENABLED: process.env.CACHE_ENABLED,
    JOBS_ENABLED: process.env.JOBS_ENABLED,
    PERSISTENCE_ENABLED: process.env.PERSISTENCE_ENABLED,
    DAILY_QUOTA: process.env.DAILY_QUOTA,
    GLOBAL_DAILY_CAP: process.env.GLOBAL_DAILY_CAP,
    SESSION_DAILY_BUDGET: process.env.SESSION_DAILY_BUDGET,
    RATE_LIMIT_PER_MINUTE: process.env.RATE_LIMIT_PER_MINUTE,
  }
}

/** Parsed, cached environment. Invalid values are dropped, never fatal. */
export function env(): Env {
  if (cached) return cached
  const parsed = EnvSchema.safeParse(rawEnv())
  cached = parsed.success ? parsed.data : EnvSchema.parse({ NODE_ENV: rawEnv().NODE_ENV })
  return cached
}

/** Test seam — resets the memoised parse. */
export function resetEnv(): void {
  cached = null
}

export function isProduction(): boolean {
  return env().NODE_ENV === 'production'
}

export function hasLiveApi(): boolean {
  return Boolean(env().YOUTUBE_API_KEY || env().NEXT_PUBLIC_YOUTUBE_API_KEY)
}

export function hasOAuth(): boolean {
  const value = env()
  return Boolean(value.GOOGLE_CLIENT_ID && value.GOOGLE_CLIENT_SECRET)
}

export function hasDatabase(): boolean {
  return env().PERSISTENCE_ENABLED === 'true' && Boolean(env().DATABASE_URL)
}

export function hasRedis(): boolean {
  return env().CACHE_ENABLED === 'true' && Boolean(env().UPSTASH_REDIS_REST_URL)
}

export function hasJobs(): boolean {
  return env().JOBS_ENABLED === 'true'
}

export function hasInngest(): boolean {
  return Boolean(env().INNGEST_EVENT_KEY && env().INNGEST_SIGNING_KEY)
}

export type EnvIssue = { key: string; message: string }

/**
 * Configuration problems worth surfacing. In production a missing
 * `SESSION_SECRET` or OAuth client is fatal — the app would silently run in a
 * broken half-authenticated state otherwise.
 */
export function envIssues(): EnvIssue[] {
  const issues: EnvIssue[] = []
  const value = env()

  if (!value.SESSION_SECRET) {
    issues.push({
      key: 'SESSION_SECRET',
      message: 'SESSION_SECRET is unset — the session cookie cannot be encrypted.',
    })
  }
  if (!value.GOOGLE_CLIENT_ID || !value.GOOGLE_CLIENT_SECRET) {
    issues.push({
      key: 'GOOGLE_CLIENT_ID',
      message: 'Google OAuth is not configured — sign-in and playlist creation are disabled.',
    })
  }
  if (!value.YOUTUBE_API_KEY) {
    issues.push({
      key: 'YOUTUBE_API_KEY',
      message: 'YOUTUBE_API_KEY is unset — the app serves the offline demo catalogue.',
    })
  }
  return issues
}

/** Throws when the deployment is missing something it cannot run without. */
export function assertEnv(): void {
  if (!isProduction()) return
  const fatal = envIssues().filter((issue) => issue.key !== 'YOUTUBE_API_KEY')
  if (fatal.length === 0) return
  throw new Error(
    `Invalid environment:\n${fatal.map((issue) => `  - ${issue.key}: ${issue.message}`).join('\n')}`,
  )
}
