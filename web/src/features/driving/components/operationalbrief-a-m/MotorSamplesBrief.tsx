import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import type { StatMetric } from '@/components/data-display/stat-reference';
import { StaleRefreshWarning } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type SummaryStats from '../driving-dynamics-modernization/SummaryStats';
import { useMotorEvidence } from '../driving-dynamics-modernization/useMotorEvidence';
import { MOTOR_HISTORY_LIMIT } from '../driving-dynamics/useMotorStats';
import { DrivingSummaryBrief } from './DrivingSummaryBrief';

type Props = ComponentProps<typeof SummaryStats>;

export function MotorSamplesBrief({ vehicleId, historyQuery }: Props) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const { precision, locale } = useNumberFormatting();
  const { state, motorStats, query } = useMotorEvidence(vehicleId, historyQuery);
  const metrics: readonly StatMetric[] = [
    { metricId: 'count', occurrenceId: 'motor-total-readings', rawValue: motorStats?.totalReadings,
      label: t('dynamics.totalReadings', 'Total Readings'), display: { precision: 0, units: { locale } } },
    { metricId: 'number', occurrenceId: 'motor-average-torque', rawValue: motorStats?.avgTorque,
      label: t('dynamics.avgTorque', 'Avg Torque'),
      description: t('dynamics.evidence.torqueMeaning', 'Sum of reported axle torque. Sample share is not time spent under load or a driver rating.'),
      context: t('dynamics.modernization.torqueUnit', 'Newton-metres (Nm)'),
      display: { precision, units: { locale } } },
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
      label: t('dynamics.avgMotorTemp', 'Avg Motor Temp'), display: { precision, units: { locale } } },
  ];
  return <FadeIn delay={0.05} className="min-w-0 space-y-3">
    <StaleRefreshWarning state={state} label={t('dynamics.modernization.sampleMetrics', 'Selected-drive motor samples')} />
    <DrivingSummaryBrief metrics={metrics}
      title={t('dynamics.modernization.sampleMetrics', 'Selected-drive motor samples')}
      description={t('dynamics.powertrain.coverage', 'Up to {{limit}} motor samples inside the selected drive. Averages describe reported samples, not a time-weighted or complete-trip assessment.', { limit: MOTOR_HISTORY_LIMIT })}
      scope={t('dynamics.modernization.sampleMetrics', 'Selected-drive motor samples')}
      provenance={t('dynamics.brief.source', 'Returned motor-history samples inside the existing selected-drive query bounds.')}
      loading={query.isLoading && !state.hasData}
      error={state.fatalError} retained={state.status === 'stale' || state.refreshError != null}
      preferences={{ units: unitPrefs, currency: { kind: 'symbol', value: '' } }}
      onRetry={() => void query.refetch()} />
  </FadeIn>;
}
