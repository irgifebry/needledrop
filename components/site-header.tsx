'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'

const LINKS = [
  { href: '#how', label: 'How it works' },
  { href: '#why', label: 'Why it works' },
  { href: '#faq', label: 'FAQ' },
]

// Persist the session across client-side navigations so the sign-in/sign-out
// button does not flash back to "Sign in with Google" while the session is
// being re-fetched on every page mount. Stored on `window` (not a module-level
// variable) so it survives route changes even when the component remounts.
type CachedSession = { user: { name: string; email: string } | null; configured: boolean }
function readCachedSession(): CachedSession | null {
  if (typeof window === 'undefined') return null
  return (window as unknown as { __needledrop_session__?: CachedSession | null }).__needledrop_session__ ?? null
}
function writeCachedSession(value: CachedSession) {
  if (typeof window === 'undefined') return
  ;(window as unknown as { __needledrop_session__?: CachedSession | null }).__needledrop_session__ = value
}

export function SiteHeader({ initialUser = null }: { initialUser?: { name: string; email: string } | null }) {
  const pathname = usePathname()
  const onHome = pathname === '/'
  const [chapter, setChapter] = useState('orange')
  const cached = readCachedSession()
  const [user, setUser] = useState<{ name: string; email: string } | null>(
    () => initialUser ?? cached?.user ?? null,
  )
  const [configured, setConfigured] = useState(() => cached?.configured ?? true)
  const headerRef = useRef<HTMLElement>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/session')
      .then((response) => response.json())
      .then((data: { signedIn: boolean; user: { name: string; email: string } | null; configured: boolean }) => {
        if (cancelled) return
        setUser(data.user)
        setConfigured(data.configured)
        writeCachedSession({ user: data.user, configured: data.configured })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  // Colour by chapter: the header takes the ink of the field beneath it.
  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      const sections = Array.from(
        document.querySelectorAll<HTMLElement>('[data-chapter]:not(html):not(body)'),
      ).filter((element) => element.getBoundingClientRect().height > 40)
      // Probe just under the bar, not inside it. The bar is opaque, so the
      // field at its own centre is hidden; the field the visitor can see
      // below it is the one the bar should carry.
      const probe = (headerRef.current?.getBoundingClientRect().bottom ?? 36) + 2
      let current = sections[0]?.dataset.chapter ?? 'orange'
      for (const section of sections) {
        const rect = section.getBoundingClientRect()
        if (rect.top <= probe && rect.bottom > probe) {
          current = section.dataset.chapter ?? current
          break
        }
      }
      setChapter(current)
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.chapter = chapter
  }, [chapter])

  function signIn() {
    if (!configured) {
      toast(
        'Google OAuth is not configured on this deployment yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.local.',
        { description: 'Everything else on this page works without it.' },
      )
      return
    }
    // A full navigation, not a client-side route change: the OAuth consent
    // screen lives on another origin and the callback returns here. The
    // Next.js rule wants `router.push()` for in-app navigation, which would
    // break the consent round-trip, so it is disabled for this line only.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = '/api/auth/google'
  }

  return (
    <header
      ref={headerRef}
      className={cn(
        'fixed inset-x-0 top-0 z-40 flex items-center justify-between gap-6 border-b-2 px-[var(--gutter)] py-4',
        'border-[var(--header-ink)] bg-[var(--header-bg)] text-[var(--header-ink)] transition-colors duration-300',
      )}
    >
      <a
        href={onHome ? '#top' : '/'}
        className="font-display text-2xl uppercase leading-none tracking-tight text-[var(--header-ink)]"
      >
        needledrop
      </a>

      <nav className="hidden items-center gap-7 md:flex">
        {LINKS.map((link) => (
          <a
            key={link.href}
            href={onHome ? link.href : `/${link.href}`}
            className="t-small font-semibold text-[var(--header-ink)] opacity-80 transition-opacity hover:opacity-100"
          >
            {link.label}
          </a>
        ))}
        <Link
          href="/library"
          className="t-small font-semibold text-[var(--header-ink)] opacity-80 transition-opacity hover:opacity-100"
        >
          Library
        </Link>
        <Link
          href="/settings"
          className="t-small font-semibold text-[var(--header-ink)] opacity-80 transition-opacity hover:opacity-100"
        >
          Settings
        </Link>
      </nav>

      {user ? (
        /*
         * A form, not a link. Signing out revokes a token and clears a
         * session, and a GET would let a prefetcher or a crawler trigger it
         * without the user meaning to — so the route is POST-only and the
         * header posts to it. The form works without JavaScript, and the
         * 303 the route answers with brings the browser back with a GET.
         */
        <form action="/api/auth/logout" method="post">
          <button
            type="submit"
            className="appearance-none whitespace-nowrap border-2 border-[var(--header-ink)] bg-transparent px-3 py-2 font-sans t-small font-semibold text-[var(--header-ink)] transition-colors hover:bg-[var(--header-ink)] hover:text-[var(--header-bg)] sm:px-4"
          >
            {user.name.split(' ')[0]} · Sign out
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={signIn}
          className="whitespace-nowrap border-2 border-[var(--header-ink)] px-3 py-2 t-small font-semibold text-[var(--header-ink)] transition-colors hover:bg-[var(--header-ink)] hover:text-[var(--header-bg)] sm:px-4"
        >
          Sign in with Google
        </button>
      )}
    </header>
  )
}
