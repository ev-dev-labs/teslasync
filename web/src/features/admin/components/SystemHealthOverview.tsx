/**
 * System page — health-at-a-glance KPI band.
 *
 * Full-width responsive metric grid summarising the two operator feeds the
 * page renders in detail below: the rate-limit budgets (`/system/rate-limits`)
 * and the background-worker fleet (`/system/queues`). Six metrics roll the raw
 * scope + worker rows into command-center headline numbers:
 *
 *   • throttle budgets tracked + worst severity
 *   • peak budget usage across every window
 *   • healthy / total workers reporting heartbeats
 *   • combined queue backlog (pending + in-progress)
 *   • jobs succeeded in the last 24h
 *   • jobs failed terminally in the last 24h
 *
 * The band consumes the SAME TanStack queries the page owns (passed in as
 * props), so no extra network request is made — the panels below share the
 * deduped cache. Values collapse to `—` / `0` before data lands so the band
 * never disappears (design-language §8).
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Gauge, TrendingUp, ServerCog, Layers, CheckCircle2, AlertTriangle } from 'lucide-react'

import { MetricCard } from '@/components/data-display'
import { Skeleton } from '@/components/feedback'
import { fmtInt, fmtPercent } from '@/lib/numberFormat'
import type { NeonColor } from '@/lib/tokens'
import type { useRateLimitStatus } from '@/api/hooks/useSystem'
import type { useQueueStatus } from '@/api/hooks/useSystemQueues'
import type { RateLimitSeverity } from '@/api/types'

type RateLimitQuery = ReturnType<typeof useRateLimitStatus>
type QueueQuery = ReturnType<typeof useQueueStatus>

const RATE_SEVERITY_RANK: Record<RateLimitSeverity, number> = {
  ok: 0,
  warn: 1,
  critical: 2,
}

const RATE_SEVERITY_COLOR: Record<RateLimitSeverity, NeonColor> = {
  ok: 'green',
  warn: 'amber',
  critical: 'red',
}

/** Green < 50% ≤ amber < 80% ≤ red — mirrors the MetricBar thresholds. */
function usageColor(pct: number): NeonColor {
  if (pct >= 80) return 'red'
  if (pct >= 50) return 'amber'
  return 'green'
}

export interface SystemHealthOverviewProps {
  rateLimit: RateLimitQuery
  queue: QueueQuery
}

export function SystemHealthOverview({ rateLimit, queue }: SystemHealthOverviewProps) {
  const { t } = useTranslation()

  const scopes = rateLimit.data?.scopes ?? []
  const workers = queue.data?.workers ?? []

  const hasRate = rateLimit.data != null
  const hasQueue = queue.data != null

  const worstRateSeverity = useMemo<RateLimitSeverity>(
    () =>
      scopes.reduce<RateLimitSeverity>(
        (worst, s) =>
          RATE_SEVERITY_RANK[s.severity] > RATE_SEVERITY_RANK[worst] ? s.severity : worst,
        'ok',
      ),
    [scopes],
  )

  const peakUsagePct = useMemo(
    () =>
      scopes.reduce((mx, s) => {
        const limit = s.limit ?? 0
        const pct = limit > 0 ? ((s.current ?? 0) / limit) * 100 : 0
        return pct > mx ? pct : mx
      }, 0),
    [scopes],
  )

  const queueTotals = useMemo(
    () =>
      workers.reduce(
        (acc, w) => {
          acc.workerCount += 1
          if (w.heartbeat_severity === 'ok') acc.healthy += 1
          acc.backlog += (w.pending ?? 0) + (w.in_progress ?? 0)
          acc.succeeded += w.succeeded_24h ?? 0
          acc.failed += w.failed_24h ?? 0
          return acc
        },
        { workerCount: 0, healthy: 0, backlog: 0, succeeded: 0, failed: 0 },
      ),
    [workers],
  )

  const dash = '—'

  // Show the skeleton band only while nothing has landed yet; once either feed
  // has data we render live cards (the still-loading side shows `—`).
  const initialLoading =
    !hasRate && !hasQueue && (rateLimit.isLoading || queue.isLoading)

  if (initialLoading) {
    return (
      <div
        className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 3xl:grid-cols-6"
        data-testid="system-overview-loading"
        role="status"
        aria-busy="true"
        aria-label={t('system.overview.loading', 'Loading system health…')}
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} height={92} />
        ))}
      </div>
    )
  }

  const budgetSubtitle =
    scopes.length === 0
      ? t('system.overview.noBudgets', 'No active budgets')
      : t(`rateLimitStatus.severity.${worstRateSeverity}`, worstRateSeverity)

  const workersColor: NeonColor =
    queueTotals.workerCount === 0
      ? 'cyan'
      : queueTotals.healthy === queueTotals.workerCount
        ? 'green'
        : 'amber'

  return (
    <div
      className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 3xl:grid-cols-6"
      data-testid="system-overview"
    >
      <MetricCard
        label={t('system.overview.throttleBudgets', 'Throttle budgets')}
        value={hasRate ? fmtInt(scopes.length) : dash}
        subtitle={hasRate ? budgetSubtitle : t('system.overview.awaiting', 'Awaiting data')}
        icon={<Gauge className="h-5 w-5" aria-hidden="true" />}
        color={hasRate && scopes.length > 0 ? RATE_SEVERITY_COLOR[worstRateSeverity] : 'cyan'}
      />
      <MetricCard
        label={t('system.overview.peakUsage', 'Peak budget usage')}
        value={hasRate ? fmtPercent(peakUsagePct, 0) : dash}
        subtitle={t('system.overview.peakUsageHint', 'Of the tightest window')}
        icon={<TrendingUp className="h-5 w-5" aria-hidden="true" />}
        color={hasRate ? usageColor(peakUsagePct) : 'cyan'}
      />
      <MetricCard
        label={t('system.overview.activeWorkers', 'Active workers')}
        value={
          hasQueue ? `${fmtInt(queueTotals.healthy)} / ${fmtInt(queueTotals.workerCount)}` : dash
        }
        subtitle={t('system.overview.activeWorkersHint', 'Reporting heartbeats')}
        icon={<ServerCog className="h-5 w-5" aria-hidden="true" />}
        color={hasQueue ? workersColor : 'cyan'}
      />
      <MetricCard
        label={t('system.overview.backlog', 'Queue backlog')}
        value={hasQueue ? fmtInt(queueTotals.backlog) : dash}
        subtitle={t('system.overview.backlogHint', 'Pending + in progress')}
        icon={<Layers className="h-5 w-5" aria-hidden="true" />}
        color="blue"
      />
      <MetricCard
        label={t('system.overview.succeeded', 'Succeeded 24h')}
        value={hasQueue ? fmtInt(queueTotals.succeeded) : dash}
        subtitle={t('system.overview.succeededHint', 'Jobs completed')}
        icon={<CheckCircle2 className="h-5 w-5" aria-hidden="true" />}
        color="green"
      />
      <MetricCard
        label={t('system.overview.failed', 'Failed 24h')}
        value={hasQueue ? fmtInt(queueTotals.failed) : dash}
        subtitle={t('system.overview.failedHint', 'Terminal failures')}
        icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
        color={hasQueue && queueTotals.failed > 0 ? 'red' : 'green'}
      />
    </div>
  )
}

export default SystemHealthOverview
