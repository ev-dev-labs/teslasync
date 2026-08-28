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
  /**
   * Rendered full-width below the message. Used for the guidance and
   * "where to look next" blocks that must not compete with the inline
   * action button for horizontal space.
   */
  footer?: ReactNode
  /** ARIA role; "status" for non-blocking offline/info states, "alert" otherwise. */
  role?: 'alert' | 'status'
  /**
   * Live-region politeness. When omitted it is derived from `role`
   * ("polite" for status, "assertive" for alert) so a non-blocking
   * offline/info surface never announces assertively. Pass explicitly
   * to override the derived default.
   */
  ariaLive?: 'polite' | 'assertive'
  /** Compact variant — tighter padding for inline mutation errors. */
  compact?: boolean
  tone?: 'danger' | 'warning' | 'info' | 'neutral'
  className?: string
}

const toneClasses = {
  danger: {
    panel: 'border-rose-500/20 bg-rose-500/5',
    icon: 'bg-rose-500/10 text-rose-300',
    title: 'text-rose-300',
    message: 'text-rose-300/70',
  },
  warning: {
    panel: 'border-amber-500/25 bg-amber-500/5',
    icon: 'bg-amber-500/10 text-amber-300',
    title: 'text-amber-300',
    message: 'text-amber-200/75',
  },
  info: {
    panel: 'border-cyan-500/20 bg-cyan-500/5',
    icon: 'bg-cyan-500/10 text-cyan-300',
    title: 'text-cyan-300',
    message: 'text-cyan-200/75',
  },
  neutral: {
    panel: 'border-[var(--border-default)] bg-[var(--surface-2)]',
    icon: 'bg-[var(--surface-3)] text-[var(--text-secondary)]',
    title: 'text-[var(--text-primary)]',
    message: 'text-[var(--text-secondary)]',
  },
} as const

export function ErrorState({
  Icon,
  title,
  message,
  action,
  footer,
  role = 'alert',
  ariaLive,
  compact = false,
  tone = 'danger',
  className,
}: ErrorStateProps) {
  // Keep politeness in lockstep with `role` unless the caller pins it.
  // An omitted `ariaLive` on a `status` surface previously fell through
  // to an independent "assertive" default, contradicting the documented
  // contract and interrupting screen-reader users for a non-blocking
  // (offline / waiting) state.
  const ariaLiveValue = ariaLive ?? (role === 'status' ? 'polite' : 'assertive')
  const colors = toneClasses[tone]

  return (
    <div
      role={role}
      aria-live={ariaLiveValue}
      className={cn(
        'rounded-xl border backdrop-blur-sm',
        colors.panel,
        compact ? 'p-3 mb-3' : 'p-4 mb-6',
        className,
      )}
    >
      <div className={cn('flex items-start', compact ? 'gap-2' : 'gap-3')}>
        <div
          className={cn(
            'shrink-0 rounded-lg',
            colors.icon,
            compact ? 'p-1.5 mt-0.5' : 'p-2 mt-0.5',
          )}
        >
          <Icon
            className={cn(compact ? 'h-3.5 w-3.5' : 'h-4 w-4')}
            aria-hidden="true"
          />
        </div>
        <div className="flex-1 min-w-0">
          <p className={cn('font-medium', colors.title, compact ? 'text-xs' : 'text-sm')}>
            {title}
          </p>
          <p className={cn('mt-0.5', colors.message, compact ? 'text-2xs' : 'text-xs')}>
            {message}
          </p>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {footer && <div className={cn(compact ? 'mt-2' : 'mt-3')}>{footer}</div>}
    </div>
  )
}
