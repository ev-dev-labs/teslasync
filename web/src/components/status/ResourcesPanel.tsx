/**
 * ResourcesPanel — server resources at-a-glance.
 *
 * Renders rows for memory, runtime threads (goroutines), DB pool,
 * uptime, and any custom rows the caller supplies. Each row uses a
 * progress bar where a max value is supplied; otherwise just label
 * + value. Utilization warns at 70% and is critical at 90%; worker health
 * uses validated counts independently of the source's data trust.
 *
 * NOTE: CPU% and disk usage are not yet exposed by the backend
 * (would need /system/resources with gopsutil or syscall.Statfs).
 */

import { type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CheckCircle, HelpCircle, XCircle } from 'lucide-react'
import { type DataState } from '@/api/dataState'
import { QueryError } from '@/components/feedback/QueryError'
import { Skeleton } from '@/components/feedback/Skeleton'
import { StaleRefreshWarning } from '@/components/feedback/StaleRefreshWarning'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { Text } from '@/components/ui/Typography'
import { cn } from '@/lib/cn'
import { neonColorMap, typography } from '@/lib/tokens'

interface ResourceRowPresentation {
  label: string
  /** Display string for the value (e.g. "1.8 GB"). */
  valueText: string
  /** Optional sub-label (e.g. "of 8 GB"). */
  metaText?: string
  icon?: ReactNode
  sourceState?: DataState<unknown>
  barAriaLabel?: string
  statusText?: string
}

export type ResourceRow = ResourceRowPresentation & (
  | {
      metricKind?: 'utilization'
      /** Percent 0-100 used to render a horizontal bar. Omit to skip the bar. */
      percent?: number
      healthyCount?: never
      totalCount?: never
    }
  | {
      metricKind: 'healthy-workers'
      healthyCount: number | null
      totalCount: number | null
      percent?: never
    }
)

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
  title,
  emptyText,
  id,
  className,
}: ResourcesPanelProps) {
  const { t } = useTranslation()
  const safeRows = rows ?? []

  return (
    <GlassPanel id={id} className={cn('p-4', className)}>
      <Text as="h3" variant="subhead" className="mb-3 break-words">
        {title ?? t('resourcesPanel.title', 'Resources')}
      </Text>

      {safeRows.length > 0 ? (
        <div className="space-y-3">
          {safeRows.map((row) => (
            <ResourceRowItem key={row.label} row={row} />
          ))}
        </div>
      ) : (
        <Text as="p" variant="caption" role="status">
          {emptyText ?? t('resourcesPanel.emptyText', 'No resource metrics available')}
        </Text>
      )}

      {footnote && (
        <Text as="div" variant="caption" className="mt-3 min-w-0 break-words">{footnote}</Text>
      )}
    </GlassPanel>
  )
}

function ResourceRowItem({ row }: { row: ResourceRow }) {
  const { t } = useTranslation()
  const state = row.sourceState
  const unresolved = state != null && !state.hasData
  const healthMetric = row.metricKind === 'healthy-workers'
  const validHealth = healthMetric
    && row.healthyCount != null && row.totalCount != null
    && Number.isSafeInteger(row.healthyCount) && Number.isSafeInteger(row.totalCount)
    && row.healthyCount >= 0 && row.totalCount > 0
    && row.healthyCount <= row.totalCount
  // Guard against non-finite values (NaN / ±Infinity from upstream divisions)
  // and clamp to [0,100] so the bar width and the ARIA value never disagree.
  const percent =
    unresolved ? null
    : healthMetric
      ? validHealth ? row.healthyCount! / row.totalCount! * 100 : null
      : row.percent != null && Number.isFinite(row.percent)
        ? Math.max(0, Math.min(100, row.percent))
        : null
  const severity =
    percent == null ? 'unknown'
    : healthMetric
      ? row.healthyCount === row.totalCount ? 'healthy'
        : row.healthyCount === 0 ? 'critical' : 'warn'
    : percent >= 90 ? 'critical'
    : percent >= 70 ? 'warn'
    : 'normal'

  const barColor =
    severity === 'critical' ? neonColorMap.red.dot
    : severity === 'warn'   ? neonColorMap.amber.dot
    : severity === 'healthy' ? neonColorMap.green.dot
    : neonColorMap.neutral.dot

  const textColor =
    severity === 'critical' ? neonColorMap.red.text
    : severity === 'warn'   ? neonColorMap.amber.text
    : severity === 'healthy' ? neonColorMap.green.text
    : typography.color.primary

  const StatusIcon = severity === 'critical' ? XCircle
    : severity === 'warn' ? AlertTriangle
    : severity === 'healthy' ? CheckCircle : HelpCircle
  const defaultStatus = unresolved
    ? t('dataSources.status.loading', 'Loading')
    : severity === 'healthy' ? t('Healthy', 'Healthy')
    : severity === 'warn' ? healthMetric ? t('Degraded', 'Degraded') : t('severity.warn', 'Warning')
    : severity === 'critical' ? t('common.critical', 'Critical')
    : severity === 'unknown' ? t('common.unknown', 'Unknown')
    : t('common.normal', 'Normal')

  if (unresolved && state.fatalError != null) {
    return (
      <div className="min-w-0 space-y-2">
        <Text as="span" variant="bodySm" className="break-words">{row.label}</Text>
        <QueryError error={state.fatalError} onRetry={state.retry ?? undefined} resourceName={row.label} compact />
      </div>
    )
  }

  return (
    <div className="min-w-0 space-y-2">
      {state != null && <StaleRefreshWarning state={state} label={row.label} />}
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        {row.icon && (
          <span className={cn('shrink-0', typography.color.secondary)} aria-hidden>{row.icon}</span>
        )}
        <Text as="span" variant="bodySm" className="min-w-0 flex-1 break-words">{row.label}</Text>
        <Text as="span" variant="body" className={cn('min-w-0 max-w-full break-words tabular-nums', textColor)}>
          {unresolved ? <Skeleton className="h-4 w-20" /> : row.valueText}
          {!unresolved && row.metaText && (
            <Text as="span" variant="caption" className="ms-1">
              {row.metaText}
            </Text>
          )}
        </Text>
      </div>
      {(healthMetric || percent != null || unresolved || row.statusText != null) && (
        <Text as="span" variant="caption" className="flex min-w-0 items-center gap-1 break-words">
          <StatusIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {unresolved ? defaultStatus : row.statusText ?? defaultStatus}
        </Text>
      )}
      {percent != null && (
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-3)]"
          role="progressbar"
          aria-valuenow={Math.round(percent)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={row.barAriaLabel ?? (healthMetric
            ? t('resourcesPanel.healthyWorkersBarLabel', '{{label}} health', { label: row.label })
            : t('resourcesPanel.utilizationBarLabel', '{{label}} usage', { label: row.label }))}
        >
          <div
            className={cn('h-full transition-all duration-fast motion-reduce:transition-none', barColor)}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
    </div>
  )
}
