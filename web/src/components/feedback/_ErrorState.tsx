import { type ReactNode } from 'react'
import { type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * Internal layout primitive shared by {@link QueryError} and {@link ErrorDisplay}.
 *
 * Renders the standard "icon + title + message + action" rose-tinted card
 * used for every failure mode (404 / 401 / 5xx / network). Centralising the
 * chrome here keeps the four branches in QueryError focused on copy + CTA
 * while ErrorDisplay can reuse the same look without duplicating Tailwind.
 *
 * Not exported from the feedback barrel — call sites should import the
 * pre-branched {@link QueryError} or {@link ErrorDisplay} components.
 */
export interface ErrorStateProps {
  Icon: LucideIcon
  title: string
  message: string
  action?: ReactNode
  /** ARIA role; "status" for non-blocking offline/info states, "alert" otherwise. */
  role?: 'alert' | 'status'
  /** Matches `role`: "polite" for status, "assertive" for alert. */
  ariaLive?: 'polite' | 'assertive'
  /** Compact variant — tighter padding for inline mutation errors. */
  compact?: boolean
  className?: string
}

export function ErrorState({
  Icon,
  title,
  message,
  action,
  role = 'alert',
  ariaLive = 'assertive',
  compact = false,
  className,
}: ErrorStateProps) {
  return (
    <div
      role={role}
      aria-live={ariaLive}
      className={cn(
        'rounded-xl border border-rose-500/20 bg-rose-500/5 backdrop-blur-sm',
        compact ? 'p-3 mb-3' : 'p-4 mb-6',
        className,
      )}
    >
      <div className={cn('flex items-start', compact ? 'gap-2' : 'gap-3')}>
        <div
          className={cn(
            'shrink-0 rounded-lg bg-rose-500/10',
            compact ? 'p-1.5 mt-0.5' : 'p-2 mt-0.5',
          )}
        >
          <Icon
            className={cn('text-rose-300', compact ? 'h-3.5 w-3.5' : 'h-4 w-4')}
            aria-hidden="true"
          />
        </div>
        <div className="flex-1 min-w-0">
          <p className={cn('font-medium text-rose-300', compact ? 'text-xs' : 'text-sm')}>
            {title}
          </p>
          <p className={cn('text-rose-300/70 mt-0.5', compact ? 'text-[11px]' : 'text-xs')}>
            {message}
          </p>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  )
}
