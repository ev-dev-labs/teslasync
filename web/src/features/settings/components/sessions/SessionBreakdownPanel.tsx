import { type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { GlassPanel, PanelTitle } from '@/components/ui'
import { MetricBar } from '@/components/data-display'
import { Skeleton, EmptyState, QueryError } from '@/components/feedback'
import { chartTokens } from '@/lib/tokens'

import type { BreakdownItem } from './sessionStats'

interface SessionBreakdownPanelProps {
  title: string
  /** Decorative leading glyph — rendered aria-hidden. */
  icon: ReactNode
  items: BreakdownItem[]
  /** Total sessions — the denominator for each bar. */
  total: number
  isLoading: boolean
  isError: boolean
  error?: unknown
  onRetry?: () => void
  emptyMessage: string
  /** Offsets into the color-blind-safe series so sibling panels differ. */
  colorOffset?: number
}

/**
 * One device-breakdown panel (by browser / platform / network). Fully
 * self-sufficient: renders its own skeleton, error, and empty states so the
 * page never has to gate the whole bento behind a single condition.
 */
export function SessionBreakdownPanel({
  title,
  icon,
  items,
  total,
  isLoading,
  isError,
  error,
  onRetry,
  emptyMessage,
  colorOffset = 0,
}: SessionBreakdownPanelProps) {
  const { t } = useTranslation()
  const series = chartTokens.series
  const rows = items ?? []
  const max = total > 0 ? total : 1

  // Even when the caller flags an error without supplying an error object,
  // surface a retryable failure card so the panel body never collapses to
  // just its title — QueryError renders nothing for a falsy error.
  const shownError =
    isError && !error
      ? new Error(t('account.sessions.breakdownError', 'Failed to load sessions'))
      : error

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <span className="text-cyan-300" aria-hidden="true">
          {icon}
        </span>
        {title}
      </PanelTitle>
      {isLoading ? (
        <Skeleton height={168} />
      ) : isError ? (
        <QueryError error={shownError} onRetry={onRetry} />
      ) : rows.length === 0 ? (
        <EmptyState message={emptyMessage} />
      ) : (
        <div className="space-y-3">
          {rows.map((row, i) => (
            <MetricBar
              key={row.key}
              label={row.label}
              value={row.count}
              max={max}
              color={series[(i + colorOffset) % series.length]}
              sublabel={String(row.count)}
            />
          ))}
        </div>
      )}
    </GlassPanel>
  )
}

export default SessionBreakdownPanel
