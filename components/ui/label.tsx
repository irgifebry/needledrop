'use client'

import * as LabelPrimitive from '@radix-ui/react-label'

import { cn } from '@/lib/utils'

/**
 * The label.
 *
 * A label is not decoration: it is the accessible name of the control it
 * sits beside, and clicking it has to move the focus there. Radix's label
 * handles the second part (it swallows the double-click that would
 * otherwise select a word of the label text) and keeps the element a real
 * `<label>` for the first.
 *
 * The type is the small, tight step rather than the body step. Labels are
 * captions to a control, not prose, and a caption set at body size starts
 * competing with the value it is naming.
 */
export function Label({
  className,
  ...props
}: React.ComponentPropsWithRef<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn(
        'inline-flex items-center gap-2 t-small font-semibold leading-tight',
        className,
      )}
      {...props}
    />
  )
}
