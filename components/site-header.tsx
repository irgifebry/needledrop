'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Menu, X } from 'lucide-react'

import { cn } from '@/lib/utils'

// Home-page section anchors used by footer links: #top #how #why #faq



export function SiteHeader() {
  const pathname = usePathname()
  const onHome = pathname === '/'
  const [chapter, setChapter] = useState('orange')
  const [menuOpen, setMenuOpen] = useState(false)
  const headerRef = useRef<HTMLElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!menuOpen) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setMenuOpen(false)
      menuButtonRef.current?.focus()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [menuOpen])

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

  return (
    <header
      ref={headerRef}
      className={cn(
        'fixed inset-x-0 top-0 z-40 flex flex-wrap items-center justify-between gap-x-6 gap-y-4 border-b-2 px-[var(--gutter)] py-4',
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
        <Link
          href="/"
          scroll={false}
          onMouseDown={() => window.scrollTo({ top: 0, behavior: 'instant' })}
          className="t-small font-semibold text-[var(--header-ink)] opacity-80 transition-opacity hover:opacity-100"
        >
          Home
        </Link>
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

      <button
        ref={menuButtonRef}
        type="button"
        className="ml-auto inline-flex size-10 items-center justify-center text-[var(--header-ink)] md:hidden"
        aria-expanded={menuOpen}
        aria-controls="mobile-navigation"
        aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
        onClick={() => setMenuOpen((open) => !open)}
      >
        {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
      </button>

      <nav
        id="mobile-navigation"
        aria-label="Mobile navigation"
        aria-hidden={!menuOpen}
        inert={!menuOpen}
        className={cn(
          'grid w-full basis-full grid-cols-1 overflow-hidden border-[var(--header-ink)]/30 md:hidden',
          'transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none',
          menuOpen
            ? 'visible grid-rows-[1fr] border-t pt-4 opacity-100'
            : 'invisible grid-rows-[0fr] border-t-0 pt-0 opacity-0',
        )}
      >
        <div className="flex min-h-0 flex-col gap-4 overflow-hidden">
          <Link
            href="/"
            scroll={false}
            onMouseDown={() => window.scrollTo({ top: 0, behavior: 'instant' })}
            className="t-small font-semibold text-[var(--header-ink)]"
            onClick={() => setMenuOpen(false)}
          >
            Home
          </Link>
          <Link
            href="/library"
            className="t-small font-semibold text-[var(--header-ink)]"
            onClick={() => setMenuOpen(false)}
          >
            Library
          </Link>
          <Link
            href="/settings"
            className="t-small font-semibold text-[var(--header-ink)]"
            onClick={() => setMenuOpen(false)}
          >
            Settings
          </Link>
        </div>
      </nav>

    </header>
  )
}
