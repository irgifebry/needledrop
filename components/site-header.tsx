'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

const LINKS = [
  { href: '#how', label: 'How it works' },
  { href: '#why', label: 'Why it works' },
  { href: '#faq', label: 'FAQ' },
]

export function SiteHeader() {
  const pathname = usePathname()
  const onHome = pathname === '/'
  const [chapter, setChapter] = useState('orange')
  const headerRef = useRef<HTMLElement>(null)

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

    </header>
  )
}
