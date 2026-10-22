import { cn } from '@/lib/utils'

/**
 * A multi-line text input. Mirrors `Input` so the two look identical
 * side by side; the only difference is the larger minimum height.
 */

export const Textarea = (props: React.ComponentPropsWithRef<'textarea'>) => {
  const { className, ...rest } = props
  return (
    <textarea
      className={cn(
        'min-h-24 w-full border-2 border-current bg-transparent px-3 py-2 t-body text-current placeholder:text-current/65 focus:outline-none focus-visible:outline-2',
        className,
      )}
      {...rest}
    />
  )
}