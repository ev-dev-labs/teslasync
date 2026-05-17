/**
 * TeslaApiUsageCard — operator-grade Tesla Fleet API spend & volume
 * detail card.
 *
 * Combines the bare-bones `/system/api-usage` snapshot (this-month
 * total + cost) with the richer `/api-logs/stats` payload (last 24h
 * burn, avg latency, error rate, by-method and by-service splits)
 * to give the operator the answers they actually need:
 *   - Am I burning faster than the monthly credit allows?
 *   - When does the billing window reset?
 *   - What's eating the budget — which service / method?
 *   - Are recent calls healthy (latency, error rate)?
 *
 * Phase-50 / 0004 — F3 refactor: the JSX skeleton (budget bar, bands,
 * detail grid, top-lists, banner, footer) is delegated to the shared
 * `<UsageCard>` primitive in components/data-display so this card
 * (and the new AiUsageCard) share one visual contract. This file's
 * sole job is now to derive the props from the two API hooks.
 */

import { useMemo } from 'react'
import { Activity, TrendingUp, Zap, Clock } from 'lucide-react'
import { useApiLogStats } from '@/api/hooks/useAdmin'
import { useFormatting } from '@/hooks/useFormatting'
import {
  UsageCard,
  type UsageCardBand,
  type UsageCardDetail,
  type UsageCardTopList,
  type UsageCardTopListItem,
  type UsageCardIntent,
} from '@/components/data-display'
import type { APIUsage } from '@/api/types'
import { fmtInt, fmtPercent } from '@/lib/numberFormat'

interface TeslaApiUsageCardProps {
  apiUsage: APIUsage | undefined
  /** "now" passed in so the page-level tick re-renders the countdown. */
  now: number
}

function startOfMonth(now: number): Date {
  const d = new Date(now)
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function endOfMonth(now: number): Date {
  const d = new Date(now)
  return new Date(d.getFullYear(), d.getMonth() + 1, 1)
}

function fmtCount(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return fmtInt(n)
}

// camelCaseKeys() in lib/resilience.ts mirrors snake_case JSON to BOTH
// snake_case and camelCase keys (recursively, including inside maps).
// For grouped breakdowns like by_service we therefore see e.g.
// { tesla_fleet: 28000, teslaFleet: 28000 } — we collapse the
// camelCase clones so the UI doesn't render duplicate rows.
function dedupeMap(m: Record<string, number> | undefined): Array<[string, number]> {
  if (!m) return []
  const entries = Object.entries(m)
  const snakeKeys = entries.filter(([k]) => k.includes('_')).map(([k]) => k)
  const aliases = new Set(
    snakeKeys.map((sk) =>
      sk.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase()),
    ),
  )
  const out: Array<[string, number]> = []
  const seen = new Set<string>()
  for (const [k, v] of entries) {
    if (aliases.has(k) && !k.includes('_')) continue
    const norm = k.toLowerCase().replace(/_/g, '')
    if (seen.has(norm)) continue
    seen.add(norm)
    out.push([k, v])
  }
  return out
}

