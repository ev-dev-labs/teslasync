/**
 * AnomalyInlineRow — surfaces the most recent anomaly detected for the
 * primary vehicle as a Health row. Renders nothing when there are no
 * anomalies in the last 24h or no vehicles to query, only when the
 * source has successfully confirmed that absence.
 *
 * We don't poll all vehicles (would be N requests). For a self-hosted
 * single-operator instance the
 * common case is one or two vehicles; we use the first one as a sample.
 * Click-through routes to the dedicated /anomaly-detection page where
 * the operator can pick a vehicle.
 */

import { Activity } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { request } from '@/api/client'
import { STALE_TIMES } from '@/lib/constants'
import { useVehicles } from '@/api/hooks/useVehicles'
import { HealthRow } from '@/components/status'
import { Button } from '@/components/ui'
import { QueryError, StaleRefreshWarning } from '@/components/feedback'
import { useDataState } from '@/hooks/useDataState'
import type { AnomalyData, AnomalyEntry } from '@/api/hooks/useAnomalies'

const SEVERITY_TO_STATUS = {
  critical: 'unhealthy' as const,
  warning: 'degraded' as const,
  info: 'unknown' as const,
}

function formatRelative(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return 'recently'
  const secs = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (secs < 60) return `${secs}s ago`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

export function AnomalyInlineRow() {
  const { t } = useTranslation()
  const vehiclesQuery = useVehicles()
  const { data: vehicles } = vehiclesQuery
  const vehicleState = useDataState(vehiclesQuery)
  const firstVehicleId = vehicles?.[0]?.id != null ? String(vehicles[0].id) : null

  const query = useQuery<AnomalyData>({
    queryKey: ['system-status', 'anomalies-summary', firstVehicleId],
    queryFn: ({ signal }) =>
      request<AnomalyData>(`/analytics/anomalies?vehicle_id=${firstVehicleId}&days=1`, { signal }),
    enabled: firstVehicleId !== null,
    staleTime: STALE_TIMES.SLOW,
  })
  const { data } = query
  const state = useDataState(query, { provenance: 'historical' })
  const label = t('anomaly.count', 'Anomalies')
  const vehicleAbsenceConfirmed = vehiclesQuery.isSuccess
    && vehicleState.status === 'ok' && !vehicleState.isRefreshing
    && vehicles?.length === 0
  const anomalyAbsenceConfirmed = query.isSuccess
    && state.status === 'ok' && !state.isRefreshing
    && vehicleState.status === 'ok' && !vehicleState.isRefreshing
    && (data?.anomalies_last_24h === 0 || data?.anomalies?.length === 0)

  if (vehicleAbsenceConfirmed || anomalyAbsenceConfirmed) return null

  const top: AnomalyEntry | undefined = data?.anomalies_last_24h !== 0
    ? data?.anomalies?.[0]
    : undefined
  const activeState = firstVehicleId === null ? vehicleState : state
  const activeQuery = firstVehicleId === null ? vehiclesQuery : query
  const loading = activeQuery.isLoading && !activeState.hasData
  const summary = top && data
    ? `${data.anomalies_last_24h} in 24h · ${top.signal} ${formatRelative(top.detected_at)}`
    : loading ? t('common.loading', 'Loading...') : t('common.unknown', 'Unknown')

  return (
    <div aria-busy={loading || undefined}>
      <HealthRow
        status={top ? SEVERITY_TO_STATUS[top.severity] : 'unknown'}
        icon={<Activity className="h-4 w-4" />}
        label={label}
        summary={summary}
        to="/anomaly-detection"
      />
      <StaleRefreshWarning state={vehicleState} label={label} />
      {firstVehicleId !== null && <StaleRefreshWarning state={state} label={label} />}
      {vehicleState.fatalError && <QueryError compact error={vehicleState.fatalError} onRetry={vehicleState.retry ?? undefined} />}
      {firstVehicleId !== null && state.fatalError && <QueryError compact error={state.fatalError} onRetry={state.retry ?? undefined} />}
      {!activeState.hasData && activeState.isRefreshBlocked && !activeState.fatalError && (
        <Button type="button" variant="ghost" onClick={activeState.retry ?? undefined}>
          {t('common.refresh', 'Refresh')}
        </Button>
      )}
    </div>
  )
}
