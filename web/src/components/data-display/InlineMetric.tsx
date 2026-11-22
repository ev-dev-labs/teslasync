import { type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { useNumberFormatting } from '@/hooks/useNumberFormatting'

interface InlineMetricProps {
  icon: ReactNode
  /** Primary value. `null`/`undefined` degrades gracefully to an em-dash. */
  value: string | number | null | undefined
  /** Numeric semantics; omitted preserves caller-formatted/count/ID contracts. */
  kind?: 'measurement' | 'count'
  label?: string
  className?: string
}

/** Compact icon+value pair used in stat rows within cards. */
export function InlineMetric({ icon, value, kind, label, className }: InlineMetricProps) {
  const { fmtNumber, fmtInt } = useNumberFormatting()
  const displayValue = typeof value === 'number' && kind
    ? Number.isFinite(value) ? kind === 'count' ? fmtInt(value) : fmtNumber(value) : '—'
    : value ?? '—'
  return (
    <span data-app-part="metric" data-app-metric="inline" className={cn('inline-flex min-w-0 max-w-full flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs text-[var(--text-muted)]', className)}>
      <span aria-hidden="true" className="shrink-0 [&>svg]:h-3 [&>svg]:w-3">
        {icon}
      </span>
      <span data-app-part="metric-value" className="font-medium tabular-nums text-[var(--text-primary)] [overflow-wrap:anywhere]">{displayValue}</span>
      {label ? <span data-app-part="metric-label" className="min-w-0 text-[var(--text-secondary)] [overflow-wrap:anywhere]">{label}</span> : null}
    </span>
  )
}
