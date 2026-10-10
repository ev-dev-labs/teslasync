import { useTranslation } from 'react-i18next'
import { Zap, Activity, BatteryCharging, Battery } from 'lucide-react'

import { GlassPanel, PanelTitle } from '@/components/ui'
import { OperationalBrief, type StatMetric } from '@/components/data-display'
import { EmptyState } from '@/components/feedback'

import { useUnits } from '@/hooks/useUnits'
import type { ChargingTelemetry } from '@/api/types'
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { formatDateTime } from '@/lib/dateFormat';

interface ChargingTelemetrySectionProps {
  chargingTelemetry: ChargingTelemetry | null | undefined
}

export function ChargingTelemetrySection({ chargingTelemetry }: ChargingTelemetrySectionProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation()
  const { formatDistance, formatSpeed, formatPower, formatEnergy } = useUnits()
  const context = chargingTelemetry ? <>
    <div>{t('vehicles.detail.chargingSnapshotAt', 'Reported at {{at}}', { at: formatDateTime(chargingTelemetry.ts) })}</div>
    <div>{t('vehicles.detail.chargingSnapshotSource', 'Source: {{source}} · session: {{session}}', { source: chargingTelemetry.source, session: chargingTelemetry.session_id ?? '—' })}</div>
  </> : undefined
  const sourceMetrics: readonly StatMetric[] = chargingTelemetry ? [
    { metricId: 'power', occurrenceId: 'power', label: t('vehicles.detail.chargerPower', 'Charger power'), rawValue: chargingTelemetry.charger_power_w, context, display: { formatter: raw => ({ value: formatPower(raw), unit: '' }) } },
    { metricId: 'number', occurrenceId: 'voltage', label: t('vehicles.detail.voltage', 'Voltage'), rawValue: chargingTelemetry.charger_voltage, context, display: { formatter: raw => ({ value: `${fmtNumber(raw)} V`, unit: '' }) } },
    { metricId: 'number', occurrenceId: 'current', label: t('vehicles.detail.current', 'Current'), rawValue: chargingTelemetry.charger_actual_current, context, display: { formatter: raw => ({ value: `${fmtNumber(raw)} A`, unit: '' }) } },
    { metricId: 'energy', occurrenceId: 'energy', label: t('vehicles.detail.energyAdded', 'Energy added'), rawValue: chargingTelemetry.charge_energy_added_wh, context, display: { formatter: raw => ({ value: formatEnergy(raw), unit: '' }) } },
    { metricId: 'status', occurrenceId: 'state', label: t('vehicles.detail.chargingState', 'Charging state'), rawValue: chargingTelemetry.charging_state, context },
    { metricId: 'percent', occurrenceId: 'battery', label: t('vehicles.detail.batteryLevel', 'Battery level'), rawValue: chargingTelemetry.battery_level, context, display: { formatter: raw => ({ value: `${fmtNumber(raw)}%`, unit: '' }) } },
    { metricId: 'speed', occurrenceId: 'rate', label: t('vehicles.detail.chargeRate', 'Charge rate'), rawValue: chargingTelemetry.range_added_meters_per_hour == null ? null : chargingTelemetry.range_added_meters_per_hour / 3600, context: <>{context}<div>{t('vehicles.detail.chargingRangeRateContext', 'Source is meters of range added per hour, not vehicle motion. Raw display operand is meters per second.')}</div></>, display: { formatter: raw => ({ value: formatSpeed(raw), unit: '' }) } },
    { metricId: 'distance', occurrenceId: 'range', label: t('vehicles.detail.rangeAdded', 'Range added'), rawValue: chargingTelemetry.range_added_meters, context, display: { formatter: raw => ({ value: formatDistance(raw), unit: '' }) } },
  ] : []
  const metrics = useOperationalMetrics(sourceMetrics)

  return (
    <GlassPanel className="p-6">
      <PanelTitle className="mb-4 flex items-center gap-2">
        <Zap className="h-4 w-4 text-emerald-300" aria-hidden="true" />
        {t('vehicles.detail.chargingTelemetry', 'Charging telemetry')}
      </PanelTitle>
      {chargingTelemetry ? (
        <OperationalBrief compact testId="vehicle-charging-telemetry-brief"
          eyebrow={t('vehicles.evidenceBrief.eyebrow', 'Vehicle evidence')}
          title={t('vehicles.detail.chargingSnapshotTitle', 'Returned charging measurements')}
          description={t('vehicles.detail.chargingSnapshotDescription', 'Independent charging snapshot; source refresh warnings remain in the surrounding panel. Range-addition rate is not vehicle speed.')}
          statusLabel={t('vehicles.detail.chargingSnapshotStatus', 'Snapshot returned')}
          metrics={metrics} freshness={formatDateTime(chargingTelemetry.ts)}
          provenance={chargingTelemetry.source}
          scope={<><span className="flex flex-wrap gap-2" aria-hidden="true">
            <Zap className="h-4 w-4" aria-hidden="true" /><Activity className="h-4 w-4" aria-hidden="true" /><Activity className="h-4 w-4" aria-hidden="true" />
            <BatteryCharging className="h-4 w-4" aria-hidden="true" /><Battery className="h-4 w-4" aria-hidden="true" /><Battery className="h-4 w-4" aria-hidden="true" />
            <Activity className="h-4 w-4" aria-hidden="true" /><Zap className="h-4 w-4" aria-hidden="true" />
          </span>{context}</>} />
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Zap className="h-8 w-8" aria-hidden="true" />}
          message={t('vehicles.detail.noChargingTelemetry', 'No charging telemetry available')}
        />
      )}
    </GlassPanel>
  )
}
