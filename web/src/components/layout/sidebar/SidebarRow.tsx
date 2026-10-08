/**
 * SidebarRow
 * ──────────
 * Shared sidebar row: icon + label + optional context line + optional
 * trailing badge + hover pin action. Used by the Atlas panel (all four
 * tabs) so every row in the overlay behaves identically.
 *
 * Active rows get a restrained 2px accent rail; pin/unpin actions are always
 * visible on touch viewports (`lg:`-gated hover reveal) so pinning
 * never depends on a hover that touch devices don't have.
 */

import { PrefetchNavLink } from '../PrefetchLink'
import { motion } from '@/components/motion/runtime'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import type { Icons } from '@/lib/icons'
import { cn } from '@/lib/cn'
import { typography } from '@/lib/tokens'

export interface SidebarRowProps {
  to: string
  label: string
  icon: typeof Icons.home
  active: boolean
  onSelect?: () => void
  onDoubleClick?: () => void
  compact?: boolean
  onShowTip?: (anchor: HTMLElement, label: string, context?: string) => void
  onHideTip?: () => void
  trailing?: React.ReactNode
  hoverAction?: React.ReactNode
  dataTour?: string
  /** Secondary line under the label (reason, collection, …). */
  context?: string
  ariaLabel?: string
  actionAlwaysVisible?: boolean
}

export function SidebarRow({
  to,
  label,
  icon: Icon,
  active,
  onSelect,
  onDoubleClick,
  compact = false,
  onShowTip,
  onHideTip,
  trailing,
  hoverAction,
  dataTour,
  context,
  ariaLabel,
  actionAlwaysVisible = false,
}: SidebarRowProps) {
  // Cascade item: under an orchestrating AtlasPanel parent each row rises
  // in sequence on mount; without one the variants stay inert and the
  // row renders statically. Vertical rise keeps it direction-neutral.
  const { reduce } = useMotionPreference()
  return (
    <motion.div
      variants={
        reduce
          ? undefined
          : {
              hidden: { opacity: 0, y: 5 },
              show: { opacity: 1, y: 0, transition: { duration: 0.13, ease: 'easeOut' } },
            }
      }
      className={cn('group/sidebar-row relative flex items-center', compact && 'justify-center')}
    >
      {active && (
        <span
          aria-hidden
          className="absolute inset-y-0 start-0 z-10 w-0.5 bg-[var(--nav-active-indicator)]"
        />
      )}
      <PrefetchNavLink
        to={to}
        onClick={onSelect}
        onDoubleClick={onDoubleClick}
        onMouseEnter={compact ? event => onShowTip?.(event.currentTarget, label, context) : undefined}
        onMouseLeave={compact ? onHideTip : undefined}
        onFocus={compact ? event => onShowTip?.(event.currentTarget, label, context) : undefined}
        onBlur={compact ? onHideTip : undefined}
        aria-label={ariaLabel ?? (compact ? (context ? `${label}, ${context}` : label) : undefined)}
        end={!active}
        // `undefined`, never `false`: NavLink adopts an explicitly passed
        // aria-current as its own active marker, so `false` would render
        // a literal aria-current="false" on the current row.
        aria-current={active ? 'page' : undefined}
        data-tour={dataTour}
        className={cn(
          compact
            ? 'relative flex h-11 w-11 shrink-0 items-center justify-center rounded-shape-md transition-colors duration-fast'
            : 'flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-shape-md py-2 pe-2 ps-3 transition-colors duration-fast md:min-h-10',
          typography.size.sm,
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]',
          active
            ? cn('bg-[var(--nav-active-bg)]', typography.weight.medium, typography.color.primary)
            : cn(typography.color.secondary, 'hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]'),
        )}
      >
        <Icon
          className={cn(
            compact ? 'h-6 w-6 shrink-0 transition-colors duration-fast' : 'h-4 w-4 shrink-0 transition-colors duration-fast',
            active ? typography.color.primary : typography.color.muted,
          )}
          aria-hidden
        />
        {!compact && <span className="min-w-0 flex-1 whitespace-normal break-words leading-snug">
          {label}
          {context && (
            <span className={cn('block whitespace-normal break-words', typography.role.caption, typography.weight.regular)}>
              {context}
            </span>
          )}
        </span>}
        {compact && trailing && <span className="absolute end-0 top-0 scale-75">{trailing}</span>}
        {!compact && trailing}
      </PrefetchNavLink>
      {hoverAction && !compact && (
        <div className={cn('ms-1 shrink-0 transition-opacity duration-fast', !actionAlwaysVisible && 'lg:opacity-0 lg:group-hover/sidebar-row:opacity-100 lg:focus-within:opacity-100')}>
          {hoverAction}
        </div>
      )}
    </motion.div>
  )
}

export function SidebarNotificationDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--semantic-info)]',
        className,
      )}
    />
  )
}

export function SidebarCountChip({ value, label, suffix, uncapped = false, className }: {
  value: number
  label: string
  suffix?: string
  uncapped?: boolean
  className?: string
}) {
  return (
    <span
      aria-label={label}
      className={cn('inline-flex h-5 min-w-5 items-center justify-center rounded-shape-sm bg-[var(--surface-3)] px-1.5 tabular-nums', typography.size.xs, typography.weight.medium, typography.color.secondary, className)}
    >
      {!uncapped && value > 99 ? '99+' : value}{suffix && ` ${suffix}`}
    </span>
  )
}

export default SidebarRow
