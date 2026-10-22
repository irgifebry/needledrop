'use client'

import * as TabsPrimitive from '@radix-ui/react-tabs'

import { cn } from '@/lib/utils'

/**
 * The tabs root.
 *
 * Tabs switch between sibling panels without leaving the page, so they are
 * the right control when the views share a heading and differ only in slice.
 * Radix owns the roving focus and the keyboard navigation; the wrapper only
 * pins the shared border and mint active state.
 */
export function Tabs(props: React.ComponentPropsWithRef<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root {...props} />
}

export function TabsList({
  className,
  ...props
}: React.ComponentPropsWithRef<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn('inline-flex items-center gap-1 border-2 border-current p-1', className)}
      {...props}
    />
  )
}

export function TabsTrigger({
  className,
  ...props
}: React.ComponentPropsWithRef<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'px-3 py-1.5 t-small font-semibold transition-colors data-[state=active]:bg-mint data-[state=active]:text-ink',
        className,
      )}
      {...props}
    />
  )
}

export function TabsContent({
  className,
  ...props
}: React.ComponentPropsWithRef<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      tabIndex={0}
      className={cn('outline-none', className)}
      {...props}
    />
  )
}