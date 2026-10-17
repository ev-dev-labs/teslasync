import { type ReactNode } from 'react'
import { type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { severityTokens } from '@/lib/tokens'
import { Icon as StatusIcon } from '@/components/ui/Icon'
import { Text } from '@/components/ui/Typography'

/**
 * Internal layout primitive shared by {@link QueryError} and {@link ErrorDisplay}.
 *
 * Renders the standard "icon + title + message + action" semantic card
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
    panel: cn(severityTokens.critical.border, severityTokens.critical.bg),
    icon: cn(severityTokens.critical.bg, severityTokens.critical.fg),
  },
  warning: {
    panel: cn(severityTokens.warn.border, severityTokens.warn.bg),
    icon: cn(severityTokens.warn.bg, severityTokens.warn.fg),
  },
  info: {
    panel: cn(severityTokens.info.border, severityTokens.info.bg),
    icon: cn(severityTokens.info.bg, severityTokens.info.fg),
  },
  neutral: {
    panel: 'border-[var(--border-default)] bg-[var(--surface-2)]',
    icon: 'bg-[var(--surface-3)] text-[var(--text-secondary)]',
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
        'min-w-0 rounded-panel border',
        colors.panel,
        compact ? 'p-3 mb-3' : 'p-4 mb-6',
        className,
      )}
    >
      <div className={cn('flex flex-wrap items-start', compact ? 'gap-2' : 'gap-3')}>
        <div className={cn('flex w-full min-w-0 flex-1 basis-full items-start md:basis-64', compact ? 'gap-2' : 'gap-3')}>
          <div
            className={cn(
              'shrink-0 rounded-shape-sm',
              colors.icon,
              compact ? 'p-1.5 mt-0.5' : 'p-2 mt-0.5',
            )}
          >
            <StatusIcon icon={Icon} size={compact ? 'sm' : 'md'} />
          </div>
          <div className="flex-1 min-w-0 break-words">
            <Text as="p" variant="body" className="font-medium">
              {title}
            </Text>
            <Text as="p" variant="bodySm" className="mt-1">
              {message}
            </Text>
          </div>
        </div>
        {action && (
          <div className="w-full min-w-0 max-w-full break-words md:w-auto [&_button]:h-auto [&_button]:min-h-11 [&_button]:min-w-11 [&_button]:max-w-full [&_button]:whitespace-normal [&_button]:break-words [&_button]:py-2 md:[&_button]:min-h-9 md:[&_button]:min-w-0">
            {action}
          </div>
        )}
      </div>
      {footer && <div className={cn('min-w-0 break-words', compact ? 'mt-2' : 'mt-3')}>{footer}</div>}
    </div>
  )
}
