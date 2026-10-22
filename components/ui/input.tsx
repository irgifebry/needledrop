import { cn } from '@/lib/utils'

export function Input({
  className,
  ...props
}: React.ComponentPropsWithRef<'input'>) {
  return (
    <input
      className={cn(
        'h-11 w-full border-2 border-current bg-transparent px-3 t-body text-current',
        'placeholder:text-current/65 focus:outline-none focus-visible:outline-2',
        className,
      )}
      {...props}
    />
  )
}
