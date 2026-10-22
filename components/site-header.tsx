'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'

const LINKS = [
  { href: '#how', label: 'How it works' },
  { href: '#why', label: 'Why it works' },
  { href: '#faq', label: 'FAQ' },
]

export function SiteHeader() {
  const [chapter, setChapter] = useState('orange')
  const [user, setUser] = useState<{ name: string; email: string } | null>(null)
  const [configured, setConfigured] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/session')
      .then((response) => response.json())
      .then((data: { signedIn: boolean; user: { name: string; email: string } | null; configured: boolean }) => {
        if (cancelled) return
        setUser(data.user)
        setConfigured(data.configured)
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
      const probe = 36
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
      className={cn(
        'fixed inset-x-0 top-0 z-40 flex items-center justify-between gap-6 px-[var(--gutter)] py-4',
        'transition-colors duration-300',
      )}
      style={{ color: 'var(--header-ink)' }}
    >
      <a
        href="#top"
        className="font-display text-2xl uppercase leading-none tracking-tight"
        style={{ color: 'var(--header-ink)' }}
      >
        needledrop
      </a>

      <nav className="hidden items-center gap-7 md:flex">
        {LINKS.map((link) => (
          <a
            key={link.href}
            href={link.href}
            className="t-small font-semibold opacity-80 transition-opacity hover:opacity-100"
            style={{ color: 'var(--header-ink)' }}
          >
            {link.label}
          </a>
        ))}
      </nav>

      {user ? (
        <a
          href="/api/auth/logout"
          className="border-2 px-4 py-2 t-small font-semibold transition-colors hover:bg-current hover:text-ink"
          style={{ borderColor: 'var(--header-ink)', color: 'var(--header-ink)' }}
        >
          {user.name.split(' ')[0]} · Sign out
        </a>
      ) : (
        <button
          type="button"
          onClick={signIn}
          className="border-2 px-4 py-2 t-small font-semibold transition-colors hover:bg-current hover:text-ink"
          style={{ borderColor: 'var(--header-ink)', color: 'var(--header-ink)' }}
        >
          Sign in with Google
        </button>
      )}
    </header>
  )
}
