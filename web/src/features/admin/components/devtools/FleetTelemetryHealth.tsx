import { useState, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, AlertCircle, RefreshCw } from 'lucide-react'
import { Badge, Button as UiButton, DataTable, type Column } from '@/components/ui'
import { TimeStamp } from '@/components/data-display'
import { Skeleton, QueryError } from '@/components/feedback'
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

  const { data: errorVINs, isLoading: vinsLoading, isError: vinsIsError, error: vinsError, refetch: refetchVINs } = useFleetTelemetryErrorVINs()
  const { data: errors, isLoading: errorsLoading, isError: errorsIsError, error: errorsError, refetch: refetchErrors } = useFleetTelemetryErrors(selectedVin || undefined)
  const refreshVINs = useRefreshFleetTelemetryErrorVINs()
  const refreshErrors = useRefreshFleetTelemetryErrors()

  const vinList = errorVINs ?? []
  const errorList = errors ?? []

  const handleRetryVINs = useCallback(() => { void refetchVINs() }, [refetchVINs])
  const handleRetryErrors = useCallback(() => { void refetchErrors() }, [refetchErrors])

  const isRecent = (dateStr: string | null) => {
    if (!dateStr) return false
    const diff = Date.now() - new Date(dateStr).getTime()
    return diff < 24 * 60 * 60 * 1000
  }

  const vinColumns: Column<FleetTelemetryErrorVIN>[] = useMemo(() => [
    {
      key: 'vin',
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
      header: t('devtools.health.firstSeen', 'First Seen'),
      render: (r) => <TimeStamp value={r.first_seen_at} className="text-xs text-[var(--text-secondary)]" />,
    },
    {
      key: 'last_seen_at',
      header: t('devtools.health.lastSeen', 'Last Seen'),
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
      header: t('devtools.health.vin', 'VIN'),
      render: (r) => <span className="text-xs font-mono text-[var(--text-primary)]">{r.vin}</span>,
    },
    {
      key: 'error_code',
      header: t('devtools.health.errorCode', 'Error Code'),
      render: (r) => r.error_code ? <Badge variant="danger" size="sm">{r.error_code}</Badge> : <span className="text-xs text-[var(--text-muted)]">—</span>,
    },
    {
      key: 'error_message',
      header: t('devtools.health.message', 'Message'),
      render: (r) => <span className="text-xs text-[var(--text-secondary)]">{r.error_message ?? '—'}</span>,
    },
    {
      key: 'reported_at',
      header: t('devtools.health.reportedAt', 'Reported At'),
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
        icon={AlertTriangle}
        color="red"
        title={t('devtools.health.errorVinsTitle', 'Error VINs')}
        description={t('devtools.health.errorVinsDesc', 'Vehicles with fleet telemetry configuration errors')}
      >
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Badge variant={vinList.length > 0 ? 'danger' : 'success'} size="sm">
              {vinList.length} {t('devtools.health.affectedVehicles', 'affected')}
            </Badge>
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
              icon={<RefreshCw className="h-3.5 w-3.5" />}
            >
              {t('devtools.health.refreshVins', 'Refresh from Tesla')}
            </UiButton>
          </div>
          {vinsLoading ? (
            <Skeleton className="h-24" />
          ) : vinsIsError ? (
            <QueryError
              error={vinsError}
              onRetry={handleRetryVINs}
              resourceName={t('devtools.health.errorVinsResource', 'telemetry error VINs')}
            />
          ) : vinList.length > 0 ? (
            <DataTable
              tableId="admin:fleet-health-vins"
              columns={vinColumns}
              data={vinList}
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
        icon={AlertCircle}
        color="amber"
        title={t('devtools.health.errorLogTitle', 'Error Log')}
        description={t('devtools.health.errorLogDesc', 'Detailed fleet telemetry error history')}
      >
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <UiButton
              type="button"
              variant="secondary"
              size="sm"
              loading={refreshErrors.isPending}
              onClick={() => refreshErrors.mutate()}
              icon={<RefreshCw className="h-3.5 w-3.5" />}
            >
              {t('devtools.health.refreshErrors', 'Refresh from Tesla')}
            </UiButton>
          </div>
          {errorsLoading ? (
            <Skeleton className="h-40" />
          ) : errorsIsError ? (
            <QueryError
              error={errorsError}
              onRetry={handleRetryErrors}
              resourceName={t('devtools.health.errorLogResource', 'telemetry error log')}
            />
          ) : errorList.length > 0 ? (
            <DataTable
              tableId="admin:fleet-health-errors"
              columns={errorColumns}
              data={errorList}
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
