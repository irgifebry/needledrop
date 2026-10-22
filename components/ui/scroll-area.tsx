'use client'

import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'

import { cn } from '@/lib/utils'

/**
 * The scroll area root.
 *
 * Wraps a region that may overflow its box and gives it a styled scrollbar
 * instead of the browser default, so the surface stays inside the design
 * system on every platform. Radix handles the scroll mechanics and the
 * thumb sizing; the wrapper only contributes the relative container and
 * the mint-free, current-colour thumb.
 */
export function ScrollArea({
  className,
  children,
  ...props
}: React.ComponentPropsWithRef<typeof ScrollAreaPrimitive.Root>) {
  return (
    <ScrollAreaPrimitive.Root
      className={cn('relative overflow-hidden', className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport className="h-full w-full">
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

export function ScrollBar({
  className,
  orientation = 'vertical',
  ...props
}: React.ComponentPropsWithRef<typeof ScrollAreaPrimitive.Scrollbar>) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      orientation={orientation}
      className={cn('flex touch-none select-none p-0.5 transition-colors', className)}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        className={cn('relative flex-1 bg-current/40')}
      />
    </ScrollAreaPrimitive.Scrollbar>
  )
}