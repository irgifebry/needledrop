import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 font-sans font-semibold transition-[background-color,color,transform] duration-150 active:translate-y-px disabled:pointer-events-none disabled:opacity-40 select-none',
  {
    variants: {
      variant: {
        mint: 'bg-mint text-ink hover:bg-ink hover:text-mint',
        ink: 'bg-ink text-paper hover:bg-orange hover:text-ink',
        paper: 'bg-paper text-ink hover:bg-ink hover:text-paper',
        outline: 'border-2 border-current text-current hover:bg-current hover:text-ink',
        ghost: 'text-current hover:bg-current/10',
      },
      size: {
        sm: 'h-9 px-3 t-small',
        md: 'h-11 px-5 t-body',
        lg: 'h-14 px-7 t-body',
        icon: 'h-11 w-11',
      },
      block: {
        true: 'w-full',
      },
    },
    defaultVariants: { variant: 'mint', size: 'md' },
  },
)

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>

export function Button({ className, variant, size, block, ...props }: ButtonProps) {
  return (
    <button className={cn(buttonVariants({ variant, size, block }), className)} {...props} />
  )
}

export function ButtonLink({
  className,
  variant,
  size,
  block,
  ...props
}: React.ComponentPropsWithoutRef<'a'> & VariantProps<typeof buttonVariants>) {
  return <a className={cn(buttonVariants({ variant, size, block }), className)} {...props} />
}
