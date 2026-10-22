'use client'

import * as SliderPrimitive from '@radix-ui/react-slider'

import { cn } from '@/lib/utils'

export function Slider({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      className={cn('relative flex w-full touch-none select-none items-center', className)}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1 w-full grow bg-current/25">
        <SliderPrimitive.Range className="absolute h-full bg-current" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        className={cn(
          'block size-4 border-2 border-current bg-mint transition-transform',
          'hover:scale-110 focus-visible:outline-2',
        )}
      />
    </SliderPrimitive.Root>
  )
}
