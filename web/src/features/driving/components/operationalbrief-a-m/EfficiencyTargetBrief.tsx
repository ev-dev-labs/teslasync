import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import type { StatMetric } from '@/components/data-display/stat-reference';
import { EmptyState } from '@/components/feedback';
import type { EfficiencyTargetKpis } from '../efficiency-target/EfficiencyTargetKpis';
import { useEfficiencyTargetDisplay } from '../efficiency-target/useEfficiencyTargetDisplay';
import { DrivingSummaryBrief } from './DrivingSummaryBrief';

type Props = ComponentProps<typeof EfficiencyTargetKpis> & { retained: boolean };

export function EfficiencyTargetBrief({ summary, targetWhPerKm, state, retained }: Props) {
  const { t } = useTranslation();
  const { formatEfficiency } = useEfficiencyTargetDisplay();
  const available = !state.isLoading && state.error == null;
  const metrics: readonly StatMetric[] = [
    { metricId: 'efficiency', occurrenceId: 'target', rawValue: targetWhPerKm / 1000,
      label: t('effTarget.target', 'Target'),
      description: t('effTarget.kpi.canonical', 'Saved canonically in Wh/km'),
      display: { formatter: (raw) => ({ value: formatEfficiency(raw * 1000), unit: '' }) } },
    { metricId: 'count', occurrenceId: 'streak', rawValue: available ? summary.currentStreak : null,
      label: t('effTarget.streak', 'Completed-week streak'),
      description: available
        ? t('effTarget.longest', 'Longest completed run: {{count}}', { count: summary.longestStreak })
        : t('driving.brief.pending', 'Drive evidence is not available yet.'),
      context: available ? t('effTarget.weeks', '{{count}} weeks', { count: summary.currentStreak }) : undefined },
    { metricId: 'percent', occurrenceId: 'hit-rate',
      rawValue: available && summary.hitRate != null ? summary.hitRate * 100 : null,
      label: t('effTarget.hitRate', 'Completed-week hit rate'),
      description: available
        ? t('effTarget.ofWeeks', 'Across {{count}} completed weeks', { count: summary.completedWeeks.length })
        : t('driving.brief.pending', 'Drive evidence is not available yet.') },
    { metricId: 'efficiency', occurrenceId: 'overall',
      rawValue: available && summary.overallWhPerKm != null ? summary.overallWhPerKm / 1000 : null,
      label: t('effTarget.overall', 'Observed overall'),
      description: available
        ? t('effTarget.analyzed', '{{eligible}} of {{observed}} drives eligible', { eligible: summary.analyzed, observed: summary.observed })
        : t('driving.brief.pending', 'Drive evidence is not available yet.'),
      display: { formatter: (raw) => ({ value: formatEfficiency(raw * 1000), unit: '' }) } },
  ];
  return <section aria-label={t('effTarget.kpis', 'Efficiency target summary metrics')} data-testid="efficiency-target-kpis">
    <DrivingSummaryBrief metrics={metrics} title={t('effTarget.kpis', 'Efficiency target summary metrics')}
      description={t('effTarget.brief.description', 'Completed-week outcomes from the observed history window; current partial weeks do not extend the completed-week streak.')}
      scope={t('effTarget.brief.window', 'Latest returned drive history, up to 1,000 rows; not lifetime coverage')}
      provenance={t('effTarget.brief.source', 'Returned drive energy and distance; saved target and completed local weeks.')}
      loading={state.isLoading} error={state.error} retained={retained} onRetry={state.onRetry} />
    {available && summary.analyzed === 0 && <EmptyState
      message={t('effTarget.noData', 'No drives with at least 1 km of distance and measured energy are available in this observed window.')}
      actionTo={{ label: t('effTarget.browseDrives', 'Browse drives'), to: '/drives' }} />}
  </section>;
}
