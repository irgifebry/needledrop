'use client'

import { Toaster as Sonner } from 'sonner'

export function Toaster() {
  return (
    <Sonner
      position="bottom-center"
      toastOptions={{
        classNames: {
          toast:
            'border-2 border-ink bg-paper text-ink rounded-none shadow-[6px_6px_0_0_var(--color-ink)] font-sans', // taste-skill-ignore: a real toast overlay is allowed a shadow
          description: 'text-ink/75',
          actionButton: 'bg-ink text-paper rounded-none',
          cancelButton: 'bg-paper text-ink rounded-none',
        },
      }}
    />
  )
}
