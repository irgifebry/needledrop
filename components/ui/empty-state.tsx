/**
 * A presentational "nothing here yet" panel.
 *
 * Used for empty lists, empty search results and empty states generally.
 * It is deliberately a plain component rather than a Radix wrapper, so it
 * has no client directive and can be rendered from a server component.
 */

import { cn } from '@/lib/utils'

export function EmptyState({
  title,
  body,
  action,
  icon,
  className,
}: {
  title: string
  body?: string
  action?: React.ReactNode
  icon?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'border-2 border-dashed border-current/40 px-6 py-10 text-center',
        className,
      )}
    >
      {icon ? <div className="mb-4 flex justify-center">{icon}</div> : null}
      <p className="t-title font-semibold">{title}</p>
      {body ? <p className="t-small mt-2 opacity-70">{body}</p> : null}
      {action ? <div className="mt-5 flex justify-center gap-3">{action}</div> : null}
    </div>
  )
}