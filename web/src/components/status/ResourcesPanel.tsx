/**
 * ResourcesPanel — server resources at-a-glance.
 *
 * Renders rows for memory, runtime threads (goroutines), DB pool,
 * uptime, and any custom rows the caller supplies. Each row uses a
 * progress bar where a max value is supplied; otherwise just label
 * + value. Status driven by % thresholds (warn 70%, critical 90%).
 *
 * NOTE: CPU% and disk usage are not yet exposed by the backend
 * (would need /system/resources with gopsutil or syscall.Statfs).
 */

import { type ReactNode } from 'react'
import { GlassPanel, Text } from '@/components/ui'
import { cn } from '@/lib/cn'

export interface ResourceRow {
  label: string
  /** Display string for the value (e.g. "1.8 GB"). */
  valueText: string
  /** Optional sub-label (e.g. "of 8 GB"). */
  metaText?: string
  /** Percent 0-100 used to render a horizontal bar. Omit to skip the bar. */
  percent?: number
  icon?: ReactNode
}

export interface ResourcesPanelProps {
  rows: ResourceRow[]
  /** Optional footnote rendered beneath the rows. */
  footnote?: ReactNode
  /** Panel heading. Defaults to "Resources". Pass a translated string at the call site. */
  title?: string
  /** Message shown when `rows` is empty. Defaults to "No resource metrics available". */
  emptyText?: string
  id?: string
  className?: string
}

export function ResourcesPanel({
  rows,
  footnote,
  title = 'Resources',
  emptyText = 'No resource metrics available',
  id,
  className,
}: ResourcesPanelProps) {
  const safeRows = rows ?? []

  return (
    <GlassPanel id={id} className={cn('p-4', className)}>
      <Text as="h3" size="sm" weight="semibold" color="primary" className="mb-3">{title}</Text>

      {safeRows.length > 0 ? (
        <div className="space-y-3">
          {safeRows.map((row) => (
            <ResourceRowItem key={row.label} row={row} />
          ))}
        </div>
      ) : (
        <Text as="p" variant="caption" role="status">{emptyText}</Text>
      )}

      {footnote && (
        <Text as="div" variant="caption" className="mt-3">{footnote}</Text>
      )}
    </GlassPanel>
  )
}

function ResourceRowItem({ row }: { row: ResourceRow }) {
  // Guard against non-finite values (NaN / ±Infinity from upstream divisions)
  // and clamp to [0,100] so the bar width and the ARIA value never disagree.
  const percent =
    row.percent != null && Number.isFinite(row.percent)
      ? Math.max(0, Math.min(100, row.percent))
      : null
  const severity =
    percent == null ? 'normal'
    : percent >= 90 ? 'critical'
    : percent >= 70 ? 'warn'
    : 'normal'

  const barColor =
    severity === 'critical' ? 'bg-red-400'
    : severity === 'warn'   ? 'bg-amber-400'
    : 'bg-green-400'

  const textColor =
    severity === 'critical' ? 'text-red-400'
    : severity === 'warn'   ? 'text-amber-400'
    : 'text-[var(--text-primary)]'

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-3">
        {row.icon && (
          <span className="shrink-0 text-[var(--text-secondary)]" aria-hidden>{row.icon}</span>
        )}
        <Text as="span" size="sm" color="secondary" className="flex-1 truncate">{row.label}</Text>
        <Text as="span" size="sm" weight="medium" className={cn('shrink-0 tabular-nums', textColor)}>
          {row.valueText}
          {row.metaText && (
            <Text as="span" size="xs" weight="regular" color="muted" className="ml-1">
              {row.metaText}
            </Text>
          )}
        </Text>
      </div>
      {percent != null && (
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]"
          role="progressbar"
          aria-valuenow={Math.round(percent)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${row.label} usage`}
        >
          <div
            className={cn('h-full transition-all duration-slow', barColor)}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
    </div>
  )
}
