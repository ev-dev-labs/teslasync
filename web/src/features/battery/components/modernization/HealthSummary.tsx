import { useTranslation } from 'react-i18next';
import { Heart, Battery, BatteryFull, Gauge, RefreshCcw, Clock, CheckCircle } from 'lucide-react';
import type { BatteryHealthAnalytics } from '@/types/energy';
import type { ChargingTelemetry } from '@/api/types';
import { BatterySpecialistSummary } from './BatterySpecialistSummary';

export interface HealthSummaryProps {
  health?: BatteryHealthAnalytics;
  chargingLive?: ChargingTelemetry | null;
  healthMeasured: boolean;
  healthValue: string;
  capacityMeasured: boolean;
  originalCapacityMeasured: boolean;
  formatEnergy: (value: number) => string;
  formatNumber: (value: number) => string;
  loading?: boolean;
  retained?: boolean;
}

/** Preserve the seven source metrics and their existing specialist displays.
 * The strip explicitly has unknown common period: historical health estimates
 * and a latest BMS flag are not seven measurements of one lifetime window. */
export function HealthSummary({
  health, chargingLive, healthMeasured, healthValue, capacityMeasured,
  originalCapacityMeasured, formatEnergy, formatNumber: fmtNumber, loading, retained,
}: HealthSummaryProps) {
  const { t } = useTranslation();
  return (
    <BatterySpecialistSummary
      title={t('battery.section.kpis', 'Battery health summary metrics')}
      period={{
        kind: 'unknown',
        label: t('battery.section.kpis', 'Battery health summary metrics'),
        reason: t('operations.battery.provenance', 'Calculated from battery-health snapshots, charging history, and the latest available BMS telemetry.'),
      }}
      testId="battery-health-summary"
      loading={loading}
      retained={retained}
      metrics={[
        {
          key: 'soh', label: t('battery.metric.soh', 'State of Health'), value: healthValue,
          metricId: 'percent', rawValue: healthMeasured ? health?.current_soh : null,
          icon: <Heart className="h-5 w-5" aria-hidden="true" />,
        },
        {
          key: 'currentCap', label: t('battery.metric.currentCap', 'Current Capacity'),
          value: capacityMeasured && health ? formatEnergy(health.estimated_capacity_wh) : '—',
          metricId: 'energy', rawValue: capacityMeasured ? health?.estimated_capacity_wh : null,
          icon: <Battery className="h-5 w-5" aria-hidden="true" />,
        },
        {
          key: 'originalCap', label: t('battery.metric.originalCap', 'Original Capacity'),
          value: originalCapacityMeasured && health ? formatEnergy(health.original_capacity_wh) : '—',
          metricId: 'energy', rawValue: originalCapacityMeasured ? health?.original_capacity_wh : null,
          icon: <BatteryFull className="h-5 w-5" aria-hidden="true" />,
        },
        {
          key: 'degradation', label: t('battery.metric.degradation', 'Degradation Rate'),
          value: healthMeasured && health ? `${fmtNumber(health.degradation_rate_pct_per_year)}%/${t('battery.yr', 'yr')}` : '—',
          metricId: 'rate', rawValue: healthMeasured ? health?.degradation_rate_pct_per_year : null,
          icon: <Gauge className="h-5 w-5" aria-hidden="true" />,
        },
        {
          key: 'cycles', label: t('battery.metric.cycles', 'Total Cycles'),
          value: health ? fmtNumber(health.total_cycles) : '—',
          metricId: 'number', rawValue: health?.total_cycles,
          icon: <RefreshCcw className="h-5 w-5" aria-hidden="true" />,
        },
        {
          key: 'age', label: t('battery.metric.age', 'Battery Age'),
          value: health && health.battery_age_months > 0
            ? `${health.battery_age_months} ${t('battery.months', 'months')}` : '—',
          metricId: 'number', rawValue: health && health.battery_age_months > 0 ? health.battery_age_months : null,
          icon: <Clock className="h-5 w-5" aria-hidden="true" />,
        },
        {
          key: 'fullChargeComplete', label: t('battery.metric.fullChargeComplete', 'Full Charge Complete'),
          value: chargingLive?.bms_fullcharge_complete == null ? '—' : chargingLive.bms_fullcharge_complete
            ? t('common.yes', 'Yes') : t('common.no', 'No'),
          metricId: 'status', rawValue: chargingLive?.bms_fullcharge_complete == null ? null : chargingLive.bms_fullcharge_complete
            ? t('common.yes', 'Yes') : t('common.no', 'No'),
          icon: <CheckCircle className="h-5 w-5" aria-hidden="true" />,
        },
      ]}
    />
  );
}
