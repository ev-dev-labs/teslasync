import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, AlertCircle, RefreshCw } from 'lucide-react'
import { Badge, Button, DataTable, type Column } from '@/components/ui'
import { Skeleton } from '@/components/feedback'
import { cn } from '@/lib/cn'
import { formatDateTime } from '@/lib/dateFormat'
import {
  useFleetTelemetryErrorVINs, useFleetTelemetryErrors,
  useRefreshFleetTelemetryErrorVINs, useRefreshFleetTelemetryErrors,
  type FleetTelemetryErrorVIN, type FleetTelemetryError,
} from '@/api/hooks/useTelemetry'
import { ToolCard } from './ToolCard'

export function FleetTelemetryHealth() {
  const { t } = useTranslation()
  const [selectedVin, setSelectedVin] = useState('')

  const { data: errorVINs, isLoading: vinsLoading } = useFleetTelemetryErrorVINs()
  const { data: errors, isLoading: errorsLoading } = useFleetTelemetryErrors(selectedVin || undefined)
  const refreshVINs = useRefreshFleetTelemetryErrorVINs()
  const refreshErrors = useRefreshFleetTelemetryErrors()

  const vinList = errorVINs ?? []
  const errorList = errors ?? []

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
        <button
          className="text-xs font-mono text-neon-cyan hover:underline"
          onClick={() => setSelectedVin(r.vin === selectedVin ? '' : r.vin)}
        >
          {r.vin}
        </button>
      ),
    },
    {
      key: 'first_seen_at',
      header: t('devtools.health.firstSeen', 'First Seen'),
      render: (r) => <span className="text-xs text-white/60">{formatDateTime(r.first_seen_at)}</span>,
    },
    {
      key: 'last_seen_at',
      header: t('devtools.health.lastSeen', 'Last Seen'),
      render: (r) => (
        <span className={cn('text-xs', isRecent(r.last_seen_at) ? 'text-neon-red' : 'text-neon-amber')}>
          {formatDateTime(r.last_seen_at)}
        </span>
      ),
    },
  ], [t, selectedVin])

  const errorColumns: Column<FleetTelemetryError>[] = useMemo(() => [
    {
      key: 'vin',
      header: t('devtools.health.vin', 'VIN'),
      render: (r) => <span className="text-xs font-mono text-white/80">{r.vin}</span>,
    },
    {
      key: 'error_code',
      header: t('devtools.health.errorCode', 'Error Code'),
      render: (r) => r.error_code ? <Badge variant="danger" size="sm">{r.error_code}</Badge> : <span className="text-xs text-white/40">—</span>,
    },
    {
      key: 'error_message',
      header: t('devtools.health.message', 'Message'),
      render: (r) => <span className="text-xs text-white/70">{r.error_message ?? '—'}</span>,
    },
    {
      key: 'reported_at',
      header: t('devtools.health.reportedAt', 'Reported At'),
      render: (r) => (
        <span className={cn('text-xs', r.reported_at && isRecent(r.reported_at) ? 'text-neon-red' : 'text-white/60')}>
          {r.reported_at ? formatDateTime(r.reported_at) : '—'}
        </span>
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
                <Button variant="ghost" size="sm" className="ml-1 text-white/60 hover:text-white !px-1 !py-0 min-h-0" onClick={() => setSelectedVin('')}>×</Button>
              </Badge>
            )}
            <Button
              variant="secondary"
              size="sm"
              loading={refreshVINs.isPending}
              onClick={() => refreshVINs.mutate()}
              icon={<RefreshCw className="h-3.5 w-3.5" />}
            >
              {t('devtools.health.refreshVins', 'Refresh from Tesla')}
            </Button>
          </div>
          {vinsLoading ? (
            <Skeleton className="h-24" />
          ) : vinList.length > 0 ? (
            <DataTable columns={vinColumns} data={vinList} keyExtractor={(r) => r.vin} compact />
          ) : (
            <p className="py-4 text-center text-sm text-white/40">
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
            <Button
              variant="secondary"
              size="sm"
              loading={refreshErrors.isPending}
              onClick={() => refreshErrors.mutate()}
              icon={<RefreshCw className="h-3.5 w-3.5" />}
            >
              {t('devtools.health.refreshErrors', 'Refresh from Tesla')}
            </Button>
          </div>
          {errorsLoading ? (
            <Skeleton className="h-40" />
          ) : errorList.length > 0 ? (
            <DataTable columns={errorColumns} data={errorList} keyExtractor={(r) => String(r.id)} compact pagination />
          ) : (
            <p className="py-4 text-center text-sm text-white/40">
              {t('devtools.health.noErrors', 'No fleet telemetry errors recorded')}
            </p>
          )}
        </div>
      </ToolCard>
    </div>
  )
}
