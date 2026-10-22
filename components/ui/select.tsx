'use client'

import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * The select root.
 *
 * A select replaces a native `<select>` when the option list needs styling
 * the browser will not give us, or when the value is not a plain string.
 * Radix keeps the keyboard behaviour and the hidden native input that make
 * the control accessible and form-friendly, so this wrapper only contributes
 * the square, bordered vocabulary of the rest of the system.
 */
export function Select(props: React.ComponentPropsWithRef<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root {...props} />
}

export function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentPropsWithRef<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        'flex h-11 w-full items-center justify-between gap-2 border-2 border-current bg-transparent px-3 t-body',
        className,
      )}
      {...props}
    >
      {children}
    </SelectPrimitive.Trigger>
  )
}

export function SelectValue(props: React.ComponentPropsWithRef<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value {...props} />
}

export function SelectIcon({
  className,
  children,
  ...props
}: React.ComponentPropsWithRef<typeof SelectPrimitive.Icon>) {
  return (
    <SelectPrimitive.Icon className={cn('shrink-0', className)} {...props}>
      {children ?? <ChevronDown className="size-4" aria-hidden="true" />}
    </SelectPrimitive.Icon>
  )
}

export function SelectContent({
  className,
  children,
  ...props
}: React.ComponentPropsWithRef<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        className={cn(
          'z-50 min-w-[10rem] border-2 border-ink bg-paper p-1 text-ink shadow-[6px_6px_0_0_var(--color-ink)]', // taste-skill-ignore: a real select overlay is allowed a shadow
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

export function SelectViewport({
  className,
  ...props
}: React.ComponentPropsWithRef<typeof SelectPrimitive.Viewport>) {
  return (
    <SelectPrimitive.Viewport
      className={cn('p-1', className)}
      {...props}
    />
  )
}

export function SelectItem({
  className,
  children,
  ...props
}: React.ComponentPropsWithRef<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        'flex cursor-pointer select-none items-center justify-between gap-2 px-3 py-2 t-body outline-none',
        'data-[highlighted]:bg-mint data-[highlighted]:text-ink data-[state=checked]:font-semibold',
        className,
      )}
      {...props}
    >
      <SelectItemText>{children}</SelectItemText>
      <SelectItemIndicator />
    </SelectPrimitive.Item>
  )
}

export function SelectItemText(props: React.ComponentPropsWithRef<typeof SelectPrimitive.ItemText>) {
  return <SelectPrimitive.ItemText {...props} />
}

export function SelectItemIndicator({
  className,
  children,
  ...props
}: React.ComponentPropsWithRef<typeof SelectPrimitive.ItemIndicator>) {
  return (
    <SelectPrimitive.ItemIndicator
      className={cn('flex items-center', className)}
      {...props}
    >
      {children ?? (
        <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
      )}
    </SelectPrimitive.ItemIndicator>
  )
}