import { NextResponse } from 'next/server'

import { env, envIssues, hasDatabase, hasInngest, hasJobs, hasLiveApi, hasOAuth, hasRedis, isProduction } from '@/lib/env'
import { flagSnapshot } from '@/features/flags'
import { logger } from '@/lib/observability/logger'
import { snapshot } from '@/lib/observability/metrics'

/**
 * Liveness + configuration report (PLAN §15, §13.10).
 *
 * Unauthenticated by design — it is what an uptime check hits.
 *
 * The important distinction: **a missing credential is not a failure.**
 * Demo mode and "OAuth not configured" are supported states, so the endpoint
 * answers 200 and reports them as *configuration*, not as broken checks. Only
 * a genuine inability to serve requests (the upstream probe) turns the
 * status into 503 — and even that only happens on `?deep=1`, because
 * probing the upstream spends quota.
 *
 * The response never contains a secret, and it never spends quota unless
 * asked to.
 */

export const dynamic = 'force-dynamic'

const PROBE_VIDEO_ID = 'dQw4w9WgXcQ'

type Configuration = { name: string; enabled: boolean; detail: string }

type Check = { name: string; ok: boolean; detail: string }

async function upstreamCheck(): Promise<Check> {
  if (!hasLiveApi()) {
    return { name: 'youtube', ok: true, detail: 'demo catalogue — the upstream was not contacted' }
  }

  try {
    const key = process.env.YOUTUBE_API_KEY ?? process.env.NEXT_PUBLIC_YOUTUBE_API_KEY ?? ''
    const url = `https://www.googleapis.com/youtube/v3/videos?part=id&id=${PROBE_VIDEO_ID}&key=${key}`
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(5000) })
    if (response.status === 403) {
      return { name: 'youtube', ok: false, detail: 'the API key was rejected (403)' }
    }
    if (!response.ok) {
      return { name: 'youtube', ok: false, detail: `upstream responded ${response.status}` }
    }
    return { name: 'youtube', ok: true, detail: 'reachable' }
  } catch (error) {
    return {
      name: 'youtube',
      ok: false,
      detail: error instanceof Error ? error.message : 'unreachable',
    }
  }
}

export async function GET(request: Request) {
  const deep = new URL(request.url).searchParams.get('deep') === '1'
  const startedAt = Date.now()

  const configuration: Configuration[] = [
    {
      name: 'live-api',
      enabled: hasLiveApi(),
      detail: hasLiveApi() ? 'the YouTube Data API is live' : 'demo catalogue — no API key configured',
    },
    {
      name: 'oauth',
      enabled: hasOAuth(),
      detail: hasOAuth() ? 'Google sign-in is available' : 'sign-in is disabled — discovery still works',
    },
    {
      name: 'cache',
      enabled: true,
      detail: hasRedis() ? 'redis' : 'in-process',
    },
    {
      name: 'store',
      enabled: true,
      detail: hasDatabase() ? 'postgres' : 'in-memory',
    },
    {
      name: 'jobs',
      enabled: hasJobs(),
      detail: hasJobs() ? (hasInngest() ? 'inngest' : 'in-process') : 'disabled',
    },
  ]

  const checks: Check[] = []
  if (deep) checks.push(await upstreamCheck())

  const failed = checks.some((check) => !check.ok)
  const issues = envIssues()

  logger.info('health', { failed, deep, durationMs: Date.now() - startedAt })

  return NextResponse.json(
    {
      status: failed ? 'degraded' : 'ok',
      degraded: issues.length > 0,
      uptimeSec: Math.round(process.uptime()),
      version: process.env.npm_package_version ?? '0.1.0',
      environment: env().NODE_ENV,
      production: isProduction(),
      flags: flagSnapshot(),
      configuration,
      checks,
      issues: issues.map((issue) => ({ key: issue.key, message: issue.message })),
      metrics: snapshot(),
    },
    {
      status: failed ? 503 : 200,
      headers: { 'Cache-Control': 'no-store' },
    },
  )
}
