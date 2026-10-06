import { useTranslation } from 'react-i18next'
import { Battery, Navigation, Car, Gauge, Thermometer, Zap, Activity } from 'lucide-react'
import { OperationalBrief, type StatMetric } from '@/components/data-display'
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics'
import { fmtNumber, isFiniteNumber } from '@/lib/numberFormat'
import type { NeonColor } from '@/lib/tokens'
import type { VehicleState, VehicleStatus } from '@/api/types'
import { useVehicleDetailSummary, type VehicleDetailSummaryProps } from '../statstrip-vehicle-detail/useVehicleDetailSummary'

interface QuickStatsGridProps extends VehicleDetailSummaryProps {
  state: VehicleState | undefined
  status: VehicleStatus
}

/**
 * Battery state-of-charge → card accent. A healthy pack (>50%) reads green,
 * a mid charge (>20%) stays neutral cyan, and a low charge (<=20%) turns red
 * so a near-empty battery is visually distinct from a comfortable one — the
 * original inline ternary collapsed both lower tiers to cyan. Unknown /
 * non-finite levels fall back to neutral cyan.
 */
export function batteryColor(level: number | null | undefined): NeonColor {
  if (!isFiniteNumber(level)) return 'cyan'
  if (level > 50) return 'green'
  if (level > 20) return 'cyan'
  return 'red'
}

/** SoC percentage for display; missing / non-finite levels render an em-dash. */
export function formatBatteryLevel(level: number | null | undefined): string {
  return isFiniteNumber(level) ? `${fmtNumber(level)}%` : '—'
}

export function QuickStatsGrid({ state, status, sourceQuery }: QuickStatsGridProps) {
  const { t } = useTranslation()
  const summary = useVehicleDetailSummary(t('vehicles.detail.liveStateResource', 'Live vehicle state'), sourceQuery, null, state != null)

  const rawMetrics: readonly StatMetric[] = [
      { metricId: 'percent', occurrenceId: 'battery', label: t('common.battery', 'Battery'),
        rawValue: state?.battery_level,
        context: <Battery
          className={`h-4 w-4 ${batteryColor(state?.battery_level) === 'red' ? 'text-rose-300'
            : batteryColor(state?.battery_level) === 'green' ? 'text-emerald-300' : 'text-cyan-300'}`}
          aria-hidden="true" data-battery-color={batteryColor(state?.battery_level)} /> },
      { metricId: 'distance', occurrenceId: 'range', label: t('common.range', 'Range'),
        rawValue: state?.rated_range, context: <Navigation className="h-4 w-4" aria-hidden="true" /> },
      { metricId: 'distance', occurrenceId: 'odometer', label: t('common.odometer', 'Odometer'),
        rawValue: state?.odometer, context: <Car className="h-4 w-4" aria-hidden="true" /> },
      { metricId: 'speed', label: t('common.speed', 'Speed'), rawValue: state?.speed,
        context: <div className="space-y-1"><Gauge className="h-4 w-4" aria-hidden="true" />
          {state && isFiniteNumber(state.speed) && <span>{state.speed > 0 ? t('common.driving', 'Driving') : t('common.parked', 'Parked')}</span>}
        </div> },
      { metricId: 'temperature', occurrenceId: 'cabin', label: t('common.insideTemp', 'Inside temp'),
        rawValue: state?.inside_temp, context: <Thermometer className="h-4 w-4" aria-hidden="true" /> },
      { metricId: 'temperature', occurrenceId: 'outside', label: t('common.outsideTemp', 'Outside temp'),
        rawValue: state?.outside_temp, context: <Thermometer className="h-4 w-4" aria-hidden="true" /> },
      { metricId: 'power', label: t('common.power', 'Power'), rawValue: state?.power,
        context: <Zap className="h-4 w-4" aria-hidden="true" /> },
      { metricId: 'status', label: t('common.state', 'State'), rawValue: state ? status || null : null,
        context: <Activity className="h-4 w-4" aria-hidden="true" /> },
  ]
  const metrics = useOperationalMetrics(rawMetrics)
  return <OperationalBrief compact testId="vehicle-quick-stats-summary" {...summary.brief}
    eyebrow={t('vehicles.detail.quickStats', 'Quick stats')}
    title={t('vehicles.detail.brief.quickTitle', 'Live vehicle readings')}
    description={t('vehicles.detail.brief.quickDescription', 'Battery, range, odometer, motion, temperatures, power and vehicle state from the current source snapshot.')}
    metrics={metrics} />
}
