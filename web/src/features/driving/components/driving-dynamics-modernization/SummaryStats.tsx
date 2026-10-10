import { useTranslation } from 'react-i18next';
import { StatStrip, type StatMetric, type MetricPreferences } from '@/components/data-display/stat-reference';
import { QueryError, StaleRefreshWarning } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { MotorHistoryQuery } from '@/api/hooks/useVehicles';
import { useMotorEvidence } from './useMotorEvidence';
import { MOTOR_HISTORY_LIMIT } from '../driving-dynamics/useMotorStats';

interface SummaryStatsProps {
  vehicleId: number | null | undefined;
  historyQuery?: MotorHistoryQuery;
}

export default function SummaryStats({ vehicleId, historyQuery }: SummaryStatsProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const { precision, locale } = useNumberFormatting();
  const { state, motorStats, query } = useMotorEvidence(vehicleId, historyQuery);
  const metrics: StatMetric[] = [
    { metricId: 'count', occurrenceId: 'motor-total-readings', rawValue: motorStats?.totalReadings,
      label: t('dynamics.totalReadings', 'Total Readings'), display: { precision: 0, units: { locale } } },
    // Torque has no glossary quantity yet. Keep the explicit domain unit
    // context, rather than misclassifying this Nm measurement as power.
    { metricId: 'number', occurrenceId: 'motor-average-torque', rawValue: motorStats?.avgTorque,
      label: t('dynamics.avgTorque', 'Avg Torque'),
      description: t('dynamics.evidence.torqueMeaning', 'Sum of reported axle torque. Sample share is not time spent under load or a driver rating.'),
      context: t('dynamics.modernization.torqueUnit', 'Newton-metres (Nm)'),
      display: { precision, units: { locale } } },
    // Existing MotorStats power fields are kW; display boundary only.
    { metricId: 'power', occurrenceId: 'motor-peak-power',
      rawValue: motorStats?.peakPower != null ? motorStats.peakPower * 1000 : null,
      label: t('dynamics.peakPower', 'Peak Power'), display: { precision: unitPrefs.precision ?? 2 } },
    { metricId: 'power', occurrenceId: 'motor-peak-regen',
      rawValue: motorStats?.peakRegen != null ? motorStats.peakRegen * 1000 : null,
      label: t('dynamics.peakRegen', 'Peak Regen'), display: { precision: unitPrefs.precision ?? 2 } },
    { metricId: 'power', occurrenceId: 'motor-average-power',
      rawValue: motorStats?.avgPower != null ? motorStats.avgPower * 1000 : null,
      label: t('dynamics.avgPower', 'Avg Power'), display: { precision: unitPrefs.precision ?? 2 } },
    { metricId: 'temperature', occurrenceId: 'motor-average-temperature', rawValue: motorStats?.avgMotorTemp,
      label: t('dynamics.avgMotorTemp', 'Avg Motor Temp'),
      display: { precision, units: { locale } } },
  ];
  // Keep unit formatter preferences for power/count; temperature and torque
  // explicitly preserve their prior global number preference path.
  const preferences: MetricPreferences = {
    units: unitPrefs,
    currency: { kind: 'symbol', value: '' },
  };
  return (
    <FadeIn delay={0.05} className="min-w-0 space-y-3">
      {state.fatalError ? <QueryError error={state.fatalError} onRetry={() => void query.refetch()} /> : null}
      <StaleRefreshWarning state={state} label={t('dynamics.modernization.sampleMetrics', 'Selected-drive motor samples')} />
      <StatStrip
        id="dynamics-motor-summary"
        metrics={metrics}
        preferences={preferences}
        loading={query.isLoading && !state.hasData}
        retained={state.refreshError != null}
        period={{
          kind: 'unknown',
          label: t('dynamics.modernization.sampleMetrics', 'Selected-drive motor samples'),
          reason: t('dynamics.powertrain.coverage', 'Up to {{limit}} motor samples inside the selected drive. Averages describe reported samples, not a time-weighted or complete-trip assessment.', { limit: MOTOR_HISTORY_LIMIT }),
        }}
      />
    </FadeIn>
  );
}
