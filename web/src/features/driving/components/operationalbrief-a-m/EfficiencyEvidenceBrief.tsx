import { useTranslation } from 'react-i18next';
import { GlossaryTerm, Text } from '@/components/ui';
import { ActionableEmptyState } from '@/components/feedback';
import type { StatMetric } from '@/components/data-display/stat-reference';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { efficiencyMetrics } from '../efficiency-modernization/metrics';
import type { StatsPresentation } from '../efficiency-modernization/types';
import { EfficiencySource } from '../efficiency-modernization/EfficiencySource';
import { DrivingSummaryBrief } from './DrivingSummaryBrief';

export function EfficiencyEvidenceBrief(props: StatsPresentation & { kind: 'kpis' | 'insights' }) {
  const { t } = useTranslation();
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { kpis, insights } = efficiencyMetrics(props, t, fmtNumber, fmtInt);
  const selected = props.kind === 'kpis' ? kpis : insights;
  const metrics: readonly StatMetric[] = selected.map<StatMetric>(metric => {
    if (metric.occurrenceId === 'distancePerKwh') {
      const intensity = props.stats?.avgEfficiencyWhKm;
      return { ...metric, metricId: 'number',
        rawValue: intensity != null && Number.isFinite(intensity) && intensity > 0 ? 1000 / intensity : null,
        description: t('efficiency.brief.economy', 'Reciprocal economy, derived from the same measured consumption; not energy intensity.'),
        display: { formatter: (raw) => ({
          value: fmtNumber(props.model.toStatsDistanceDisplay(raw)),
          unit: `${props.units.unitPrefs.distance}/kWh`,
        }) } };
    }
    if (metric.occurrenceId === 'co2SavedKg' || metric.occurrenceId === 'co2') {
      return { ...metric, metricId: 'mass', rawValue: props.stats?.co2SavedKg,
        description: t('efficiency.brief.co2', 'Source aggregate CO₂ savings estimate, in kilograms.'),
        display: { formatter: (raw) => ({ value: fmtInt(raw), unit: t('efficiency.kgUnit', 'kg') }) } };
    }
    if (metric.occurrenceId === 'regen') {
      return { ...metric, metricId: 'energy', rawValue: props.stats?.regenEnergyWh,
        display: { formatter: (raw) => ({ value: props.units.formatEnergy(raw), unit: '' }) } };
    }
    return metric;
  });
  const title = props.kind === 'kpis'
    ? t('efficiency.section.kpis', 'Key metrics') : t('efficiency.insights', 'Energy insights');
  const state = props.source.state;
  return <div className="min-w-0 space-y-3">
    <DrivingSummaryBrief metrics={metrics} title={props.kind === 'kpis'
      ? t('efficiency.brief.title', 'Lifetime efficiency evidence') : title}
      description={t('efficiency.brief.description', 'Vehicle driving aggregates retain their lifetime source period; they are independent of the range-filtered drive charts.')}
      scope={t('efficiency.period.lifetime', 'Lifetime driving summary')}
      provenance={t('efficiency.period.statsSource', 'Vehicle driving aggregates; not filtered by the workspace range.')}
      preferences={{ units: props.units.unitPrefs, currency: { kind: 'symbol', value: '$' } }}
      loading={props.source.loading && !state.hasData}
      error={state.fatalError} showError={false} retained={state.status === 'stale' || state.refreshError != null}
      onRetry={() => { state.retry?.(); }}
      statusLabel={props.source.malformed || state.status === 'unavailable'
        ? t('driving.brief.unavailable', 'Source unavailable')
        : state.status === 'partial' ? t('driving.brief.partial', 'Partial evidence') : undefined} />
    <EfficiencySource {...props.source} available={Boolean(props.stats)} label={title}
      emptyMessage={props.kind === 'kpis'
        ? t('efficiency.noStats', 'No efficiency data available yet')
        : t('efficiency.noInsights', 'No energy insights available yet')}
      emptyContent={props.kind === 'kpis' ? <ActionableEmptyState guidanceId="analytics.efficiency"
        fallbackMessage={t('efficiency.noStats', 'No efficiency data available yet')} /> : undefined}>
      {null}
    </EfficiencySource>
    {props.kind === 'kpis' && <Text as="p" variant="bodySm" color="muted"
      className="flex flex-wrap items-center gap-x-4 gap-y-1" data-testid="efficiency-glossary-strip">
      <span>{t('efficiency.glossary.lead', 'Terms on this page:')}</span>
      <GlossaryTerm term="efficiency" />
      <GlossaryTerm term="rated_range" />
      <GlossaryTerm term="phantom_drain" />
    </Text>}
  </div>;
}
