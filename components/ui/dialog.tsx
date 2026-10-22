'use client'

import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * The dialog root.
 *
 * A dialog is a modal surface that takes over the screen and blocks the page
 * behind it, so it is reserved for decisions that need a deliberate answer
 * (deleting a playlist, confirming a destructive action). Radix supplies the
 * focus trap, the escape-to-close, and the scroll lock; this wrapper only
 * carries the visual vocabulary and the close button so every dialog in the
 * app looks like it belongs to the same surface.
 */
export function Dialog(props: React.ComponentPropsWithRef<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root {...props} />
}

export function DialogTrigger(props: React.ComponentPropsWithRef<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger {...props} />
}

export function DialogClose(props: React.ComponentPropsWithRef<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close {...props} />
}

export function DialogPortal(props: React.ComponentPropsWithRef<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal {...props} />
}

export function DialogOverlay({
  className,
  ...props
}: React.ComponentPropsWithRef<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn('fixed inset-0 z-50 bg-ink/70', className)}
      {...props}
    />
  )
}

export function DialogContent({
  className,
  children,
  ...props
}: React.ComponentPropsWithRef<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-[min(38rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 border-2 border-ink bg-paper p-6 text-ink shadow-[6px_6px_0_0_var(--color-ink)]', // taste-skill-ignore: a real dialog overlay is allowed a shadow
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className={cn(
            'absolute right-3 top-3 inline-flex size-8 items-center justify-center',
            'border-2 border-ink/40 text-ink transition-colors',
            'hover:bg-ink hover:text-paper focus-visible:outline-2',
          )}
          aria-label="Close"
        >
          <X className="size-4" aria-hidden="true" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

export function DialogTitle({
  className,
  ...props
}: React.ComponentPropsWithRef<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('t-title font-semibold', className)}
      {...props}
    />
  )
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentPropsWithRef<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn('t-body mt-2 text-ink/70', className)}
      {...props}
    />
  )
}