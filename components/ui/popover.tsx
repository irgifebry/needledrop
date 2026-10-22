'use client'

import * as PopoverPrimitive from '@radix-ui/react-popover'

export function Popover({
  trigger,
  children,
  align = 'end',
  side = 'bottom',
}: {
  trigger: React.ReactNode
  children: React.ReactNode
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'right' | 'bottom' | 'left'
}) {
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align={align}
          side={side}
          sideOffset={8}
          className="z-50 w-72 border-2 border-ink bg-paper p-4 text-ink shadow-[6px_6px_0_0_var(--color-ink)]" // taste-skill-ignore: a real popover overlay is allowed a shadow
        >
          {children}
          <PopoverPrimitive.Arrow className="fill-paper" />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
