'use client'

import * as RadioGroupPrimitive from '@radix-ui/react-radio-group'

import { cn } from '@/lib/utils'

export function RadioGroup({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>) {
  return <RadioGroupPrimitive.Root className={cn('grid gap-2', className)} {...props} />
}

export function RadioCard({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      className={cn(
        'flex cursor-pointer items-center gap-3 border-2 border-current px-3 py-2.5 text-left',
        'transition-colors duration-150 hover:bg-current/10',
        'data-[state=checked]:bg-mint data-[state=checked]:text-ink',
        className,
      )}
      {...props}
    />
  )
}
