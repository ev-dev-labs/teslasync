import { type ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { type NeonColor, neonColorMap } from '../../lib/tokens'
import { HelpTooltip, type HelpTooltipProps } from '../ui/HelpTooltip'
import { Delta, type DeltaProps } from './Delta'

/**
 * Slim wrapper around `<Delta>` for the `MetricCard` footer slot.
 * Drops the `current` prop because the card already knows its own value.
 */
type MetricCardDelta = Omit<DeltaProps, 'current'> & {
  /** Override the current value if it isn't a plain number on the card. */
  current?: number | null;
}

interface MetricCardProps {
  label: string
  value: string | number
  icon?: ReactNode
  color?: NeonColor
  /**
   * Legacy ad-hoc change pill. Prefer `delta` for new call sites — it picks
   * the right colour based on metric semantics and renders a unified arrow.
   */
  change?: { value: string; positive: boolean }
  /**
   * Direction-aware delta. Drives the standardised `<Delta>` indicator —
   * green/red/grey based on the metric's `direction`.
   */
  delta?: MetricCardDelta
  subtitle?: string
  className?: string
  /**
   * Optional contextual help. When provided, a small "?" tooltip is
   * rendered next to the label. Accepts the full `HelpTooltipProps` so
   * call sites can pass `i18nKey`, `defaultValue`, `learnMore`, etc.
   */
  help?: HelpTooltipProps
}

/** Compact metric display card with icon, value, label, and optional trend. */
export function MetricCard({ label, value, icon, color = 'cyan', change, delta, subtitle, className, help }: MetricCardProps) {
  const c = neonColorMap[color]
  const numericValue = typeof value === 'number' ? value : Number(value)
  const deltaCurrent = delta?.current ?? (Number.isFinite(numericValue) ? numericValue : null)
  return (
    <div className={cn('p-3 rounded-xl bg-white/[0.02] border border-white/[0.04] transition-colors hover:border-white/[0.08]', className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="metric-label mb-1 text-[10px] truncate flex items-center gap-1">
            <span className="truncate">{label}</span>
            {help && (
              <HelpTooltip
                size="xs"
                {...help}
                ariaLabel={help.ariaLabel ?? `More info about ${label}`}
              />
            )}
          </p>
          <p className="text-xl font-bold tracking-tight text-[var(--text-primary)]">{value}</p>
          {subtitle && <p className="mt-0.5 text-[10px] text-[var(--text-muted)] truncate">{subtitle}</p>}
          {change && !delta && (
            <p className={cn('mt-1 text-[10px] font-medium', change.positive ? 'text-emerald-300' : 'text-rose-300')}>
              {change.positive ? '↑' : '↓'} {change.value}
            </p>
          )}
          {delta && (
            <div className="mt-1">
              <Delta {...delta} current={deltaCurrent} />
            </div>
          )}
        </div>
        {icon && (
          <div className={cn('flex items-center justify-center rounded-lg p-1.5 ring-1 shrink-0', c.bg, c.ring)}>
            <div className={c.text}>{icon}</div>
          </div>
        )}
      </div>
    </div>
  )
}
