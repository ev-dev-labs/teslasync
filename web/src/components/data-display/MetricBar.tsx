import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { VisuallyHidden } from '@/components/a11y/VisuallyHidden'
import { motion } from '@/components/motion'
import { Text } from '@/components/ui/Typography'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { useNumberFormatting } from '@/hooks/useNumberFormatting'
import { cn } from '@/lib/cn'

export interface MetricBarProps {
  /** Null, undefined and nonfinite readings retain an empty track, not a zero fill. */
  value: number | null | undefined
  max: number
  /** Caller-prepared CSS color. No thresholds or domain interpretation are applied. */
  color: string
  /** Optional visible label. Supply ariaLabel when this is absent or blank. */
  label?: string
  /** Accessible name independent of the optional visible header. Defaults to label. */
  ariaLabel?: string
  /** Empty strings intentionally suppress the readout without a numeric fallback. */
  sublabel?: string
  /** False renders a passive track only; naming does not depend on visibility. */
  showHeader?: boolean
  /** False suppresses only the header's readout, retaining the visible label. */
  showValue?: boolean
  /** Default preserves the existing 2.5-height track; slim uses a 1-height track. */
  size?: 'default' | 'slim'
  /** Both fills support caller-prepared CSS colors, including theme variables. */
  fill?: 'gradient' | 'solid'
}

/**
 * Animated bar showing a metric filling up.
 *
 * `sublabel` policy: a string (including the EMPTY string "") is rendered
 * verbatim. Use the empty string to explicitly suppress the textual
 * readout beside the bar when the same value is already displayed
 * elsewhere (e.g. in a sibling row above the bar). When `sublabel` is
 * `undefined` (omitted), the formatted value is shown — that's the
 * common case for standalone bars. We use `??` rather than `||` so an
 * intentional empty string isn't silently treated as "show the value"
 * (which previously rendered a stray "0.00" in the Throttle Behavior
 * panel of /driving).
 *
 * Only visual extent is bounded. Out-of-range readings use a described group
 * instead of reporting a fabricated progress value; invalid scales have no fill.
 */
export function MetricBar({
  value, max, color, label, ariaLabel, sublabel,
  showHeader = true, showValue = true, size = 'default', fill = 'gradient',
}: MetricBarProps) {
  const { t } = useTranslation()
  const { fmtNumber } = useNumberFormatting()
  const { reduce, durationMs } = useMotionPreference()
  const readingId = useId()
  const hasReading = typeof value === 'number' && Number.isFinite(value)
  const safeValue = hasReading ? value : 0
  const safeMax = Number.isFinite(max) && max > 0 ? max : 0
  const pct = safeMax > 0 ? Math.min(Math.max((safeValue / safeMax) * 100, 0), 100) : 0
  const unscaledReading = hasReading && (safeMax === 0 || safeValue < 0 || safeValue > safeMax)
  const gradientStart = /^#[\da-f]{6}$/i.test(color)
    ? `${color}99`
    : `color-mix(in srgb, ${color} 60%, transparent)`
  return (
    <div
      className="min-w-0"
      role={unscaledReading ? 'group' : 'progressbar'}
      aria-label={ariaLabel ?? label}
      aria-describedby={unscaledReading ? readingId : undefined}
      aria-valuemin={unscaledReading ? undefined : 0}
      aria-valuemax={unscaledReading ? undefined : safeMax}
      aria-valuenow={hasReading && !unscaledReading ? safeValue : undefined}
      aria-valuetext={hasReading ? undefined : t('common.noReading', 'No reading')}
    >
      {unscaledReading && <VisuallyHidden id={readingId}>{fmtNumber(safeValue)}</VisuallyHidden>}
      {showHeader && (label != null || showValue) && (
        <div className="mb-2 flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          {label != null && <Text size="sm" weight="medium" color="secondary" className="min-w-0 flex-1 break-words">{label}</Text>}
          {showValue && (
            <Text mono size="sm" color="primary" className="min-w-0 max-w-full break-words text-end">
              {sublabel ?? (hasReading ? fmtNumber(safeValue) : '—')}
            </Text>
          )}
        </div>
      )}
      <div data-metric-track className={cn(
        'overflow-hidden rounded-pill bg-[var(--surface-2)]',
        'forced-colors:[outline-style:solid] forced-colors:outline-1 forced-colors:outline-[CanvasText] forced-colors:!bg-[Canvas] forced-colors:[forced-color-adjust:none]',
        size === 'slim' ? 'h-1' : 'h-2.5',
      )}>
        {hasReading && safeMax > 0 && (
          <motion.div
            data-metric-fill
            className="h-full rounded-pill forced-colors:!bg-[Highlight] forced-colors:!bg-none forced-colors:[forced-color-adjust:none]"
            initial={reduce ? false : { width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: durationMs / 1000, ease: [0.2, 0, 0, 1] }}
            style={{ background: fill === 'solid' ? color : `linear-gradient(90deg, ${gradientStart}, ${color})` }}
          />
        )}
      </div>
    </div>
  )
}
