/**
 * UptimeHeatmap — rolling N-day status grid.
 *
 * Renders one square per day, oldest on the left. Hover/tap reveals
 * the day's status + (optional) summary in a Popover. Caption shows
 * overall uptime % across the window.
 *
 * Phase 1 callers typically pass synthesised data (today = current
 * status, prior days = healthy by default) until the backend gains
 * a real day-by-day health-history endpoint in Phase 2.
 */

import { useMemo } from 'react'
import { GlassPanel, Tooltip } from '@/components/ui'
import { cn } from '@/lib/cn'
import { fmtPercent } from '@/lib/numberFormat'
import type { HeroStatus } from './StatusHero'

export interface UptimeDay {
  /** ISO date (yyyy-mm-dd). */
  date: string
  status: HeroStatus
  /** Optional short description shown inside the popover. */
  summary?: string
}

export interface UptimeHeatmapProps {
  days: UptimeDay[]
  /** Title text — defaults to "Uptime — last N days". */
  title?: string
  /** Footnote text shown beneath the squares. */
  footnote?: string
  className?: string
  id?: string
}

const SQUARE_BG: Record<HeroStatus, string> = {
  healthy:     'bg-green-400/80 hover:bg-green-300',
  degraded:    'bg-amber-400/80 hover:bg-amber-300',
  unhealthy:   'bg-red-400/80 hover:bg-red-300',
  unknown:     'bg-zinc-500/40 hover:bg-zinc-400/60',
  maintenance: 'bg-blue-400/80 hover:bg-blue-300',
}

const STATUS_LABEL: Record<HeroStatus, string> = {
  healthy: 'Operational',
  degraded: 'Degraded',
  unhealthy: 'Outage',
  unknown: 'Unknown',
  maintenance: 'Maintenance',
}

export function UptimeHeatmap({
  days,
  title,
  footnote,
  className,
  id,
}: UptimeHeatmapProps) {
  const uptimePct = useMemo(() => {
    if (days.length === 0) return null
    const healthy = days.filter((d) => d.status === 'healthy' || d.status === 'maintenance').length
    return (healthy / days.length) * 100
  }, [days])

  const heading = title ?? `Uptime — last ${days.length} days`

  return (
    <GlassPanel id={id} className={cn('p-4', className)}>
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{heading}</h3>
        {uptimePct != null && (
          <span className={cn(
            'text-xs font-medium tabular-nums',
            uptimePct >= 99 ? 'text-green-400'
            : uptimePct >= 95 ? 'text-amber-400'
            : 'text-red-400',
          )}>
            {fmtPercent(uptimePct, 2)} uptime
          </span>
        )}
      </div>

      <div
        className="flex flex-wrap gap-1"
        role="list"
        aria-label="Daily status history"
      >
        {days.map((day) => (
          <Tooltip
            key={day.date}
            multiline
            content={
              <div className="space-y-1">
                <div className="text-xs font-semibold">{day.date}</div>
                <div className="text-xs">{STATUS_LABEL[day.status]}</div>
                {day.summary && (
                  <div className="text-xs pt-1 border-t border-white/[0.06]">
                    {day.summary}
                  </div>
                )}
              </div>
            }
          >
            <button
              type="button"
              role="listitem"
              aria-label={`${day.date}: ${STATUS_LABEL[day.status]}`}
              className={cn(
                'h-3 w-3 shrink-0 rounded-sm transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60',
                SQUARE_BG[day.status],
              )}
            />
          </Tooltip>
        ))}
      </div>

      {footnote && (
        <div className="mt-3 text-xs text-[var(--text-muted)]">{footnote}</div>
      )}
    </GlassPanel>
  )
}
