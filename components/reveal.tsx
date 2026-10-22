'use client'

import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode
  delay?: number
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    if (typeof IntersectionObserver === 'undefined') {
      // No observer support (very old browsers): reveal the content by
      // writing the attribute straight to the DOM. A React state update here
      // would be a synchronous setState inside the effect, which is the
      // pattern the compiler lint rule (and React itself) warns about — and
      // it is unnecessary, because nothing will change `shown` afterwards.
      element.dataset.shown = 'true'
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true)
            observer.disconnect()
          }
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.08 },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className={cn('rise', className)}
      data-shown={shown}
      style={{ animationDelay: `${delay}ms` }}
    >
      {children}
    </div>
  )
}
