import { cn } from '@/lib/cn'

interface ChartSkeletonProps {
  className?: string
  /**
   * How many animated bars to render. Defaults to 7. Non-finite values fall
   * back to the default; negative / fractional values are clamped to a
   * non-negative integer so the component can never throw on bad input.
   */
  bars?: number
  /**
   * Accessible label for the loading region. Pass a translated string from the
   * call site (e.g. `t('charts.loading', 'Loading chart')`). Defaults to a
   * plain-English fallback so the skeleton is still announced when omitted.
   */
  label?: string
}

/**
 * Deterministic bar height (as a CSS percentage) for a given bar index.
 *
 * The previous implementation called `Math.random()` inline in render, so every
 * bar jumped to a new height on each re-render (visible jitter) and the output
 * could not be tested. Heights are now a pure function of the bar index — stable
 * across renders while still varied enough to read as a chart silhouette. The
 * result is clamped to [8, 95] so a bar is never invisible or overflowing.
 */
function barHeightPercent(index: number): number {
  const wave = Math.sin(index * 0.9) * 20
  const jitter = Math.abs(Math.sin(index * 2.3 + 1)) * 30
  return Math.round(Math.min(95, Math.max(8, 25 + wave + jitter)))
}

/** Skeleton shaped like a chart area — shows animated bars growing. */
export function ChartSkeleton({ className = '', bars = 7, label = 'Loading chart' }: ChartSkeletonProps) {
  const barCount = Number.isFinite(bars) ? Math.max(0, Math.floor(bars)) : 7
  return (
    <div
      className={cn('rounded-xl bg-white/[0.02] p-4 flex items-end gap-2', className)}
      role="status"
      aria-busy="true"
      aria-label={label}
      data-testid="chart-skeleton"
    >
      {Array.from({ length: barCount }).map((_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className="flex-1 rounded-t bg-white/[0.04] animate-skeleton-wave"
          style={{
            height: `${barHeightPercent(i)}%`,
            animationDelay: `${i * 0.1}s`,
          }}
        />
      ))}
    </div>
  )
}
