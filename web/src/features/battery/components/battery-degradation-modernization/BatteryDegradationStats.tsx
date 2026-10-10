import { useTranslation } from 'react-i18next';
import { Battery, Calendar, TrendingDown, Zap } from 'lucide-react';
import { type StatMetric } from '@/components/data-display/stat-reference';
import { BatteryEvidenceBrief } from '../operationalbrief-all/BatteryEvidenceBrief';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { BatteryHealthAnalytics } from '@/types/energy';

export function ageLabel(
  months: number,
  t: (key: string, fallback: string, options?: Record<string, unknown>) => string,
): string {
  // Missing/invalid age is not a measured age of zero months.
  if (!Number.isFinite(months) || months < 0) return '—';
  const m = Math.round(months);
  if (m < 12) return t('battery.degradation.monthsCount', '{{count}} months', { count: m });
  const years = Math.floor(m / 12);
  const rem = m % 12;
  return rem > 0
    ? t('battery.degradation.yearsMonthsShort', '{{y}}y {{m}}m', { y: years, m: rem })
    : t('battery.degradation.yearsCount', '{{y}} years', { y: years });
}

interface Props {
  data: BatteryHealthAnalytics | undefined;
  loading?: boolean;
  prediction?: boolean;
}

/** SI values enter the shared renderer here; rate and age retain specialist formatting. */
export function BatteryDegradationStats({ data, loading = false, prediction = false }: Props) {
  const { t } = useTranslation();
  const { fmtNumber } = useNumberFormatting();
  const rateHelp = t('help.battery.degradationRate',
    'Annualised rate of capacity loss based on observed SoH trend. Combines calendar fade (time at temperature/SoC) and cycle fade (kWh throughput).');
  const rate = prediction ? data?.prediction?.slope_per_year : data?.degradation_rate_pct_per_year;
  const rateMetric: StatMetric = {
    metricId: 'rate',
    occurrenceId: prediction ? 'battery-degradation-fit-rate' : 'battery-degradation-rate',
    label: t('battery.degradation.rate', 'Degradation rate'),
    rawValue: rate != null ? prediction ? Math.abs(rate) : rate : null,
    display: { formatter: raw => ({ value: `${fmtNumber(raw)}%/yr`, unit: '' }) },
    description: rateHelp,
    context: <TrendingDown className="h-4 w-4" aria-hidden="true" />,
  };
  const metrics: StatMetric[] = prediction ? [
    rateMetric,
    {
      metricId: 'status',
      rawValue: data?.stress_level != null
        ? t(`battery.degradation.stressValue.${data.stress_level}`, data.stress_level) : null,
      label: t('battery.degradation.stress', 'Stress level'),
    },
    {
      // Full-pack equivalent cycles can be fractional, so this is not a count.
      metricId: 'number', rawValue: data?.total_cycles,
      label: t('battery.degradation.totalCycles', 'Total cycles'),
      description: t('help.battery.totalCycles',
        'Cumulative full-pack equivalent cycles. One cycle = one full discharge + one full charge worth of energy (partial cycles add up over time).'),
    },
    {
      metricId: 'percent', rawValue: data?.avg_depth_of_discharge_pct,
      label: t('battery.degradation.avgDoD', 'Avg depth of discharge'),
      description: t('help.battery.avgDoD',
        'Average Depth of Discharge per cycle — how deeply the pack is typically discharged before being recharged. Shallower cycles cause less wear.'),
    },
  ] : [
    {
      metricId: 'percent', rawValue: data?.current_soh,
      label: t('battery.degradation.currentSoh', 'Current SOH'),
      description: t('help.battery.soh',
        'State of Health — current usable capacity divided by the original rated capacity, expressed as a percentage. Higher is better; new packs start at 100%.'),
      context: <Battery className="h-4 w-4" aria-hidden="true" />,
    },
    {
      metricId: 'energy', rawValue: data?.estimated_capacity_wh,
      display: { precision: 1 },
      label: t('battery.degradation.estimatedCapacity', 'Estimated capacity'),
      description: t('help.battery.capacity',
        'Estimated current usable energy capacity of the pack in kWh, derived from the SoH and the original rated capacity.'),
      context: <Zap className="h-4 w-4" aria-hidden="true" />,
    },
    rateMetric,
    {
      metricId: 'number',
      rawValue: data?.battery_age_months != null && data.battery_age_months >= 0 ? data.battery_age_months : null,
      display: { formatter: raw => ({ value: ageLabel(raw, t), unit: '' }) },
      label: t('battery.degradation.batteryAge', 'Battery age'),
      context: <Calendar className="h-4 w-4" aria-hidden="true" />,
    },
  ];
  return (
    <BatteryEvidenceBrief
      id={prediction ? 'battery-degradation-prediction-stats' : 'battery-degradation-summary'}
      title={prediction ? t('battery.degradation.brief.prediction', 'Degradation model evidence') : t('battery.degradation.brief.summary', 'Battery degradation evidence')}
      metrics={metrics}
      loading={loading}
      period={{
        kind: 'unknown',
        label: t('battery.degradation.sampleWindow', 'Available battery history'),
        reason: t('battery.degradation.estimateEvidence',
          'Health, capacity, range and forecasts are estimates derived from available telemetry snapshots, not direct pack-capacity measurements.'),
      }}
    />
  );
}
