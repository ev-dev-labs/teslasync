import { useTranslation } from 'react-i18next'
import { Shield, Lock, Unlock, Eye, DoorClosed, Car } from 'lucide-react'
import { OperationalBrief, DataProvenanceBadge, type StatMetric } from '@/components/data-display'
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics'
import { EmptyState } from '@/components/feedback'
import type { SecurityEvent, VehicleState } from '@/api/types'
import type { DataStateSource } from '@/api/dataState'
import { useDataState } from '@/hooks/useDataState'
import { securityDoorReading, securityWindowReading } from '../statstrip-vehicle-detail/securityReadings'
import { useVehicleDetailSummary, type VehicleDetailSummaryProps } from '../statstrip-vehicle-detail/useVehicleDetailSummary'

interface SecuritySectionProps extends VehicleDetailSummaryProps {
  securityData: SecurityEvent | null | undefined
  state: VehicleState | undefined
  liveStateQuery?: DataStateSource<unknown>
}

export function SecuritySection({ securityData, state, sourceQuery, liveStateQuery }: SecuritySectionProps) {
  const { t } = useTranslation()
  const summary = useVehicleDetailSummary(t('vehicles.detail.security', 'Security'), sourceQuery, securityData?.ts, securityData != null)
  const liveTrust = useDataState(liveStateQuery ?? { data: state })
  const liveSummary = useVehicleDetailSummary(t('vehicles.detail.liveStateResource', 'Live vehicle state'), liveStateQuery, null, state != null)
  const liveContext = t('vehicles.detail.brief.liveContext', '{{source}} · {{status}}', {
    source: liveSummary.brief.provenance, status: liveSummary.brief.statusLabel,
  })
  const windows = securityWindowReading(securityData)
  const doorState = securityDoorReading(securityData?.door_state, t('common.open', 'Open'), t('common.closed', 'Closed'))
  const locked = state?.is_locked
  const sentry = state?.sentry_mode

  const rawMetrics: readonly StatMetric[] = [
          { metricId: 'status', occurrenceId: 'locked', label: t('common.locked', 'Locked'),
            rawValue: locked == null ? null : locked ? t('common.yes', 'Yes') : t('common.no', 'No'),
            context: <div>{locked == null ? <Shield className="h-4 w-4" aria-hidden="true" />
              : locked ? <Lock className="h-4 w-4" aria-hidden="true" /> : <Unlock className="h-4 w-4" aria-hidden="true" />}
              <div>{liveContext}</div></div> },
          { metricId: 'status', occurrenceId: 'sentry', label: t('common.sentry', 'Sentry'),
            rawValue: sentry == null ? null : sentry ? t('common.active', 'Active') : t('common.off', 'Off'),
            context: <div><Eye className="h-4 w-4" aria-hidden="true" /><div>{liveContext}</div></div> },
          { metricId: 'status', occurrenceId: 'doors', label: t('vehicles.detail.doors', 'Doors'),
            rawValue: doorState, context: <DoorClosed className="h-4 w-4" aria-hidden="true" /> },
          { metricId: 'status', occurrenceId: 'windows', label: t('vehicles.detail.windows', 'Windows'),
            rawValue: windows.open > 0 ? t('vehicles.detail.windowsOpen', '{{count}} open', { count: windows.open })
              : windows.complete ? t('common.closed', 'Closed') : null,
            context: <div><Car className="h-4 w-4" aria-hidden="true" />
              {!windows.complete && windows.open > 0
                && t('vehicles.detail.brief.windowsPartial', 'Other window states are unknown.')}
            </div> },
  ]
  const metrics = useOperationalMetrics(rawMetrics)
  return (
    <>
      <OperationalBrief compact testId="vehicle-security-summary" {...summary.brief}
        eyebrow={t('vehicles.detail.systems', 'Vehicle systems')}
        title={t('vehicles.detail.security', 'Security')}
        description={t('vehicles.detail.brief.securityDescription', 'Lock, sentry, doors and windows retain their individual source states; unknown is not unlocked, off or closed.')}
        scope={<div className="space-y-2">
          {summary.brief.scope}
          <div>{t('vehicles.detail.summaryMixedSources', 'Lock and sentry: live state; doors and windows: security telemetry.')}</div>
          <DataProvenanceBadge provenance={liveTrust.provenance} status={liveTrust.status} updatedAt={liveTrust.updatedAt} />
        </div>}
        metrics={metrics} />
      {!securityData && (
        // no-action: the independent source wrapper owns failure retry.
        <EmptyState message={t('vehicles.detail.noSecurityData', 'No security data available')} />
      )}
    </>
  )
}
