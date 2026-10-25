import { Icons } from '@/lib/icons';
import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge, Button as UiButton, DataTable, type Column } from '@/components/ui'
import { TimeStamp } from '@/components/data-display'
import { Skeleton, QueryError, StaleRefreshWarning, DataStateNotice } from '@/components/feedback'
import { useDataState } from '@/hooks/useDataState'
import { cn } from '@/lib/cn'
import {
  useFleetTelemetryErrorVINs, useFleetTelemetryErrors,
  useRefreshFleetTelemetryErrorVINs, useRefreshFleetTelemetryErrors,
  type FleetTelemetryErrorVIN, type FleetTelemetryError,
} from '@/api/hooks/useTelemetry'
import { ToolCard } from './ToolCard'

export function FleetTelemetryHealth() {
  const { t } = useTranslation()
  const [selectedVin, setSelectedVin] = useState('')

  const vinsQuery = useFleetTelemetryErrorVINs()
  const errorsQuery = useFleetTelemetryErrors(selectedVin || undefined)
  const vinsState = useDataState(vinsQuery)
  const errorsState = useDataState(errorsQuery)
  const refreshVINs = useRefreshFleetTelemetryErrorVINs()
  const refreshErrors = useRefreshFleetTelemetryErrors()

  const vinList = vinsState.data ?? []
  const errorList = errorsState.data ?? []

  const isRecent = (dateStr: string | null) => {
    if (!dateStr) return false
    const diff = Date.now() - new Date(dateStr).getTime()
    return diff < 24 * 60 * 60 * 1000
  }

  const vinColumns: Column<FleetTelemetryErrorVIN>[] = useMemo(() => [
    {
      key: 'vin',
      filterValue: (r) => r.vin ?? null,
      header: t('devtools.health.vin', 'VIN'),
      render: (r) => (
        <UiButton
          type="button"
          variant="ghost"
          className="!h-auto !px-0 !py-0 font-mono text-xs text-cyan-300 hover:!bg-transparent hover:underline"
          onClick={() => setSelectedVin(r.vin === selectedVin ? '' : r.vin)}
        >
          {r.vin}
        </UiButton>
      ),
    },
    {
      key: 'first_seen_at',
      filterValue: (r) => r.first_seen_at ?? null,
      header: t('devtools.health.firstSeen', 'First seen'),
      render: (r) => <TimeStamp value={r.first_seen_at} className="text-xs text-[var(--text-secondary)]" />,
    },
    {
      key: 'last_seen_at',
      filterValue: (r) => r.last_seen_at ?? null,
      header: t('devtools.health.lastSeen', 'Last seen'),
      render: (r) => (
        <TimeStamp
          value={r.last_seen_at}
          className={cn('text-xs', isRecent(r.last_seen_at) ? 'text-rose-300' : 'text-amber-300')}
        />
      ),
    },
  ], [t, selectedVin])

  const errorColumns: Column<FleetTelemetryError>[] = useMemo(() => [
    {
      key: 'vin',
      filterValue: (r) => r.vin ?? null,
      header: t('devtools.health.vin', 'VIN'),
      render: (r) => <span className="text-xs font-mono text-[var(--text-primary)]">{r.vin}</span>,
    },
    {
      key: 'error_code',
      filterValue: (r) => r.error_code ?? null,
      header: t('devtools.health.errorCode', 'Error code'),
      render: (r) => r.error_code ? <Badge variant="danger" size="sm">{r.error_code}</Badge> : <span className="text-xs text-[var(--text-muted)]">—</span>,
    },
    {
      key: 'error_message',
      filterValue: (r) => r.error_message ?? null,
      header: t('devtools.health.message', 'Message'),
      render: (r) => <span className="text-xs text-[var(--text-secondary)]">{r.error_message ?? '—'}</span>,
    },
    {
      key: 'reported_at',
      filterValue: (r) => r.reported_at ?? null,
      header: t('devtools.health.reportedAt', 'Reported at'),
      render: (r) => (
        <TimeStamp
          value={r.reported_at}
          className={cn('text-xs', r.reported_at && isRecent(r.reported_at) ? 'text-rose-300' : 'text-[var(--text-secondary)]')}
        />
      ),
    },
  ], [t])

  return (
    <div className="space-y-4">
      {/* Error VINs Summary */}
      <ToolCard
        icon={Icons.warning}
        color="red"
        title={t('devtools.health.errorVinsTitle', 'Error VINs')}
        description={t('devtools.health.errorVinsDesc', 'Vehicles with fleet telemetry configuration errors')}
      >
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Badge
              variant={!vinsState.hasData ? 'neutral' : vinsState.status === 'stale' ? 'warning' : vinList.length > 0 ? 'danger' : 'success'}
              size="sm"
            >
              {vinsState.hasData ? vinList.length : t('common.unknown', 'Unknown')} {t('devtools.health.affectedVehicles', 'affected')}
            </Badge>
            {vinsState.isRefreshing && (
              <Badge variant="info" size="sm" role="status">
                {t('dataSources.status.refreshing', 'Refreshing')}
              </Badge>
            )}
            {selectedVin && (
              <Badge variant="info" size="sm">
                {t('devtools.health.filteredBy', 'Filtered')}: {selectedVin}
                <UiButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-1 !h-auto !min-h-0 !px-1 !py-0 text-[var(--text-secondary)] hover:!bg-transparent hover:text-[var(--text-primary)]"
                  onClick={() => setSelectedVin('')}
                  aria-label={t('devtools.health.clearVinFilter', 'Clear VIN filter')}
                >
                  ×
                </UiButton>
              </Badge>
            )}
            <UiButton
              type="button"
              variant="secondary"
              size="sm"
              loading={refreshVINs.isPending}
              onClick={() => refreshVINs.mutate()}
              icon={<Icons.refresh className="h-3.5 w-3.5" />}
            >
              {t('devtools.health.refreshVins', 'Refresh from Tesla')}
            </UiButton>
          </div>
          <StaleRefreshWarning
            state={vinsState}
            label={t('devtools.health.errorVinsResource', 'telemetry error VINs')}
            message={vinsState.isRefreshBlocked && !vinsState.refreshError ? t('dataSources.status.paused', 'Refresh paused') : undefined}
          />
          {!vinsState.hasData && vinsState.isRefreshBlocked && (
            <DataStateNotice
              state="partial"
              role="status"
              title={t('dataSources.status.paused', 'Refresh paused')}
              message={t('dataSources.unavailableMessage', 'No requested source has returned usable data yet.')}
            >
              <UiButton type="button" variant="ghost" size="sm" onClick={vinsState.retry ?? undefined}>
                {t('common.retry', 'Retry')}
              </UiButton>
            </DataStateNotice>
          )}
          {vinsState.fatalError ? (
            <QueryError
              error={vinsState.fatalError}
              onRetry={vinsState.retry ?? undefined}
              resourceName={t('devtools.health.errorVinsResource', 'telemetry error VINs')}
            />
          ) : !vinsState.hasData ? (
            <Skeleton className="h-24" />
          ) : vinList.length > 0 ? (
            <DataTable
              tableId="admin:fleet-health-vins"
              columns={vinColumns}
              mobileColumns={['vin', 'last_seen_at']}
              data={vinList}
              enableValueFilters
              keyExtractor={(r) => r.vin}
              compact
            />
          ) : (
            <p className="py-4 text-center text-sm text-[var(--text-muted)]">
              {t('devtools.health.noErrorVins', 'No vehicles with telemetry errors')}
            </p>
          )}
        </div>
      </ToolCard>

      {/* Error Log Table */}
      <ToolCard
        icon={Icons.alertCircle}
        color="amber"
        title={t('devtools.health.errorLogTitle', 'Error log')}
        description={t('devtools.health.errorLogDesc', 'Detailed fleet telemetry error history')}
      >
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            {errorsState.isRefreshing && (
              <Badge variant="info" size="sm" role="status">
                {t('dataSources.status.refreshing', 'Refreshing')}
              </Badge>
            )}
            <UiButton
              type="button"
              variant="secondary"
              size="sm"
              loading={refreshErrors.isPending}
              onClick={() => refreshErrors.mutate()}
              icon={<Icons.refresh className="h-3.5 w-3.5" />}
            >
              {t('devtools.health.refreshErrors', 'Refresh from Tesla')}
            </UiButton>
          </div>
          <StaleRefreshWarning
            state={errorsState}
            label={t('devtools.health.errorLogResource', 'telemetry error log')}
            message={errorsState.isRefreshBlocked && !errorsState.refreshError ? t('dataSources.status.paused', 'Refresh paused') : undefined}
          />
          {!errorsState.hasData && errorsState.isRefreshBlocked && (
            <DataStateNotice
              state="partial"
              role="status"
              title={t('dataSources.status.paused', 'Refresh paused')}
              message={t('dataSources.unavailableMessage', 'No requested source has returned usable data yet.')}
            >
              <UiButton type="button" variant="ghost" size="sm" onClick={errorsState.retry ?? undefined}>
                {t('common.retry', 'Retry')}
              </UiButton>
            </DataStateNotice>
          )}
          {errorsState.fatalError ? (
            <QueryError
              error={errorsState.fatalError}
              onRetry={errorsState.retry ?? undefined}
              resourceName={t('devtools.health.errorLogResource', 'telemetry error log')}
            />
          ) : !errorsState.hasData ? (
            <Skeleton className="h-40" />
          ) : errorList.length > 0 ? (
            <DataTable
              tableId="admin:fleet-health-errors"
              columns={errorColumns}
              mobileColumns={['vin', 'error_code', 'reported_at']}
              data={errorList}
              enableValueFilters
              keyExtractor={(r) => String(r.id)}
              compact
              pagination
            />
          ) : (
            <p className="py-4 text-center text-sm text-[var(--text-muted)]">
              {t('devtools.health.noErrors', 'No fleet telemetry errors recorded')}
            </p>
          )}
        </div>
      </ToolCard>
    </div>
  )
}
