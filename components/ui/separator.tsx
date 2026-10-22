'use client'

import * as SeparatorPrimitive from '@radix-ui/react-separator'

import { cn } from '@/lib/utils'

/**
 * The separator.
 *
 * A thin rule between two groups of content. It is decorative by default and
 * rendered as a `<div>` rather than an `<hr>` unless a label is supplied,
 * because most of the dividers in this interface are visual rhythm rather
 * than a semantic section break. The orientation is driven by the
 * `orientation` prop, and the colour comes from `currentColor` so the rule
 * matches whatever surface it sits on.
 */
export function Separator({
  className,
  ...props
}: React.ComponentPropsWithRef<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      className={cn(
        'shrink-0 bg-current/20',
        'data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full',
        'data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px',
        className,
      )}
      {...props}
    />
  )
}