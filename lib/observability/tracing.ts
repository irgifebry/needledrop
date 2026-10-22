import { logger } from './logger'

/**
 * Minimal tracing (PLAN §13.10).
 *
 * The plan calls for OpenTelemetry spans around every upstream API call. The
 * OTel SDK is not installed, and adding it for a pre-alpha would be a heavy
 * dependency, so this is a dependency-free stand-in: a span is a timer with
 * named attributes that emits one structured log line when it ends.
 *
 * The shape matches what an OTel exporter would consume (name, duration,
 * attributes, status), so swapping in the real SDK later is a change of
 * implementation, not of call sites.
 */

export type SpanStatus = 'ok' | 'error'

export type SpanAttributes = Record<string, string | number | boolean | undefined>

export type Span = {
  name: string
  attributes: SpanAttributes
  setAttribute: (key: string, value: string | number | boolean | undefined) => void
  setError: (error: unknown) => void
  end: () => void
}

const SPAN_THRESHOLD_MS = 50

/** Start a span. The returned span must be ended by the caller. */
export function startSpan(name: string, attributes: SpanAttributes = {}): Span {
  const startedAt = Date.now()
  const attrs: SpanAttributes = { ...attributes }
  let status: SpanStatus = 'ok'
  let error: unknown

  return {
    name,
    attributes: attrs,
    setAttribute(key, value) {
      attrs[key] = value
    },
    setError(caught) {
      status = 'error'
      error = caught
    },
    end() {
      const durationMs = Date.now() - startedAt
      // Fast spans are noise; only slow or failed ones are worth a line.
      if (status === 'ok' && durationMs < SPAN_THRESHOLD_MS) return
      logger.info(`span ${name}`, {
        span: name,
        status,
        durationMs,
        ...attrs,
        ...(status === 'error' ? { error } : {}),
      })
    },
  }
}

/** Run `fn` inside a span, ending the span even when it throws. */
export async function withSpan<T>(
  name: string,
  attributes: SpanAttributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const span = startSpan(name, attributes)
  try {
    const result = await fn(span)
    span.end()
    return result
  } catch (error) {
    span.setError(error)
    span.end()
    throw error
  }
}
