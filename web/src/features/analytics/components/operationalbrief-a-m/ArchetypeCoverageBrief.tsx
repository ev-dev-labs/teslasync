import { useTranslation } from 'react-i18next';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { AlertBanner } from '@/components/feedback';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { ArchetypeSectionBody } from '../drive-archetypes/ArchetypeSectionBody';
import type { ArchetypeDisplay, ArchetypeSectionProps } from '../drive-archetypes/types';

export function ArchetypeCoverageBrief({ summary, state, display }: ArchetypeSectionProps & { display: ArchetypeDisplay }) {
  const { t } = useTranslation();
  const { fmtInt } = useNumberFormatting();
  const coverage = summary.coverage;
  const resolved = state.isResolved && !state.error;
  const description = t('archetypes.coverage.subtitle', 'Coverage describes the returned history window, never lifetime driving behavior.');
  const integerDisplay = { formatter: (raw: number) => ({ value: fmtInt(raw), unit: '' }) };
  const metrics: StatMetric[] = [
    { metricId: 'count', occurrenceId: 'archetype-history-0', label: t('archetypes.coverage.returned', 'Rows in observed window'),
      rawValue: resolved ? summary.source.returnedRows : null, display: integerDisplay, description },
    { metricId: 'count', occurrenceId: 'archetype-history-1', label: t('archetypes.coverage.timestamped', 'Timestamp-valid rows'),
      rawValue: resolved ? coverage.timestampedRows : null, display: integerDisplay, description },
    { metricId: 'text', occurrenceId: 'archetype-history-2', label: t('archetypes.coverage.earliest', 'Earliest observed start'),
      rawValue: resolved ? display.formatDateTime(coverage.earliestMs) : null, description },
    { metricId: 'text', occurrenceId: 'archetype-history-3', label: t('archetypes.coverage.latest', 'Latest observed start'),
      rawValue: resolved ? display.formatDateTime(coverage.latestMs) : null, description },
    { metricId: 'duration', occurrenceId: 'archetype-history-4', label: t('archetypes.coverage.span', 'Observed time span'),
      rawValue: resolved ? coverage.spanS : null, description,
      display: { formatter: raw => ({ value: display.formatDuration(raw), unit: '' }) } },
    { metricId: 'count', occurrenceId: 'archetype-history-5', label: t('archetypes.coverage.limit', 'Request row limit'),
      rawValue: resolved ? coverage.historyLimit : null, display: integerDisplay, description },
  ];
  const operationalMetrics = useOperationalMetrics(metrics);
  const disclosure = coverage.historyCapReached
    ? t('archetypes.coverage.capWarning', 'Exactly {{limit}} rows were returned, so older history may exist beyond this observed bounded window.', { limit: fmtInt(coverage.historyLimit) })
    : t('archetypes.coverage.boundedNotice', 'The endpoint returned fewer than {{limit}} rows, but this workspace still describes observed records rather than guaranteed lifetime behavior.', { limit: fmtInt(coverage.historyLimit) });
  return <section data-testid="drive-archetypes-coverage">
    <OperationalBrief compact metrics={operationalMetrics} loading={state.isLoading}
      eyebrow={t('archetypes.title', 'Drive archetypes')}
      title={t('archetypes.coverage.title', 'History coverage and bounded-window disclosure')} description={description}
      statusLabel={state.isLoading ? t('analytics.brief.loading', 'Loading evidence')
        : !resolved ? t('analytics.brief.unavailable', 'Evidence unavailable')
          : state.refreshError || state.refreshPaused ? t('analytics.brief.retained', 'Retained evidence') : t('analytics.brief.returned', 'Returned evidence')}
      statusTone={!resolved || state.refreshError || state.refreshPaused ? 'warning' : 'neutral'}
      scope={<span>{t('archetypes.coverage.sourcePeriod', 'Returned drive-history window')}</span>}
      provenance={description} />
    <ArchetypeSectionBody summary={summary} state={state} requirement="resolved">
      <AlertBanner className="mt-4" variant={coverage.historyCapReached ? 'warning' : 'info'}>{disclosure}</AlertBanner>
    </ArchetypeSectionBody>
  </section>;
}
