/**
 * Stable error codes (PLAN §13.9, §15).
 *
 * Every failing route returns one of these strings so the UI can render
 * per-code copy ("quotaExceeded" says something different from "network")
 * instead of a generic apology.
 */

export const ERROR_CODES = [
  'invalid_request',
  'unauthorized',
  'auth_required',
  'auth_expired',
  'oauth_not_configured',
  'forbidden',
  'not_found',
  'rate_limited',
  'quota_exceeded',
  'upstream_error',
  'upstream_unavailable',
  'network',
  'no_results',
  'private_video',
  'deleted_video',
  'region_blocked',
  'conflict',
  'playlist_failed',
  'unsupported_media',
  'demo_mode',
  'internal_error',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

/** An error that already knows how it should be reported to the client. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status = 400,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}

/** HTTP status that best matches a code, used when a caller only has the code. */
export function statusForCode(code: ErrorCode): number {
  switch (code) {
    case 'invalid_request':
      return 400
    case 'unauthorized':
    case 'auth_required':
    case 'auth_expired':
      return 401
    case 'oauth_not_configured':
      return 503
    case 'forbidden':
      return 403
    case 'not_found':
      return 404
    case 'conflict':
      return 409
    case 'rate_limited':
      return 429
    case 'quota_exceeded':
      return 429
    case 'private_video':
    case 'deleted_video':
    case 'region_blocked':
      return 404
    case 'upstream_unavailable':
    case 'network':
      return 503
    default:
      return 502
  }
}
