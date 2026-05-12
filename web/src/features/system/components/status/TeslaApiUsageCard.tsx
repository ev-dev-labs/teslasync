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
 * Doesn't require any backend changes — all data is already exposed.
 */

import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Activity, TrendingUp, AlertTriangle, ExternalLink, Zap, Clock } from 'lucide-react'
import { useApiLogStats } from '@/api/hooks/useAdmin'
import type { APIUsage } from '@/api/types'

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

function fmtMoney(n: number, decimals = 2): string {
  if (!Number.isFinite(n)) return '—'
  return `$${n.toFixed(decimals)}`
}

function fmtCount(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString()
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
      <p className="text-sm text-[var(--text-muted)]">
        Tesla API usage data is not available yet.
      </p>
    )
  }

  const overBudget = apiUsage.estimated_cost > apiUsage.monthly_credit
  const pctClamped = Math.min(100, derived.pctOfBudget)
  const barColor = overBudget
    ? 'bg-red-500/70'
    : derived.pctOfBudget > 80
      ? 'bg-amber-500/70'
      : 'bg-cyan-500/70'

  // Top 3 services by call count
  const topServices = dedupeMap(logStats?.by_service)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)

  const methodEntries = dedupeMap(logStats?.by_method).sort((a, b) => b[1] - a[1])

  const usefulRequests = apiUsage.total_requests - apiUsage.skipped_polls
  // Backend returns error_rate as a PERCENTAGE already (errorCount/total*100)
  const errorPct = logStats?.errorRate != null ? logStats.errorRate : null

  return (
    <div className="space-y-4">
      {/* Budget progress bar */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-medium text-[var(--text-primary)]">
            {fmtMoney(apiUsage.estimated_cost)} of {fmtMoney(apiUsage.monthly_credit)}
          </span>
          <span className={overBudget ? 'text-red-400 font-semibold tabular-nums' : 'text-[var(--text-muted)] tabular-nums'}>
            {derived.pctOfBudget.toFixed(0)}% of monthly credit
          </span>
        </div>
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-white/[0.06]"
          role="progressbar"
          aria-valuenow={Math.round(derived.pctOfBudget)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Tesla API budget used"
        >
          <div
            className={`h-full transition-all ${barColor}`}
            style={{ width: `${pctClamped}%` }}
          />
        </div>
        <p className="text-xs text-[var(--text-muted)]">
          Day {derived.daysElapsed} of {derived.totalDaysInMonth} ·
          {derived.daysRemaining === 0
            ? ' resets tomorrow'
            : ` resets in ${derived.daysRemaining} day${derived.daysRemaining === 1 ? '' : 's'}`}
        </p>
      </div>

      {/* This month / Last 24h / Forecast — three at-a-glance bands */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-lg bg-white/[0.03] p-3">
          <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-[var(--text-muted)]">
            <Activity className="h-3.5 w-3.5" /> This month
          </div>
          <div className="mt-1 font-semibold tabular-nums text-[var(--text-primary)]">
            {fmtCount(apiUsage.total_requests)}{' '}
            <span className="text-xs font-normal text-[var(--text-muted)]">requests</span>
          </div>
          <div className="text-xs text-[var(--text-muted)] tabular-nums">
            {fmtMoney(derived.dailyAvgCost)}/day avg
          </div>
        </div>

        <div className="rounded-lg bg-white/[0.03] p-3">
          <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-[var(--text-muted)]">
            <Clock className="h-3.5 w-3.5" /> Last 24h
          </div>
          <div className="mt-1 font-semibold tabular-nums text-[var(--text-primary)]">
            {logStats?.last24h != null ? fmtCount(logStats.last24h) : '—'}{' '}
            <span className="text-xs font-normal text-[var(--text-muted)]">requests</span>
          </div>
          <div className="text-xs text-[var(--text-muted)] tabular-nums">
            {fmtMoney(derived.last24hBurn)}/day burn
          </div>
        </div>

        <div
          className={
            'rounded-lg p-3 ' +
            (derived.forecastFromMtd > apiUsage.monthly_credit
              ? 'bg-red-500/10 ring-1 ring-red-500/30'
              : 'bg-white/[0.03]')
          }
        >
          <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-[var(--text-muted)]">
            <TrendingUp className="h-3.5 w-3.5" /> Forecast EOM
          </div>
          <div className="mt-1 font-semibold tabular-nums text-[var(--text-primary)]">
            {fmtMoney(derived.forecastFromMtd)}
          </div>
          <div className="text-xs text-[var(--text-muted)] tabular-nums">
            recent rate: {fmtMoney(derived.forecastFromRecent)}
          </div>
        </div>
      </div>

      {/* Volume detail */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm md:grid-cols-4">
        <div>
          <div className="text-xs text-[var(--text-muted)]">Useful</div>
          <div className="tabular-nums text-[var(--text-primary)]">{fmtCount(usefulRequests)}</div>
        </div>
        <div>
          <div className="text-xs text-[var(--text-muted)]">Skipped (asleep)</div>
          <div className="tabular-nums text-[var(--text-primary)]">{fmtCount(apiUsage.skipped_polls)}</div>
        </div>
        <div>
          <div className="text-xs text-[var(--text-muted)]">Avg latency</div>
          <div className="tabular-nums text-[var(--text-primary)]">
            {logStats?.avgDurationMs != null ? `${Math.round(logStats.avgDurationMs)} ms` : '—'}
          </div>
        </div>
        <div>
          <div className="text-xs text-[var(--text-muted)]">Error rate</div>
          <div
            className={
              'tabular-nums ' +
              (errorPct != null && errorPct >= 5
                ? 'text-red-400'
                : errorPct != null && errorPct >= 1
                  ? 'text-amber-300'
                  : 'text-[var(--text-primary)]')
            }
          >
            {errorPct != null ? `${errorPct.toFixed(1)}%` : '—'}
            {logStats?.errorCount != null && (
              <span className="ml-1 text-xs text-[var(--text-muted)]">
                ({fmtCount(logStats.errorCount)})
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Top services + method split */}
      {(topServices.length > 0 || methodEntries.length > 0) && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {topServices.length > 0 && (
            <div className="rounded-lg bg-white/[0.03] p-3">
              <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-[var(--text-muted)]">
                <Zap className="h-3.5 w-3.5" /> Top services
              </div>
              <ul className="mt-2 space-y-1 text-sm">
                {topServices.map(([name, count]) => (
                  <li key={name} className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-xs text-[var(--text-secondary)]">{name}</span>
                    <span className="tabular-nums text-[var(--text-primary)]">{fmtCount(count)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {methodEntries.length > 0 && (
            <div className="rounded-lg bg-white/[0.03] p-3">
              <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-[var(--text-muted)]">
                <Activity className="h-3.5 w-3.5" /> By method
              </div>
              <ul className="mt-2 space-y-1 text-sm">
                {methodEntries.map(([method, count]) => (
                  <li key={method} className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-[var(--text-secondary)]">{method}</span>
                    <span className="tabular-nums text-[var(--text-primary)]">{fmtCount(count)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Over-budget call-out */}
      {overBudget && (
        <div
          className="flex items-start gap-2 rounded-lg bg-red-500/10 p-3 text-sm text-red-200 ring-1 ring-red-500/30"
          role="status"
          aria-live="polite"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>
            <div className="font-semibold">Over monthly credit</div>
            <div className="text-xs text-red-300/80">
              Spend has exceeded the {fmtMoney(apiUsage.monthly_credit)} monthly credit by{' '}
              {fmtMoney(apiUsage.estimated_cost - apiUsage.monthly_credit)}. Review polling cadence
              or vehicle subscriptions.
            </div>
          </div>
        </div>
      )}

      {/* Footer links */}
      <div className="flex flex-wrap gap-2 pt-2 border-t border-white/[0.06]">
        <Link
          to="/api-logs"
          className="inline-flex items-center gap-1.5 rounded-md bg-cyan-500/15 px-3 py-1.5 text-xs font-medium text-cyan-200 ring-1 ring-cyan-400/30 hover:bg-cyan-500/20 min-h-[36px]"
        >
          Open API Logs
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
        <Link
          to="/tesla-account"
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-cyan-300 hover:text-cyan-200 hover:bg-white/[0.04] min-h-[36px]"
        >
          Tesla account
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  )
}
