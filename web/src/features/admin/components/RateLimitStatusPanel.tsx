/**
 * Rate-limit status panel.
 *
 * Admin status panel that renders one MetricBar per ScopeBudget the
 * backend reports under GET /api/v1/system/rate-limits. Bars climb as
 * the rolling-window or token-bucket budget fills; severity comes
 * straight from the backend so threshold tuning is a single Go ship.
 *
 * Auto-refresh and "pause when hidden" semantics live inside
 * useRateLimitStatus — this component is purely presentational so
 * Storybook / tests can drive it with stub data.
 */

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw, AlertTriangle } from 'lucide-react'

import { GlassPanel, Button, Heading, Text, Caption } from '@/components/ui'
import { MetricBar } from '@/components/data-display'
import { ListSkeleton } from '@/components/feedback'
import { formatCurrencyValue } from '@/lib/currencyFormat'
import { fmtNumber, getGlobalLocale } from '@/lib/numberFormat'
import { formatRelative, formatDurationMsLong } from '@/lib/dateFormat'
import {
  useRateLimitStatus,
} from '@/api/hooks/useSystem'
import type { RateLimitSeverity, ScopeBudget } from '@/api/types'

// Severity → hex colour passed into MetricBar (which expects a raw
// string for its dynamic gradient + glow). Using hex here rather than
// CSS variables keeps the gradient maths inside MetricBar working
// without a runtime lookup; the audit:inline-style guard tolerates
// dynamic per-row colour values per the chart-colour exception.
const SEVERITY_COLOR: Record<RateLimitSeverity, string> = {
  ok: '#10b981',       // emerald-500
  warn: '#f59e0b',     // amber-500
  critical: '#ef4444', // red-500
}

const SEVERITY_TONE_CLASS: Record<RateLimitSeverity, string> = {
  ok: 'text-emerald-300',
  warn: 'text-amber-300',
  critical: 'text-rose-300',
}

interface RateLimitRowProps {
  scope: ScopeBudget
}

