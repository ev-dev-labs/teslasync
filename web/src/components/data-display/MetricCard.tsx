import { type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/cn'
import { type NeonColor, neonColorMap } from '../../lib/tokens'
import { Card, HelpTooltip, Text, type HelpTooltipProps } from '@/components/ui'
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
  /** Allow longer metric labels to wrap to two lines on narrow cards. */
  wrapLabel?: boolean
  /**
   * Optional contextual help. When provided, a small "?" tooltip is
   * rendered next to the label. Accepts the full `HelpTooltipProps` so
   * call sites can pass `i18nKey`, `defaultValue`, `learnMore`, etc.
   */
  help?: HelpTooltipProps
}

/** Compact metric display card with icon, value, label, and optional trend. */
export function MetricCard({ label, value, icon, color = 'cyan', change, delta, subtitle, className, help, wrapLabel = false }: MetricCardProps) {
  const { t } = useTranslation()
  // Fall back to cyan if a caller passes an unregistered colour (e.g. a
  // value driven from API data) so `c.bg`/`c.ring` never throw on undefined.
  const c = neonColorMap[color] ?? neonColorMap.cyan
  const numericValue = typeof value === 'number' ? value : Number(value)
  const deltaCurrent = delta?.current ?? (Number.isFinite(numericValue) ? numericValue : null)
  return (
    <Card
      padding="none"
      data-role="metric-card"
      className={cn('min-h-28 p-5', className)}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Text
            as="p"
            size="sm"
            weight="medium"
            color="secondary"
            data-role="metric-label"
            className={cn(
              'flex items-start gap-1.5 leading-snug',
              wrapLabel ? 'min-h-10' : 'truncate',
            )}
          >
            <span className={wrapLabel ? 'line-clamp-2' : 'truncate'}>{label}</span>
            {help && (
              <HelpTooltip
                size="xs"
                {...help}
                ariaLabel={help.ariaLabel ?? t('metricCard.moreInfoAbout', 'More info about {{label}}', { label })}
              />
            )}
          </Text>
          <Text
            as="p"
            size="3xl"
            weight="semibold"
            color="primary"
            data-role="metric-value"
            className="mt-3 leading-tight tracking-[-0.025em] tabular-nums"
          >
            {value}
          </Text>
          {subtitle && (
            <Text as="p" variant="caption" data-role="metric-subtitle" className="mt-1.5 truncate">
              {subtitle}
            </Text>
          )}
          {change && !delta && (
            <Text as="p" size="xs" weight="medium" className={cn('mt-1.5', change.positive ? 'text-emerald-300' : 'text-rose-300')}>
              {change.positive ? '↑' : '↓'} {change.value}
            </Text>
          )}
          {delta && (
            <div className="mt-1">
              <Delta {...delta} current={deltaCurrent} />
            </div>
          )}
        </div>
        {icon && (
          <div
            data-role="metric-icon"
            data-color={color}
            className="flex shrink-0 items-center justify-center rounded-shape-lg border border-[var(--border-default)] bg-[var(--surface-2)] p-2.5 shadow-e1"
          >
            <div className={c.text}>{icon}</div>
          </div>
        )}
      </div>
    </Card>
  )
}
