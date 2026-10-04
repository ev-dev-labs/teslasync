import { type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/cn'
import { type NeonColor, neonColorMap } from '../../lib/tokens'
import { Card, HelpTooltip, Text, type HelpTooltipProps } from '@/components/ui'
import { Delta, type DeltaProps } from './Delta'
import { useNumberFormatting } from '@/hooks/useNumberFormatting'

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
  /** Numeric semantics; omitted preserves caller-formatted/count/ID contracts. */
  kind?: 'measurement' | 'count'
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
  /** Dense overview band with complete, wrapping labels and values. */
  compact?: boolean
  /**
   * Optional contextual help. When provided, a small "?" tooltip is
   * rendered next to the label. Accepts the full `HelpTooltipProps` so
   * call sites can pass `i18nKey`, `defaultValue`, `learnMore`, etc.
   */
  help?: HelpTooltipProps
}

/** Compact metric display card with icon, value, label, and optional trend. */
export function MetricCard({ label, value, kind, icon, color = 'cyan', change, delta, subtitle, className, help, wrapLabel = false, compact = false }: MetricCardProps) {
  const { t } = useTranslation()
  const { fmtNumber, fmtInt } = useNumberFormatting()
  const displayValue = typeof value === 'number' && kind
    ? Number.isFinite(value) ? kind === 'count' ? fmtInt(value) : fmtNumber(value) : '—'
    : value
  // Fall back to cyan if a caller passes an unregistered colour (e.g. a
  // value driven from API data) so `c.bg`/`c.ring` never throw on undefined.
  const c = neonColorMap[color] ?? neonColorMap.cyan
  const numericValue = typeof value === 'number' ? value : Number(value)
  const deltaCurrent = delta?.current ?? (Number.isFinite(numericValue) ? numericValue : null)
  return (
    <Card
      padding="none"
      data-role="metric-card"
      className={cn(
        compact
          ? '@container/metric min-h-0 rounded-none border-0 bg-[var(--surface-1)] p-3 shadow-none'
          : 'min-h-28 p-5',
        className,
      )}
    >
      <div className={cn('flex items-start justify-between gap-4', compact && 'h-full @[26rem]/metric:items-center')}>
        <div className={cn('min-w-0 flex-1', compact && '@[26rem]/metric:grid @[26rem]/metric:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_5rem] @[26rem]/metric:items-center @[26rem]/metric:gap-x-3')}>
          <Text
            as="p"
            size="sm"
            weight="medium"
            color="secondary"
            data-role="metric-label"
            className={cn(
              'flex items-start gap-1.5 leading-snug',
              compact ? 'min-h-9 @[26rem]/metric:min-h-0 @[26rem]/metric:col-start-1 @[26rem]/metric:row-start-1' : wrapLabel ? 'min-h-10' : 'truncate',
            )}
          >
            <span className={compact ? 'break-words' : wrapLabel ? 'line-clamp-2' : 'truncate'}>{label}</span>
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
            className={cn('leading-tight tracking-[-0.025em] tabular-nums', compact ? 'mt-1 break-words text-xl @[26rem]/metric:col-start-2 @[26rem]/metric:row-start-1 @[26rem]/metric:mt-0 @[26rem]/metric:text-center' : 'mt-3')}
          >
            {displayValue}
          </Text>
          {subtitle && (
            <Text as="p" variant="caption" data-role="metric-subtitle" className={cn('mt-1.5 truncate', compact && '@[26rem]/metric:col-span-3')}>
              {subtitle}
            </Text>
          )}
          {change && !delta && (
            <Text as="p" size="xs" weight="medium" className={cn('mt-1.5', compact && '@[26rem]/metric:col-start-3 @[26rem]/metric:row-start-1 @[26rem]/metric:mt-0 @[26rem]/metric:text-right', change.positive ? 'text-emerald-300' : 'text-rose-300')}>
              {change.positive ? '↑' : '↓'} {change.value}
            </Text>
          )}
          {delta && (
            <div data-role="metric-comparison" className={cn('mt-1', compact && '@[26rem]/metric:col-start-3 @[26rem]/metric:row-start-1 @[26rem]/metric:mt-0 @[26rem]/metric:justify-self-end')}>
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
