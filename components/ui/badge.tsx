import type { HTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 border border-current px-2 py-0.5 t-small font-semibold leading-tight',
        className,
      )}
      {...props}
    />
  )
}