export function TeslaApiUsageCard({ apiUsage, now }: TeslaApiUsageCardProps) {
  const { data: logStats } = useApiLogStats()
  const { formatCurrency } = useFormatting()

  const derived = useMemo(() => {
    if (!apiUsage) return null

    const monthStart = startOfMonth(now).getTime()
    const monthEnd = endOfMonth(now).getTime()
    const totalDaysInMonth = Math.ceil((monthEnd - monthStart) / (24 * 60 * 60 * 1000))
    const daysElapsed = Math.max(1, Math.ceil((now - monthStart) / (24 * 60 * 60 * 1000)))
    const daysRemaining = Math.max(0, totalDaysInMonth - daysElapsed)

    const pctOfBudget = apiUsage.monthly_credit > 0
      ? (apiUsage.estimated_cost / apiUsage.monthly_credit) * 100
      : 0

    const dailyAvgCost = apiUsage.estimated_cost / daysElapsed
    const dailyAvgRequests = apiUsage.total_requests / daysElapsed

    // Forecast end-of-month using two methods:
    //   - Linear extrapolation of month-to-date average
    //   - Last 24h burn rate × full month
    const forecastFromMtd = dailyAvgCost * totalDaysInMonth
    const last24hBurn = (logStats?.last24h ?? 0) * apiUsage.cost_per_request
    const forecastFromRecent = last24hBurn * totalDaysInMonth

    return {
      daysElapsed,
      daysRemaining,
      totalDaysInMonth,
      pctOfBudget,
      dailyAvgCost,
      dailyAvgRequests,
      forecastFromMtd,
      forecastFromRecent,
      last24hBurn,
    }
  }, [apiUsage, logStats, now])

  if (!apiUsage || !derived) {
    return (
      <UsageCard emptyMessage="Tesla API usage data is not available yet." />
    )
  }

  const overBudget = apiUsage.estimated_cost > apiUsage.monthly_credit
  const budgetIntent: UsageCardIntent = overBudget
    ? 'danger'
    : derived.pctOfBudget > 80
      ? 'warn'
      : 'normal'

  // Top 3 services by call count
  const topServices = dedupeMap(logStats?.by_service)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)

  const methodEntries = dedupeMap(logStats?.by_method).sort((a, b) => b[1] - a[1])

  const usefulRequests = apiUsage.total_requests - apiUsage.skipped_polls
  // Backend returns error_rate as a PERCENTAGE already (errorCount/total*100)
  const errorPct = logStats?.errorRate != null ? logStats.errorRate : null

  const bands: UsageCardBand[] = [
    {
      icon: <Activity className="h-3.5 w-3.5" />,
      label: 'This month',
      value: (
        <>
          {fmtCount(apiUsage.total_requests)}{' '}
          <span className="text-xs font-normal text-[var(--text-muted)]">requests</span>
        </>
      ),
      sub: `${formatCurrency(derived.dailyAvgCost)}/day avg`,
    },
    {
      icon: <Clock className="h-3.5 w-3.5" />,
      label: 'Last 24h',
      value: (
        <>
          {logStats?.last24h != null ? fmtCount(logStats.last24h) : '—'}{' '}
          <span className="text-xs font-normal text-[var(--text-muted)]">requests</span>
        </>
      ),
      sub: `${formatCurrency(derived.last24hBurn)}/day burn`,
    },
    {
      icon: <TrendingUp className="h-3.5 w-3.5" />,
      label: 'Forecast EOM',
      value: formatCurrency(derived.forecastFromMtd),
      sub: `recent rate: ${formatCurrency(derived.forecastFromRecent)}`,
      intent: derived.forecastFromMtd > apiUsage.monthly_credit ? 'danger' : 'normal',
    },
  ]

  const errorIntent: UsageCardIntent =
    errorPct != null && errorPct >= 5
      ? 'danger'
      : errorPct != null && errorPct >= 1
        ? 'warn'
        : 'normal'

  const details: UsageCardDetail[] = [
    { label: 'Useful', value: fmtCount(usefulRequests) },
    { label: 'Skipped (asleep)', value: fmtCount(apiUsage.skipped_polls) },
    {
      label: 'Avg latency',
      value:
        logStats?.avgDurationMs != null ? `${Math.round(logStats.avgDurationMs)} ms` : '—',
    },
    {
      label: 'Error rate',
      value:
        errorPct != null ? (
          <>
            {fmtPercent(errorPct, 1)}
            {logStats?.errorCount != null && (
              <span className="ml-1 text-xs text-[var(--text-muted)]">
                ({fmtCount(logStats.errorCount)})
              </span>
            )}
          </>
        ) : (
          '—'
        ),
      intent: errorIntent,
    },
  ]

  const topLists: UsageCardTopList[] = []
  if (topServices.length > 0) {
    topLists.push({
      key: 'services',
      icon: <Zap className="h-3.5 w-3.5" />,
      title: 'Top services',
      items: topServices.map<UsageCardTopListItem>(([name, count]) => ({
        key: name,
        label: name,
        value: fmtCount(count),
      })),
    })
  }
  if (methodEntries.length > 0) {
    topLists.push({
      key: 'methods',
      icon: <Activity className="h-3.5 w-3.5" />,
      title: 'By method',
      items: methodEntries.map<UsageCardTopListItem>(([method, count]) => ({
        key: method,
        label: method,
        value: fmtCount(count),
      })),
    })
  }

  return (
    <UsageCard
      budget={{
        headline: `${formatCurrency(apiUsage.estimated_cost)} of ${formatCurrency(apiUsage.monthly_credit)}`,
        rightLabel: `${fmtPercent(derived.pctOfBudget, 0)} of monthly credit`,
        caption: `Day ${derived.daysElapsed} of ${derived.totalDaysInMonth} ·${
          derived.daysRemaining === 0
            ? ' resets tomorrow'
            : ` resets in ${derived.daysRemaining} day${derived.daysRemaining === 1 ? '' : 's'}`
        }`,
        pct: derived.pctOfBudget,
        ariaLabel: 'Tesla API budget used',
        intent: budgetIntent,
      }}
      bands={bands}
      details={details}
      topLists={topLists}
      banner={
        overBudget
          ? {
              title: 'Over monthly credit',
              description: `Spend has exceeded the ${formatCurrency(apiUsage.monthly_credit)} monthly credit by ${formatCurrency(apiUsage.estimated_cost - apiUsage.monthly_credit)}. Review polling cadence or vehicle subscriptions.`,
              intent: 'danger',
            }
          : undefined
      }
      footer={[
        { key: 'logs', to: '/api-logs', label: 'Open API Logs', primary: true },
        { key: 'tesla', to: '/tesla-account', label: 'Tesla account' },
      ]}
    />
  )
}
