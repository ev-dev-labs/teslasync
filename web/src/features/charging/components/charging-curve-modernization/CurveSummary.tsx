import { useTranslation } from 'react-i18next';
import type { DataState } from '@/api/dataState';
import { LayoutCard } from '@/components/layout/layout-reference';
import { StatStrip, type StatMetric } from '@/components/data-display/stat-reference';
import { QueryError } from '@/components/feedback';
import { useFormatting } from '@/hooks/useFormatting';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { StatPeriod } from '@/lib/metric-reference';
import type { SummaryStats } from '../charging-curve/types';
import type { ChargingAvailability } from './availability';

interface CurveSummaryProps {
  stats: SummaryStats | null;
  availability: ChargingAvailability;
  state: DataState<unknown>;
  initialLoading: boolean;
  onRetry: () => void;
}

/** Six source metrics, same arithmetic and labels. Unknown inputs are disclosed
 * separately instead of treating an unmeasured all-zero aggregate as a reading. */
export function CurveSummary({ stats, availability, state, initialLoading, onRetry }: CurveSummaryProps) {
  const { t } = useTranslation();
  const { formatCurrency } = useFormatting();
  const { precision, locale } = useNumberFormatting();
  const title = t('charging.curve.summary', 'Summary metrics');
  const missingReason = state.hasData
    ? t('charging.curve.modernization.noMeasurements', 'No recorded measurements in the returned sessions.')
    : t('charging.curve.modernization.notLoaded', 'Measurements have not been loaded.');
  const coverage = (known: number) => known < availability.count
    ? t('charging.curve.modernization.coverage', '{{known}} of {{count}} sessions have a recorded value.', {
        known, count: availability.count,
      })
    : undefined;
  const period: StatPeriod = {
    kind: 'unknown',
    label: t('charging.curve.modernization.returnedSessions', 'Returned sessions in the workspace range'),
    reason: t('charging.curve.modernization.resultScope', 'Up to 200 returned sessions; not a full-history aggregate.'),
  };
  const metrics: StatMetric[] = [
    {
      metricId: 'charge.sessions',
      occurrenceId: 'totalSessions',
      label: t('charging.curve.totalSessions', 'Total Sessions'),
      rawValue: state.hasData ? availability.count : null,
      missingReason,
    },
    {
      metricId: 'charge.energyAdded',
      occurrenceId: 'totalEnergy',
      label: t('charging.curve.totalEnergy', 'Total Energy'),
      rawValue: stats && availability.energy > 0 ? stats.totalEnergy * 1000 : null,
      display: { precision, units: { locale } },
      missingReason,
      context: coverage(availability.energy),
    },
    {
      // The original metric is mean PEAK power, not mean session average power.
      metricId: 'power',
      occurrenceId: 'avgRate',
      label: t('charging.curve.avgChargeRate', 'Avg Charge Rate'),
      description: t('charging.curve.modernization.meanPeakDescription', 'Arithmetic mean of session peak power, using the original returned-session denominator.'),
      rawValue: stats && availability.power > 0 ? stats.avgRate * 1000 : null,
      display: { precision, units: { locale } },
      missingReason,
      context: coverage(availability.power),
    },
    {
      metricId: 'charge.peakPower',
      occurrenceId: 'peakRate',
      label: t('charging.curve.peakRate', 'Peak Rate'),
      rawValue: stats && availability.power > 0 ? stats.peakRate * 1000 : null,
      display: { precision, units: { locale } },
      missingReason,
      context: coverage(availability.power),
    },
    {
      metricId: 'charge.avgDuration',
      occurrenceId: 'avgDuration',
      label: t('charging.curve.avgDuration', 'Avg Duration'),
      rawValue: stats && availability.duration > 0 ? stats.avgDuration * 60 : null,
      display: { units: { duration: 'min', locale }, precision: 0 },
      missingReason,
      context: coverage(availability.duration),
    },
    {
      // Retain the specialist currency-symbol / precision contract exactly.
      metricId: 'text',
      occurrenceId: 'totalCost',
      label: t('charging.curve.totalCost', 'Total Cost'),
      description: t('charging.curve.modernization.recordedCostDescription', 'Sum of recorded session costs in the configured currency; no tariff estimate.'),
      rawValue: stats && availability.cost > 0 ? formatCurrency(stats.totalCost) : null,
      missingReason,
      context: coverage(availability.cost),
    },
  ];

  return (
    <LayoutCard title={title}>
      {state.fatalError ? (
        <QueryError
          error={state.fatalError}
          onRetry={onRetry}
          resourceName={t('charging.curve.resource', 'Charging sessions')}
        />
      ) : (
        <StatStrip
          id="charging-curve-summary"
          testId="charging-curve-summary"
          variant="embedded"
          metrics={metrics}
          period={period}
          loading={initialLoading}
          retained={state.status === 'stale'}
        />
      )}
    </LayoutCard>
  );
}
