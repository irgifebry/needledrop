'use client'

import { useEffect } from 'react'

/**
 * Resets the scroll position to the top of the page on mount, instantly.
 *
 * The app sets `scroll-behavior: smooth` globally so anchor jumps animate
 * nicely. The side effect is that a client-side navigation (or a hash that
 * no longer resolves) can animate a scroll the visitor never asked for, which
 * reads as "the page suddenly scrolled". This component undoes that on the
 * pages where the content is a fresh view rather than a continuation of the
 * previous one.
 */
export function ScrollToTop() {
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [])
  return null
}