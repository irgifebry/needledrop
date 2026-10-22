'use client'

import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { Check } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * The checkbox.
 *
 * A tick box is a small target and it lives next to a label, so the two are
 * one control to the eye and to the keyboard. Radix gives us the hard parts
 * — the hidden input that makes the box participate in a real form, the
 * `role="checkbox"` semantics, and the indeterminate state — while the
 * styling stays inside this project's vocabulary: square corners, a 2px
 * border that takes the colour of the text it sits in, and mint as the one
 * accent.
 *
 * The colours are deliberately relative rather than fixed. `border-current`
 * and `text-current` mean the same component reads correctly on the paper
 * surface and on the dark panels, which is why the border is never given a
 * literal colour here. The only literal is mint, and only as the checked
 * fill — that is the accent of the whole system, not a themed value.
 *
 * The check glyph inherits the text colour, so it is ink on mint when the
 * box is checked and would stay legible on any future checked fill.
 */
export function Checkbox({
  className,
  ...props
}: React.ComponentPropsWithRef<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        'peer inline-flex size-5 shrink-0 items-center justify-center border-2 border-current',
        'transition-colors duration-150 disabled:opacity-40',
        'data-[state=checked]:bg-mint data-[state=checked]:text-ink',
        'data-[state=indeterminate]:bg-mint data-[state=indeterminate]:text-ink',
        className,
      )}
      {...props}
    />
  )
}

/**
 * The mark inside the box.
 *
 * Exported separately because the indicator is what a caller reaches for
 * when the box is being driven by something other than a plain click — an
 * animation library that wants to mount the mark on demand, for instance.
 * The default children are the tick; a caller can pass their own and this
 * component will render it instead.
 *
 * The indeterminate state gets a dash rather than a tick, because a tick is
 * a claim about truth that a half-checked box has not made.
 */
export function CheckboxIndicator({
  className,
  children,
  ...props
}: React.ComponentPropsWithRef<typeof CheckboxPrimitive.Indicator>) {
  return (
    <CheckboxPrimitive.Indicator
      className={cn('group flex items-center justify-center text-current', className)}
      {...props}
    >
      {children ?? (
        <>
          <Check
            className="size-3.5 group-data-[state=indeterminate]:hidden"
            strokeWidth={3}
            aria-hidden="true"
          />
          <span
            className="hidden h-0.5 w-3 bg-current group-data-[state=indeterminate]:block"
            aria-hidden="true"
          />
        </>
      )}
    </CheckboxPrimitive.Indicator>
  )
}