function RateLimitRow({ scope }: RateLimitRowProps) {
  const { t } = useTranslation()
  const color = SEVERITY_COLOR[scope.severity]
  const toneClass = SEVERITY_TONE_CLASS[scope.severity]

  const formatValue = (value: number) =>
    scope.unit === 'usd'
      ? formatCurrencyValue(value, 'USD', getGlobalLocale(), 3, { useGrouping: true })
      : fmtNumber(value)
  const usageLabel = t('rateLimitStatus.usage', '{{current}} / {{limit}}', {
    current: formatValue(scope.current),
    limit: formatValue(scope.limit),
  })

  const windowLabel = useMemo(() => {
    if (scope.unit === 'usd') {
      return t('rateLimitStatus.windowUtcDay', 'UTC day')
    }
    if (!scope.window_seconds || scope.window_seconds <= 0) {
      return t('rateLimitStatus.windowInstant', 'Live snapshot')
    }
    return t('rateLimitStatus.windowSeconds', 'Last {{seconds}}s window', {
      seconds: scope.window_seconds,
    })
  }, [scope.unit, scope.window_seconds, t])

  const resetLabel = useMemo(() => {
    if (!scope.reset_at) return null
    const ms = new Date(scope.reset_at).getTime() - Date.now()
    if (!Number.isFinite(ms) || ms <= 0) return null
    const key = scope.unit === 'usd'
      ? 'rateLimitStatus.budgetResetIn'
      : 'rateLimitStatus.resetIn'
    const fallback = scope.unit === 'usd'
      ? 'Resets in {{duration}}'
      : 'Refills in {{duration}}'
    return t(key, fallback, {
      duration: formatDurationMsLong(ms),
    })
  }, [scope.reset_at, scope.unit, t])

  const severityLabel = t(
    `rateLimitStatus.severity.${scope.severity}`,
    scope.severity,
  )

  return (
    <div data-testid={`rate-limit-row-${scope.id}`} className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <Text variant="bodySm" className="font-medium">
          {scope.name}
        </Text>
        <Text
          variant="caption"
          className={toneClass}
          data-testid={`rate-limit-severity-${scope.id}`}
        >
          {severityLabel}
        </Text>
      </div>
      <MetricBar
        value={scope.current}
        max={scope.limit > 0 ? scope.limit : 1}
        color={color}
        label={windowLabel}
        sublabel={usageLabel}
      />
      {scope.detail || resetLabel ? (
        <div className="flex flex-wrap items-baseline justify-between gap-2 pt-1">
          {scope.detail ? (
            <Caption className="max-w-[60ch]">{scope.detail}</Caption>
          ) : (
            <span aria-hidden />
          )}
          {resetLabel ? (
            <Caption className="text-[var(--text-muted)]">{resetLabel}</Caption>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export interface RateLimitStatusPanelProps {
  /** Override the auto-refresh hook for Storybook / tests. */
  testHookOverride?: ReturnType<typeof useRateLimitStatus>
}

export function RateLimitStatusPanel({ testHookOverride }: RateLimitStatusPanelProps = {}) {
  const { t } = useTranslation()
  const liveQuery = useRateLimitStatus({ enabled: !testHookOverride })
  const query = testHookOverride ?? liveQuery

  const data = query.data
  const isLoading = query.isLoading
  const isFetching = query.isFetching
  const error = query.error
  const refetch = query.refetch

  const scopes = data?.scopes ?? []
  const warnings = data?.warnings ?? []

  const updatedLabel = useMemo(() => {
    if (!data?.generated_at) return null
    return t('rateLimitStatus.lastUpdated', 'Updated {{when}}', {
      when: formatRelative(data.generated_at),
    })
  }, [data?.generated_at, t])

  return (
    <GlassPanel className="p-5" data-testid="rate-limit-status-panel">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <Heading level="panel" className="mb-1">
            {t('rateLimitStatus.title', 'Rate-limit budgets')}
          </Heading>
          <Text variant="bodySm" className="text-[var(--text-secondary)] max-w-[80ch]">
            {t(
              'rateLimitStatus.subtitle',
              'Live view of active request throttles and the shared UTC-daily Tesla Fleet API spend guard. Cost rows are conservative estimates reserved before outbound calls.',
            )}
          </Text>
          {updatedLabel ? (
            <Caption className="mt-2 block">{updatedLabel}</Caption>
          ) : null}
        </div>
        <Button
          variant="ghost"
          onClick={() => {
            void refetch()
          }}
          loading={isFetching && !isLoading}
          disabled={isFetching}
          icon={<RefreshCw className="h-4 w-4" aria-hidden />}
          data-testid="rate-limit-refresh-button"
        >
          {t('rateLimitStatus.refresh', 'Refresh')}
        </Button>
      </div>

      {warnings.length > 0 ? (
        <div
          className="mb-4 flex items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3"
          data-testid="rate-limit-warning"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden />
          <div className="space-y-1">
            {warnings.map((warning) => (
              <Text key={warning} variant="bodySm">
                {warning}
              </Text>
            ))}
          </div>
        </div>
      ) : null}

      {isLoading ? (
        <ListSkeleton
          rows={3}
          label={t('rateLimitStatus.loading', 'Loading rate-limit status…')}
          testId="rate-limit-loading"
        />
      ) : error ? (
        <div
          className="flex items-start gap-3 rounded-md border border-rose-500/30 bg-rose-500/5 p-3"
          data-testid="rate-limit-error"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" aria-hidden />
          <Text variant="error">
            {t(
              'rateLimitStatus.error',
              'Could not load rate-limit status. Check API logs and try again.',
            )}
          </Text>
        </div>
      ) : scopes.length === 0 ? (
        <Text
          variant="bodySm"
          className="text-[var(--text-secondary)] italic"
          data-testid="rate-limit-empty"
        >
          {t(
            'rateLimitStatus.empty',
            'No rate-limited resources are currently observed. Counters appear here once the API has handled at least one request.',
          )}
        </Text>
      ) : (
        <div className="space-y-5" data-testid="rate-limit-rows">
          {scopes.map((scope) => (
            <RateLimitRow key={scope.id} scope={scope} />
          ))}
        </div>
      )}
    </GlassPanel>
  )
}

export default RateLimitStatusPanel
